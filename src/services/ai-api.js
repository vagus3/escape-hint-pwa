const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'https://escape-hint-pwa.onrender.com'
const OLLAMA_BASE_URL = import.meta.env.VITE_OLLAMA_BASE_URL || 'http://localhost:11434'
export const DEFAULT_MODEL = 'exaone3.5:2.4b'

const USER_EMAIL_KEY = 'erg_user_email'

export function getUserEmail() {
  return localStorage.getItem(USER_EMAIL_KEY) || null
}

export function setUserEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (normalized) localStorage.setItem(USER_EMAIL_KEY, normalized)
  else localStorage.removeItem(USER_EMAIL_KEY)
}

// URL 파라미터 ?email= 로 자동 설정 (회원가입 이메일 링크 클릭 시)
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  const emailParam = params.get('email')
  if (emailParam) setUserEmail(emailParam)
}

export async function requestHint({ game, question, history, signal }) {
  const matchedStage = inferRelevantStage({ game, question, history })

  if (!AI_API_URL) {
    try {
      return await requestLocalOllama({ game, stage: matchedStage, question, history, signal })
    } catch (error) {
      console.warn('[ai-api] 로컬 Ollama 요청 실패, fallback 힌트 사용:', error)
      return buildLocalFallback({ game, stage: matchedStage, question, history })
    }
  }

  const res = await fetch(`${AI_API_URL.replace(/\/$/, '')}/api/hints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: game.id,
      gameTitle: game.title,
      stageNumber: matchedStage?.number ?? null,
      question,
      history,
      maxHintLevel: 3,
      model: DEFAULT_MODEL,
      userEmail: getUserEmail()
    }),
    signal
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `AI API 오류: ${res.status}`)
  }

  const result = await res.json()
  return {
    ...result,
    matchedStage: result.matchedStage || toMatchedStage(matchedStage)
  }
}

async function requestLocalOllama({ game, stage, question, history, signal }) {
  const hintLevel = estimateHintLevel({ game, stage, question, history })
  const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: buildLocalSystemPrompt({ game, stage, hintLevel }) },
        ...getPromptHistory(history, question).slice(-6).map(item => ({
          role: item.role,
          content: String(item.content || '').slice(0, 800)
        })),
        { role: 'user', content: question }
      ],
      stream: false,
      options: {
        temperature: 0.55,
        top_p: 0.9,
        num_ctx: 4096
      }
    }),
    signal: signal || AbortSignal.timeout(20_000)
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `Ollama 오류: ${res.status}`)
  }

  const data = await res.json()
  const answer = data?.message?.content?.trim()
  if (!answer) throw new Error('Ollama가 빈 응답을 반환했습니다.')

  return {
    hintLevel,
    answer,
    model: DEFAULT_MODEL,
    matchedStage: toMatchedStage(stage),
    source: 'local-ollama'
  }
}

function estimateHintLevel({ game, stage, question, history }) {
  const items = getConversationBeforeCurrent(history)

  if (!stage) {
    const similar = items
      .filter(m => m.role === 'user')
      .filter(m => similarity(question, m.content) >= 0.4)
    return Math.min(similar.length + 1, 3)
  }

  // 같은 스테이지에 대해 어시스턴트가 몇 번 응답했는지 카운트
  // → 스테이지 전환 시 자동으로 0에서 시작
  let hintCount = 0
  let lastUserIsThisStage = false

  for (const msg of items) {
    if (msg.role === 'user') {
      const userStage = inferRelevantStage({ game, question: msg.content, history: [] })
      if (userStage !== null && Number(userStage.number) === Number(stage.number)) {
        lastUserIsThisStage = true
      } else {
        // 다른 스테이지 질문 → 카운트 초기화
        hintCount = 0
        lastUserIsThisStage = false
      }
    } else if (msg.role === 'assistant') {
      if (lastUserIsThisStage) hintCount++
      lastUserIsThisStage = false
    }
  }

  return Math.min(hintCount + 1, 3)
}

function getConversationBeforeCurrent(history) {
  if (!history?.length) return []
  // submitQuestion이 항상 현재 질문을 history 맨 끝에 추가하므로 마지막 user 항목을 제거
  if (history.at(-1)?.role === 'user') return history.slice(0, -1)
  return [...history]
}

function buildLocalFallback({ stage, history, question, game }) {
  const hintLevel = estimateHintLevel({ game, stage, question, history })
  const hint = stage?.hints?.[hintLevel] || '현재 문제의 단서를 다시 관찰해보세요. 비슷한 패턴이나 반복되는 표현이 힌트일 수 있습니다.'

  return {
    hintLevel,
    answer: hint,
    matchedStage: toMatchedStage(stage),
    source: 'local-fallback'
  }
}

function buildLocalSystemPrompt({ game, stage, hintLevel }) {
  const levelInstruction = {
    1: '안내 수준 1: 확인해야 할 위치나 방향만 알려주세요. 구체적인 풀이 방법, 암호, 최종 행동은 말하지 마세요.',
    2: '안내 수준 2: 관련 단서를 구체화하세요. 마지막 행동이나 최종 입력값은 직원이 스스로 찾게 남겨두세요.',
    3: '안내 수준 3: 최종 행동 직전까지 안내하세요. 정확한 암호 문자열이나 최종 입력값은 직접 말하지 마세요.'
  }[hintLevel] || '안내 수준 1: 확인해야 할 위치나 방향만 알려주세요.'

  return `당신은 EGCompany 시설의 익명 보안 관리 담당자입니다.
상대방은 오늘 처음 출근한 신입 보안 관리자로, 업무를 진행하다 막혀 도움을 요청하고 있습니다.
시설 내부 직원답게 차분하고 정확한 말투로 안내하세요.

[절대 사용 금지 표현] 방탈출, 게임, 퍼즐, 정답, 힌트
대신 다음처럼 표현하세요: '업무 절차', '시스템 안내', '확인 사항', '다음 단계'

[시설]
${game?.title || 'EGCompany'}

[전체 업무 흐름]
${formatGameFlow(game)}

[현재 담당 업무 구간]
${formatStage(stage)}

[단계별 안내 내용]
${formatHints(stage?.hints)}

[안내 수준]
${levelInstruction}

[규칙]
1. 한국어로 3~5문장만 답변하세요.
2. 최종 암호나 정답을 직접 말하지 마세요.
3. 업무와 무관한 질문에는 "해당 업무 관련 문의만 처리 가능합니다"라고 하세요.
4. 질문이 모호하면 언급된 화면 단서로 가장 가까운 업무 구간을 먼저 짚어주세요.
5. 확실하지 않은 내용은 추측하지 말고 확인해야 할 위치를 안내하세요.`
}

function formatGameFlow(game) {
  const stages = Array.isArray(game?.stages) ? game.stages : []
  if (!stages.length) return '등록된 구간 정보가 없습니다. 사용자의 화면 단서를 기준으로 관찰할 위치를 안내하세요.'

  return stages
    .map((stage, index) => {
      const number = stage.number || stage.stageNumber || index + 1
      const title = stage.title || `${number}번 구간`
      const keywords = (stage.keywords || []).slice(0, 8).join(', ')
      const summary = stage.content ? `\n   - 지식: ${String(stage.content).slice(0, 450)}` : ''
      const keywordLine = keywords ? `\n   - 단서어: ${keywords}` : ''
      return `${number}. ${title}${keywordLine}${summary}`
    })
    .join('\n')
}

function formatStage(stage) {
  if (!stage) return '선택된 문제가 없습니다.'
  return `${stage.number || ''}번: ${stage.title || '제목 없음'}
난이도: ${stage.difficulty || '보통'}
키워드: ${(stage.keywords || []).join(', ') || '없음'}
풀이 지식:
${stage.content || '등록된 지식이 없습니다.'}`
}

function formatHints(hints) {
  if (!hints || typeof hints !== 'object') return '없음'
  return Object.entries(hints)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, text]) => `- ${level}단계: ${text}`)
    .join('\n')
}

function inferRelevantStage({ game, question, history = [] }) {
  const stages = Array.isArray(game?.stages) ? game.stages : []
  if (!stages.length) return null

  const currentMatch = rankStages(stages, question)[0]
  if (currentMatch?.score > 0) return currentMatch.stage

  const recentUserText = getPreviousUserTurns(history, question)
    .slice(-2)
    .map(item => item.content)
    .join(' ')
  const contextMatch = rankStages(stages, `${question} ${recentUserText}`.trim())[0]
  return contextMatch?.score > 0 ? contextMatch.stage : null
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
  const haystacks = [
    stage.title,
    stage.content,
    ...(stage.keywords || [])
  ].map(value => String(value || '').toLowerCase())

  let score = 0

  if (hasStageNumberSignal(query, stage.number)) score += 30

  for (const token of tokens) {
    for (const haystack of haystacks) {
      if (haystack.includes(token)) {
        score += haystack === String(stage.title || '').toLowerCase() ? 2 : 1
        break
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
    new RegExp(`stage\\s*${escaped}`, 'i'),
    new RegExp(`스테이지\\s*${escaped}`, 'i'),
    new RegExp(`문제\\s*${escaped}`, 'i')
  ]
  return patterns.some(pattern => pattern.test(query))
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^가-힣a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1)
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

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

// docx 기반으로 업데이트된 단계 매칭 규칙
const STAGE_MATCH_RULES = [
  {
    stageNumber: 1,
    weight: 8,
    patterns: [/회원가입|로그인|관리자\s*테스트|규칙|서명|o\/x|ox|보안\s*규정|행동\s*강령|접근\s*테스트|아니오|예예/i]
  },
  {
    stageNumber: 2,
    weight: 8,
    patterns: [/wesen|개체|아카이브|archive|업무\s*요청|운송|수송|캐나다|found|아이콘|핀|4마리|4개/i]
  },
  {
    stageNumber: 3,
    weight: 8,
    patterns: [/큐브|정육면체|cube|긴급|파란\s*버튼|4초|hold|마주\s*보|반대\s*편|dr\.g|회사소개|trace|observation|볼드/i]
  },
  {
    stageNumber: 4,
    weight: 8,
    patterns: [/뉴스|기사|사진|회색\s*박스|드래그|숨겨진|로마\s*숫자|raomtni|error|signal|source|pattern|network/i]
  },
  {
    stageNumber: 5,
    weight: 8,
    patterns: [/미로|마우스|벽|시작점|완주|클리어|엔딩|영상|암호\s*입력|의문의\s*페이지/i]
  }
]
