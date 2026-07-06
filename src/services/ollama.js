import { buildSystemPrompt } from './retrieval.js'

const OLLAMA_BASE = 'http://localhost:11434'
export const DEFAULT_MODEL = 'exaone3.5:2.4b'

/**
 * Ollama 서버 연결 상태 확인
 * @returns {Promise<{ok: boolean, models: string[]}>}
 */
export async function checkOllamaStatus() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, models: [] }
    const data = await res.json()
    const models = (data.models || []).map(m => m.name)
    return { ok: true, models }
  } catch {
    return { ok: false, models: [] }
  }
}

/**
 * Ollama 스트리밍 채팅 요청
 * @param {object} params
 * @param {string}   params.query        - 사용자 질문
 * @param {number}   params.activeStage  - 현재 스테이지 번호
 * @param {number}   params.hintLevel    - 힌트 레벨 (1/2/3)
 * @param {Array}    params.history      - 이전 대화 [{role, content}]
 * @param {string}   params.model        - Ollama 모델명
 * @param {Function} params.onToken      - 스트리밍 콜백 (token: string) => void
 * @param {AbortSignal} params.signal    - 취소 신호
 * @returns {Promise<string>}            - 전체 응답 텍스트
 */
export async function streamHint({
  query,
  activeStage,
  hintLevel   = 1,
  history     = [],
  model,
  onToken,
  signal
}) {
  // 설정에서 모델 가져오기 (없으면 기본값)
  const modelName = model || DEFAULT_MODEL

  // 시스템 프롬프트 (RAG 컨텍스트 포함)
  const systemPrompt = await buildSystemPrompt(query, activeStage, hintLevel)

  // 메시지 구성: system + 이전 대화 + 현재 질문
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),   // 최근 6개 메시지만 포함 (컨텍스트 크기 제한)
    { role: 'user', content: query }
  ]

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    modelName,
      messages,
      stream:   true,
      options: {
        temperature: 0.7,
        top_p:       0.9,
        num_ctx:     2048
      }
    }),
    signal
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ollama 오류 (${res.status}): ${err}`)
  }

  // 스트리밍 읽기
  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let fullText  = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value, { stream: true }).split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json  = JSON.parse(line)
        const token = json?.message?.content || ''
        if (token) {
          fullText += token
          onToken?.(token)
        }
        if (json.done) break
      } catch {
        // 불완전한 JSON 라인 무시
      }
    }
  }

  return fullText
}

/**
 * 모델 pull (처음 사용 시)
 * @param {string} modelName
 * @param {Function} onProgress - (status: string) => void
 */
export async function pullModel(modelName, onProgress) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  })

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value, { stream: true }).split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line)
        onProgress?.(json.status || '')
      } catch {}
    }
  }
}
