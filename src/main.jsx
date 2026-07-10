import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './react/App.jsx'
import './styles/theme.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // 새 버전 서비스워커가 제어권을 잡으면 즉시 새로고침해서 항상 최신 화면을 보여준다.
  // 이 코드가 없으면 배포 후에도 사용자는 다음 방문 때까지 캐시된 옛 화면을 보게 된다.
  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload()
    hadController = true
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        registration.update().catch(() => {})
        window.dispatchEvent(new CustomEvent('app-toast', { detail: '오프라인 모드 준비 완료' }))
      })
      .catch(error => {
        console.warn('[PWA] service worker registration failed:', error)
      })
  })
}

createRoot(document.getElementById('app')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
