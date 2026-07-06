import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './react/App.jsx'
import './styles/theme.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
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
