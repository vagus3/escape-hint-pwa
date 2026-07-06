import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        runtimeCaching: [
          {
            // AI 힌트 API는 캐시하지 않음
            urlPattern: /^https:\/\/.*\/api\/hints/,
            handler: 'NetworkOnly'
          },
          {
            // 로컬 개발용 Ollama API도 캐시하지 않음
            urlPattern: /^http:\/\/localhost:11434/,
            handler: 'NetworkOnly'
          }
        ]
      },
      manifest: {
        name: 'ERG AI 힌트',
        short_name: 'ERG 힌트',
        description: '온라인 방탈출 테스트용 AI 힌트 도우미',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
