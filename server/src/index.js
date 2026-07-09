import cors from 'cors'
import express from 'express'
import admin from 'firebase-admin'
import { createClient } from '@libsql/client'

const PORT = Number(process.env.PORT || 8080)
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000)
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30)

let firestore = null
try {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }
  firestore = admin.firestore()
} catch {
  console.warn('[firebase] 인증 정보 없음 — seed data fallback 사용')
}
const app = express()

// Turso 클라이언트 (환경변수 없으면 null)
let turso = null
if (process.env.TURSO_DB_URL && process.env.TURSO_AUTH_TOKEN) {
  turso = createClient({
    url: process.env.TURSO_DB_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  })
  turso.execute(`
    CREATE TABLE IF NOT EXISTS hint_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      stage_number INTEGER,
      hint_level INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(err => console.warn('[turso] 테이블 초기화 실패:', err.message))
}

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map(origin => origin.trim()),
  credentials: false
}))
app.use(express.json({ limit: '1mb' }))
app.use(rateLimit)

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    model: GROQ_MODEL,
    groq: !!GROQ_API_KEY,
    turso: turso !== null
  })
})

app.post('/api/hints', async (req, res) => {
  try {
    const payload = validateHintRequest(req.body)
    const knowledge = await loadGameKnowledge(payload.gameId)
    const stage = findStage(knowledge, payload.question, payload.history)
    const hintLevel = decideHintLevel(knowledge, stage, payload.question, payload.history, payload.maxHintLevel)
    const answer = await askGroq({ payload, knowledge, stage, hintLevel })

    // Turso에 힌트 사용 기록 (비동기, 실패해도 응답에 영향 없음)
    logHintToTurso(payload.gameId, stage?.number ?? null, hintLevel, payload.userEmail)

    res.json({
      answer,
      hintLevel,
      model: GROQ_MODEL,
      matchedStage: toMatchedStage(stage),
      source: 'groq'
    })
  } catch (error) {
    const status = error.statusCode || 500
    res.status(status).json({ error: error.message })
  }
})

// 게임별 힌트 통계 (관리자용)
app.get('/api/hint-stats/:gameId', async (req, res) => {
  if (!turso) return res.status(503).json({ error: 'Turso 연동이 설정되지 않았습니다.' })
  try {
    const { gameId } = req.params
    const result = await turso.execute({
      sql: `SELECT stage_number, hint_level, COUNT(*) as count
            FROM hint_logs WHERE game_id = ?
            GROUP BY stage_number, hint_level
            ORDER BY stage_number, hint_level`,
      args: [gameId]
    })
    const total = await turso.execute({
      sql: 'SELECT COUNT(*) as total FROM hint_logs WHERE game_id = ?',
      args: [gameId]
    })
    res.json({
      gameId,
      totalHints: Number(total.rows[0].total),
      byStage: result.rows
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 유저별 힌트 횟수 조회 (웹사이트 엔딩 시 호출 → 등급 산정용)
app.get('/api/user-hints', async (req, res) => {
  if (!turso) return res.status(503).json({ error: 'Turso 연동이 설정되지 않았습니다.' })
  const email = String(req.query.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'email 파라미터가 필요합니다.' })

  try {
    const total = await turso.execute({
      sql: 'SELECT COUNT(*) as total FROM hint_logs WHERE user_email = ?',
      args: [email]
    })
    const byStage = await turso.execute({
      sql: `SELECT stage_number, COUNT(*) as count
            FROM hint_logs WHERE user_email = ?
            GROUP BY stage_number ORDER BY stage_number`,
      args: [email]
    })
    res.json({
      email,
      totalHints: Number(total.rows[0].total),
      byStage: byStage.rows
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`[AI] listening on :${PORT}`)
  console.log(`[AI] groq model=${GROQ_MODEL} key=${GROQ_API_KEY ? '✅' : '❌ 미설정'}`)
  console.log(`[AI] turso=${turso ? 'connected' : 'disabled'}`)
})

function logHintToTurso(gameId, stageNumber, hintLevel, userEmail) {
  if (!turso) return
  turso.execute({
    sql: 'INSERT INTO hint_logs (game_id, stage_number, hint_level, user_email) VALUES (?, ?, ?, ?)',
    args: [gameId, stageNumber, hintLevel, userEmail ?? null]
  }).catch(err => console.warn('[turso] 힌트 로그 저장 실패:', err.message))
}

function validateHintRequest(body) {
  const gameId = String(body?.gameId || '').trim()
  const question = String(body?.question || '').trim()
  const history = Array.isArray(body?.history) ? body.history : []
  const maxHintLevel = Math.min(Number(body?.maxHintLevel || 3), 3)
  const userEmail = body?.userEmail ? String(body.userEmail).trim().toLowerCase() : null

  if (!gameId) throw httpError(400, 'gameId가 필요합니다.')
  if (!question) throw httpError(400, 'question이 필요합니다.')

  return {
    gameId,
    question,
    history: history
      .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
      .map(item => ({
        role: item.role,
        content: String(item.content || '').slice(0, 800)
      }))
      .slice(-8),
    maxHintLevel,
    userEmail
  }
}

async function loadGameKnowledge(gameId) {
  if (firestore) {
    try {
      const snap = await firestore.collection('gameKnowledge').doc(gameId).get()
      if (snap.exists) return snap.data()
    } catch (err) {
      console.warn('[firebase] gameKnowledge 조회 실패, seed fallback 사용:', err.message)
    }
  }
  const fallback = SEED_KNOWLEDGE[gameId]
  if (!fallback) throw httpError(404, '등록된 게임 지식이 없습니다.')
  return fallback
}

function findStage(knowledge, question, history) {
  const stages = Array.isArray(knowledge.stages) ? knowledge.stages : []
  if (!stages.length) return null
  return inferRelevantStage(stages, question, history)
}

function decideHintLevel(knowledge, stage, question, history, maxHintLevel) {
  const stages = Array.isArray(knowledge.stages) ? knowledge.stages : []
  const items = getConversationBeforeCurrent(history)

  if (!stage) {
    const similar = items
      .filter(m => m.role === 'user')
      .filter(m => similarity(question, m.content) >= 0.4)
    return Math.min(similar.length + 1, maxHintLevel, 3)
  }

  // 같은 스테이지에 대한 어시스턴트 응답 횟수로 힌트 단계 결정
  // → 다른 스테이지 질문 후 돌아오면 해당 스테이지의 카운트만 사용
  let hintCount = 0
  let lastUserIsThisStage = false

  for (const msg of items) {
    if (msg.role === 'user') {
      const userStage = inferRelevantStage(stages, msg.content, [])
      if (userStage !== null && Number(userStage.number) === Number(stage.number)) {
        lastUserIsThisStage = true
      } else {
        hintCount = 0
        lastUserIsThisStage = false
      }
    } else if (msg.role === 'assistant') {
      if (lastUserIsThisStage) hintCount++
      lastUserIsThisStage = false
    }
  }

  return Math.min(hintCount + 1, maxHintLevel, 3)
}

function getConversationBeforeCurrent(history) {
  if (!history?.length) return []
  if (history.at(-1)?.role === 'user') return history.slice(0, -1)
  return [...history]
}

function similarity(a, b) {
  const aTokens = new Set(tokenize(a))
  const bTokens = new Set(tokenize(b))
  if (!aTokens.size || !bTokens.size) return 0

  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1
  }
  return overlap / Math.max(aTokens.size, bTokens.size)
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^가-힣a-z0-9\s]/g, ' ')
    .split(/\s+/)
    // 한글자 토큰은 대부분 노이즈지만, "2단계"처럼 숫자 하나로 스테이지를 지칭하는
    // 경우가 있어 숫자 토큰만 예외적으로 살려둔다
    .filter(token => token.length > 1 || /^[0-9]+$/.test(token))
}

async function askGroq({ payload, knowledge, stage, hintLevel }) {
  if (!GROQ_API_KEY) throw httpError(500, 'GROQ_API_KEY가 설정되지 않았습니다.')

  const system = buildSystemPrompt({ knowledge, stage, hintLevel })
  const messages = [
    { role: 'system', content: system },
    ...getPromptHistory(payload.history, payload.question).slice(-6),
    { role: 'user', content: payload.question }
  ]

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.55,
      max_tokens: 512,
      top_p: 0.9
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw httpError(502, `Groq 응답 오류: ${detail}`)
  }

  const data = await response.json()
  const answer = data?.choices?.[0]?.message?.content?.trim()
  if (!answer) throw httpError(502, 'Groq가 빈 응답을 반환했습니다.')
  return answer
}

function buildSystemPrompt({ knowledge, stage, hintLevel }) {
  const levelInstruction = {
    1: '안내 수준 1: 확인해야 할 위치나 방향만 알려주세요. 구체적인 풀이 방법, 조작 방법, 암호, 최종 행동은 말하지 마세요.',
    2: '안내 수준 2: 관련 단서를 구체화하세요. 마지막 행동이나 최종 입력값은 직원이 스스로 찾게 남겨두세요.',
    3: '안내 수준 3: 최종 행동 직전까지 안내하세요. 그래도 정확한 암호 문자열이나 최종 입력값은 직접 말하지 마세요.'
  }[hintLevel]

  const currentStageBlock = stage
    ? `${stage.number || ''}번 업무: ${stage.title || ''}`
    : '미확인 — 질문만으로는 어느 업무인지 아직 확정하지 못했습니다.'

  // 스테이지 매칭에 실패했을 때도 LLM이 완전히 맨손이 되지 않도록,
  // 정답/풀이는 빼고 전체 업무 목록(제목+단서어)만 넘겨 스스로 가장 가까운 업무를 짚거나
  // 되물을 수 있게 한다
  const stageInfoBlock = stage
    ? formatStageContent(stage.content, hintLevel)
    : `아래 [전체 업무 목록]을 참고해 질문 속 화면/단어와 가장 가까운 업무를 먼저 짚어 안내하세요. 정말 판단할 단서가 없으면 어느 화면(메일, 탭, 팝업 등)에 있는지 되물어보세요.

[전체 업무 목록]
${formatStageOverview(knowledge.stages)}`

  const hintsBlock = stage ? formatHints(stage.hints, hintLevel) : '없음 (업무가 아직 특정되지 않음)'

  return `당신은 EGCompany 시설의 익명 보안 관리 담당자입니다.
상대방은 오늘 처음 출근한 신입 보안 관리자로, 업무를 진행하다 막혀 도움을 요청하고 있습니다.
시설 내부 직원답게 차분하고 정확한 말투로 안내하세요.

[절대 사용 금지 표현] 방탈출, 게임, 퍼즐, 정답, 힌트
대신 다음처럼 표현하세요: '업무 절차', '시스템 안내', '확인 사항', '다음 단계'

[시설]
${knowledge.title || 'EGCompany'}

[현재 담당 업무 구간]
${currentStageBlock}

[해당 구간 업무 정보]
${stageInfoBlock}

[안내 가능한 내용 — 이 범위를 절대 넘지 마세요]
${hintsBlock}

[안내 수준]
${levelInstruction}

[반드시 지킬 규칙]
1. 한국어로 답변하세요.
2. 최종 암호나 정답을 직접 제공하지 마세요.
3. 주어진 정보에 없는 풀이 내용을 지어내거나 앞질러 말하지 마세요.
4. 3~5문장으로 간결하게 안내하세요.
5. 업무와 전혀 관련 없는 질문(사적 대화, 다른 주제)일 때만 "해당 업무 관련 문의만 처리 가능합니다"라고 답하세요. 업무 질문에는 이 문구를 쓰지 마세요.
6. '단계', '안내 수준' 같은 내부 표현이나 번호를 답변에 언급하지 마세요.
7. 확신할 수 없는 내용은 추측하지 말고 확인해야 할 위치를 안내하세요.
8. 질문이 모호하면 언급된 화면 단서로 가장 가까운 업무 구간을 먼저 짚어주세요.`
}

// 레벨 3 미만에서는 풀이 정보([목표]/[정답])가 담긴 content를 프롬프트에서 제외해
// 모델이 낮은 단계에서 정답을 노출할 수 없게 한다
function formatStageContent(content, hintLevel) {
  if (hintLevel >= 3) return content || '등록된 구간 정보가 없습니다.'
  return '아래 [안내 가능한 내용]만 참고해 안내하세요.'
}

// 정답/풀이 없이 제목과 단서어만 노출하는 전체 업무 개요 (라우팅 실패 시 폴백용)
function formatStageOverview(stages) {
  if (!Array.isArray(stages) || !stages.length) return '등록된 업무 목록이 없습니다.'
  return stages
    .slice()
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map(s => {
      const keywords = (s.keywords || []).slice(0, 6).join(', ')
      return `${s.number}. ${s.title}${keywords ? ` (관련 단서: ${keywords})` : ''}`
    })
    .join('\n')
}

// 현재 hintLevel 이하의 힌트만 프롬프트에 포함한다
function formatHints(hints, maxLevel = 3) {
  if (!hints || typeof hints !== 'object') return '없음'
  const entries = Object.entries(hints)
    .filter(([level]) => Number(level) <= maxLevel)
    .sort(([a], [b]) => Number(a) - Number(b))
  if (!entries.length) return '없음'
  return entries
    .map(([level, text]) => `- ${text}`)
    .join('\n')
}

function inferRelevantStage(stages, question, history = []) {
  const currentMatch = pickConfidentStage(rankStages(stages, question))
  if (currentMatch) return currentMatch

  const recentUserText = getPreviousUserTurns(history, question)
    .slice(-2)
    .map(item => item.content)
    .join(' ')
  return pickConfidentStage(rankStages(stages, `${question} ${recentUserText}`.trim()))
}

// 최고 점수가 0점이거나, 1위와 2위가 동점이면(=배열 순서에 따라 우연히 앞선 스테이지가
// 뽑힌 것일 뿐 근거가 명확하지 않음) 억지로 하나를 고르지 않고 null(미확정)을 반환한다
function pickConfidentStage(ranked) {
  const [first, second] = ranked
  if (!first || first.score <= 0) return null
  if (second && second.score === first.score) return null
  return first.stage
}

function rankStages(stages, query) {
  const tokens = tokenize(query)
  return stages
    .map(stage => ({
      stage,
      score: scoreStage(stage, tokens, query)
    }))
    .sort((a, b) => b.score - a.score)
}

function scoreStage(stage, tokens, query) {
  const title = String(stage.title || '').toLowerCase()
  const haystacks = [
    title,
    stage.content,
    ...(stage.keywords || [])
  ].map(value => String(value || '').toLowerCase())

  // "정육면체가", "미로를"처럼 키워드/제목 단어에 조사가 바로 붙는 경우
  // haystack.includes(token) 방향만으로는 못 잡는다. keywords/제목만
  // 단어 단위로 쪼개 token.startsWith(word)로도 추가 확인한다
  // (content는 일반 서술문이라 단어 단위로 쪼개면 다른 스테이지와
  //  겹치는 흔한 단어가 너무 많아져 노이즈가 커지므로 제외)
  const keywordWords = new Set()
  for (const value of [title, ...(stage.keywords || [])]) {
    for (const word of String(value || '').toLowerCase().split(/\s+/)) {
      if (word.length > 1) keywordWords.add(word)
    }
  }

  let score = 0
  if (hasStageNumberSignal(query, stage.number)) score += 30

  for (const token of tokens) {
    let matched = false
    for (const haystack of haystacks) {
      if (haystack.includes(token)) {
        score += haystack === title ? 2 : 1
        matched = true
        break
      }
    }
    if (!matched) {
      for (const word of keywordWords) {
        if (token.startsWith(word)) {
          score += 1
          break
        }
      }
    }
  }

  for (const rule of STAGE_MATCH_RULES) {
    if (rule.patterns.some(pattern => pattern.test(query))) {
      score += Number(stage.number) === rule.stageNumber ? rule.weight : 0
    }
  }

  return score
}

function hasStageNumberSignal(query, stageNumber) {
  const escaped = String(stageNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`${escaped}\\s*번`, 'i'),
    new RegExp(`${escaped}\\s*번째`, 'i'),
    new RegExp(`${escaped}\\s*단계`, 'i'),
    new RegExp(`stage\\s*${escaped}`, 'i'),
    new RegExp(`스테이지\\s*${escaped}`, 'i'),
    new RegExp(`문제\\s*${escaped}`, 'i')
  ]
  return patterns.some(pattern => pattern.test(query))
}

function toMatchedStage(stage) {
  if (!stage) return null
  return {
    id: stage.id,
    number: stage.number,
    title: stage.title
  }
}

function getPreviousUserTurns(history, currentQuestion) {
  return getConversationBeforeCurrent(history).filter(m => m.role === 'user')
}

function getPromptHistory(history, currentQuestion) {
  const normalizedCurrent = normalizeText(currentQuestion)
  const items = [...(history || [])]
  if (items.length && items.at(-1)?.role === 'user' && normalizeText(items.at(-1)?.content) === normalizedCurrent) {
    return items.slice(0, -1)
  }
  return items
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// docx 기반으로 업데이트된 단계 매칭 규칙
// 게임이 실제로 쓰는 단어(정육면체, WESEN 등) 외에, 사용자가 자기 표현으로 바꿔 말하는
// 흔한 동의어/의역도 추가로 인식하도록 확장했다 (예: 큐브 → "상자", "네모난 거")
const STAGE_MATCH_RULES = [
  {
    stageNumber: 1,
    weight: 8,
    patterns: [/회원가입|가입|계정\s*생성|로그인|관리자\s*테스트|테스트\s*문항|문항|규칙|서명|동의|o\/x|ox|오\s*엑스|보안\s*규정|행동\s*강령|접근\s*테스트|보안\s*터미널|터미널\s*진입|아니오|예예/i]
  },
  {
    stageNumber: 2,
    weight: 8,
    patterns: [/wesen|위센|웨센|개체|아카이브|archive|업무\s*요청|운송|수송|수송팀|캐나다|found|아이콘|핀|4마리|4개|개체\s*목록|개체\s*선택/i]
  },
  {
    stageNumber: 3,
    weight: 8,
    patterns: [/큐브|정육면체|cube|상자|박스|네모|긴급|파란\s*버튼|4초|hold|홀드|길게\s*누르|누르고\s*있|회전|돌리|마주\s*보|반대\s*편|dr\.?g|닥터\s*지|박사|회사소개|trace|observation|볼드/i]
  },
  {
    stageNumber: 4,
    weight: 8,
    patterns: [/뉴스|기사|사진|이미지|썸네일|회색\s*박스|드래그|숨겨진|로마\s*숫자|raomtni|error|signal|source|pattern|network|암호\s*해독|코드\s*해독|글자\s*조합/i]
  },
  {
    stageNumber: 5,
    weight: 8,
    patterns: [/stop|s\s*t\s*o\s*p|알파벳|글자\s*찾기|순서대로|숨겨진\s*글자|클리어|엔딩|의문의\s*페이지/i]
  }
]


function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

const requestBuckets = new Map()

function rateLimit(req, res, next) {
  if (req.path === '/health') {
    next()
    return
  }

  const now = Date.now()
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown'
  const bucket = requestBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }

  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS
  }

  bucket.count += 1
  requestBuckets.set(key, bucket)

  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' })
    return
  }

  next()
}

// Firebase 없을 때 사용하는 로컬 fallback 지식베이스
const SEED_KNOWLEDGE = {
  egcompany: {
    gameId: 'egcompany',
    title: 'EGCompany',
    stages: [
      {
        number: 1, title: '1번 업무: 관리자 인증', difficulty: '쉬움',
        keywords: ['회원가입', '가입', '계정', '로그인', '관리자 테스트', '테스트 문항', '문항', '규칙', '서명', '동의', 'O/X', 'OX', '오엑스', '보안 규정', '행동 강령', '접근 테스트', '보안 터미널', '터미널', '아니오', '예'],
        content: '[목표] 관리자 접근 테스트를 통과해 보안 터미널로 진입하기.\n[정답] 1번: 아니오, 2~5번: 예.',
        hints: { 1: '규칙 페이지 Notice 영역의 서명 버튼을 눌러 관리자 테스트를 시작하세요.', 2: '보안팀이 허가하지 않은 행동을 묻는 1번 문항만 아니오, 나머지는 예입니다.', 3: '정답 순서: 아니오, 예, 예, 예, 예. 통과하면 보안 터미널로 이동합니다.' }
      },
      {
        number: 2, title: '2번 업무: 개체 수송 업무', difficulty: '보통',
        keywords: ['WESEN', '위센', '웨센', '아카이브', 'ARCHIVE', '개체', '개체 목록', '4개', '4마리', '캐나다', '수송', '수송팀', 'FoUnd', '아이콘', '핀', '선택'],
        content: '[목표] 캐나다 지부 개체 4마리 선택.\n[정답] WESEN-783, WESEN-106, WESEN-9428, WESEN-0101.',
        hints: { 1: '수송팀 메일 확인 후 아카이브 탭으로 이동해 각 개체의 현재 위치를 확인하세요.', 2: '8개 개체 중 현재 위치가 캐나다인 개체 4마리만 선택해야 합니다.', 3: '캐나다 위치 개체: WESEN-783, WESEN-106, WESEN-9428, WESEN-0101. 아이콘 핀을 클릭해 제출하세요.' }
      },
      {
        number: 3, title: '3번 업무: 긴급 탈출 대응 (정육면체)', difficulty: '어려움',
        keywords: ['정육면체', '큐브', '상자', '박스', '네모', '회전', '돌리기', '길게 누르기', '홀드', 'Trace', 'Observation', '반대', '반대편', '4초', 'Dr.G', '닥터지', '박사', '회사소개', '볼드'],
        content: '[목표] Observation 반대편 면 Trace를 4초 이상 클릭.\n[단서] "진실은 언제나 관찰의 반대편에 있다."',
        hints: { 1: '긴급 메일 하단 파란 버튼을 눌러 정육면체 팝업을 열고 Dr.G 단서를 확인하세요.', 2: '회사소개 탭에서 Dr.G 소개글 맨 아래 볼드 문구를 찾아보세요.', 3: 'Observation의 정반대 면인 Trace를 4초 이상 누르고 있으면 통과됩니다.' }
      },
      {
        number: 4, title: '4번 업무: 암호 해독', difficulty: '어려움',
        keywords: ['뉴스', '기사', '사진', '이미지', '썸네일', '회색 박스', '드래그', '로마 숫자', '암호 해독', '코드', 'RAOMTNI'],
        content: '[목표] 숨겨진 문구에서 로마 숫자 규칙으로 암호 해독.\n[정답] RAOMTNI.',
        hints: { 1: '의문의 메일 첨부 사진이 뉴스 탭 마지막 기사 사진과 동일합니다.', 2: '해당 뉴스 상세 페이지 하단 회색 박스를 드래그하면 숨겨진 문구가 보입니다.', 3: '대문자 단어 뒤 로마 숫자 위치의 글자를 순서대로 나열하면 RAOMTNI입니다.' }
      },
      {
        number: 5, title: '5번 업무: 엔딩 — 알파벳 순서 클릭', difficulty: '보통',
        keywords: ['암호 입력', 'STOP', 'S T O P', '알파벳', '글자 찾기', '순서', '의문의 페이지', '숨겨진 글자', '엔딩', '영상', '클리어'],
        content: '[목표] 의문의 페이지 화면 곳곳에 흩어진 S, T, O, P 글자를 찾아 반드시 이 순서대로 클릭하기.\n[정답] S → T → O → P 순서 고정. 순서가 틀리면 통과되지 않음.',
        hints: { 1: '암호 입력에 성공하면 이동하는 새 화면을 잘 살펴보세요. 화면 곳곳에 평소와 다른 글자가 숨어 있습니다.', 2: '화면에 흩어진 알파벳 중 S, T, O, P 네 글자를 찾아보세요. 순서대로 눌러야 하는 장치입니다.', 3: 'S → T → O → P 순서대로 정확히 클릭하면 통과되어 엔딩 영상이 재생됩니다.' }
      }
    ]
  }
}
