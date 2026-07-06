import { registerSW } from 'virtual:pwa-register'
import { seedIfEmpty }  from './services/knowledge.js'
import { HintPage }     from './pages/hint-page.js'
import { AdminPage }    from './pages/admin-page.js'

// ── PWA 서비스 워커 등록 ──
registerSW({
  onNeedRefresh()  { showToast('새 버전이 있습니다. 새로고침하세요.') },
  onOfflineReady() { showToast('오프라인 모드 준비 완료 ✓') }
})

// ── Toast 알림 ──
export function showToast(msg, duration = 3000) {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const toast = document.createElement('div')
  toast.className  = 'toast'
  toast.textContent = msg
  container.appendChild(toast)
  setTimeout(() => toast.remove(), duration)
}

// ── SPA 라우터 ──
const app    = document.getElementById('app')
let _current = null

function render(pageName) {
  _current?._cleanup?.()
  app.innerHTML = ''
  const page = pageName === 'admin' ? AdminPage() : HintPage()
  app.appendChild(page)
  _current = page
}

window.addEventListener('navigate', e => render(e.detail))

// ── 앱 초기화 ──
async function init() {
  // IndexedDB 시드 데이터 주입 (최초 실행 시만)
  await seedIfEmpty()
  // 힌트 페이지 렌더
  render('hint')
}

init().catch(err => {
  console.error('초기화 오류:', err)
  document.getElementById('app').innerHTML =
    `<div style="padding:40px;color:var(--danger);">초기화 오류: ${err.message}</div>`
})
