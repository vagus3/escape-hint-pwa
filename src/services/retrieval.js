import { getAllChunks } from './knowledge.js'

/**
 * 로컬 RAG (임베딩 없이 키워드 기반)
 *
 * 전략:
 *  1. 현재 선택된 stageNumber의 청크는 가중치 +5 (최우선)
 *  2. 세계관(world) 청크는 항상 포함
 *  3. 사용자 질문의 키워드와 청크 keywords[] 교집합으로 점수 계산
 *  4. 상위 N개 청크만 선택하여 컨텍스트 크기 제한
 */

/**
 * 질문 텍스트에서 의미 있는 토큰 추출
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
}

/**
 * 청크 관련도 점수 계산
 * @param {object} chunk
 * @param {string[]} queryTokens
 * @param {number|null} activeStage
 * @returns {number}
 */
function scoreChunk(chunk, queryTokens, activeStage) {
  let score = 0

  // 현재 문제 스테이지 우선
  if (chunk.stageNumber === activeStage) score += 5

  // 세계관 청크는 항상 포함
  if (chunk.type === 'world') score += 2

  // keywords 배열과의 매칭
  const chunkKeywords = (chunk.keywords || []).map(k => k.toLowerCase())
  for (const token of queryTokens) {
    for (const kw of chunkKeywords) {
      if (kw.includes(token) || token.includes(kw)) {
        score += 1
        break
      }
    }
  }

  // 본문 content와의 매칭 (가중치 낮게)
  const contentLower = (chunk.content || chunk.title || '').toLowerCase()
  for (const token of queryTokens) {
    if (contentLower.includes(token)) score += 0.3
  }

  return score
}

/**
 * 질문에 관련된 청크를 가져와 컨텍스트 문자열로 반환
 * @param {string} query - 사용자 질문
 * @param {number|null} activeStage - 현재 선택된 문제 번호
 * @param {number} maxChunks - 최대 청크 수
 * @returns {Promise<string>}
 */
export async function retrieveContext(query, activeStage, maxChunks = 4) {
  const chunks      = await getAllChunks()
  const queryTokens = tokenize(query)

  // 각 청크 점수 계산
  const scored = chunks.map(chunk => ({
    chunk,
    score: scoreChunk(chunk, queryTokens, activeStage)
  }))

  // 점수 높은 순 정렬, 상위 N개 선택
  const selected = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .map(s => s.chunk)

  // 컨텍스트 문자열로 직렬화
  return selected
    .map(chunk => `### ${chunk.title}\n${chunk.content}`)
    .join('\n\n---\n\n')
}

/**
 * 힌트 레벨별 지시문
 */
export const HINT_LEVEL_INSTRUCTIONS = {
  1: '힌트 강도: 소 (방향만 살짝 알려주기). 정답이나 구체적인 방법은 절대 말하지 마세요. 플레이어 스스로 생각할 여지를 많이 남겨두세요.',
  2: '힌트 강도: 중 (구체적인 단서 제공). 정답 직전까지 안내하되, 마지막 한 단계는 플레이어가 스스로 찾도록 남겨두세요.',
  3: '힌트 강도: 대 (거의 다 알려주기). 정답은 직접 말하지 않지만, 그 직전 단계까지 아주 구체적으로 설명해주세요.'
}

/**
 * Ollama에 보낼 전체 시스템 프롬프트 생성
 */
export async function buildSystemPrompt(query, activeStage, hintLevel) {
  const context  = await retrieveContext(query, activeStage, 4)
  const levelMsg = HINT_LEVEL_INSTRUCTIONS[hintLevel] || HINT_LEVEL_INSTRUCTIONS[1]

  return `당신은 EGCompany 방탈출 게임의 AI 힌트 도우미입니다.
플레이어가 막혔을 때 힌트를 제공하는 역할을 합니다.

[현재 플레이어 상황]
- 현재 문제: ${activeStage ? `${activeStage}번 문제` : '미선택'}
- ${levelMsg}

[게임 지식 베이스]
${context}

[규칙]
1. 절대 정답을 직접 말하지 마세요.
2. 게임 세계관을 유지하세요 (EGCompany 직원 어투 가능).
3. 게임과 관련 없는 질문에는 "게임 관련 질문만 답변할 수 있습니다"라고 하세요.
4. 한국어로 답변하세요.
5. 답변은 3-5문장 이내로 간결하게 하세요.`
}
