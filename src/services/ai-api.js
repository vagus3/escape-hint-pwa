const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'https://escape-hint-pwa.onrender.com'

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

let warmUpPromise = null

// Render 등 유휴 시 슬립되는 플랫폼은 첫 요청에 콜드 스타트(약 10~15초)가 걸린다.
// 앱 진입 시점(질문을 입력하기 전)에 미리 /health를 호출해 서버를 깨워두면
// 실제 힌트 요청 시 대기 시간을 없앨 수 있다. 실패해도 무시 — 실제 요청이 재시도 역할을 한다.
export function warmUpAiServer() {
  if (!AI_API_URL) return null
  if (warmUpPromise) return warmUpPromise

  warmUpPromise = fetch(`${AI_API_URL.replace(/\/$/, '')}/health`, {
    signal: AbortSignal.timeout(30_000)
  })
    .catch(() => {})
    .finally(() => {
      warmUpPromise = null
    })

  return warmUpPromise
}

// 어느 업무(스테이지)에 대한 질문인지 판단하는 로직은 서버(AI 지식/힌트를 실제로
// 갖고 있는 쪽)에만 존재한다. 클라이언트는 질문과 대화 기록만 보내고 결과를 그대로 신뢰한다.
export async function requestHint({ game, question, history, signal }) {
  const res = await fetch(`${AI_API_URL.replace(/\/$/, '')}/api/hints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: game.id,
      gameTitle: game.title,
      question,
      history,
      maxHintLevel: 3,
      userEmail: getUserEmail()
    }),
    signal
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `AI API 오류: ${res.status}`)
  }

  return res.json()
}
