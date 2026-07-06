import { streamHint, checkOllamaStatus } from '../services/ollama.js'
import { saveChatMessage, getChatHistory, clearChatHistory } from '../services/knowledge.js'
import { getSetting } from '../services/db.js'

const STAGE_LABELS = ['', '1번: 신규 가입자', '2번: 업무 이메일', '3번: 정육면체', '4번: 암호 해독', '5번: 최후의 추적자']
const DIFFICULTY   = ['', '🟢 쉬움', '🟡 보통', '🔴 어려움', '🔴 어려움', '🔴 매우 어려움']

export function HintPage() {
  // ── 상태 ──
  let activeStage  = 1
  let hintLevel    = 1
  let chatHistory  = []   // {role, content}
  let isLoading    = false
  let abortCtrl    = null
  let ollamaOk     = false
  let currentModel = 'gemma2:2b'

  // ── 루트 ──
  const root = document.createElement('div')
  root.style.cssText = 'display:flex;flex-direction:column;height:100vh;'

  root.innerHTML = `
    <!-- 헤더 -->
    <header style="display:flex;align-items:center;justify-content:space-between;
                   padding:12px 20px;border-bottom:1px solid var(--border);
                   background:var(--bg-secondary);">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">🔐</span>
        <span style="font-weight:600;letter-spacing:0.05em;font-size:13px;">EGCompany 힌트 AI</span>
        <span id="ollama-badge" class="badge" style="font-size:10px;"></span>
      </div>
      <button class="btn btn-ghost" id="admin-btn" style="font-size:11px;padding:5px 10px;">
        ⚙ 관리
      </button>
    </header>

    <!-- 문제 선택 -->
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-secondary);">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;letter-spacing:0.05em;">
        현재 문제 선택
      </div>
      <div id="stage-tabs" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
    </div>

    <!-- 힌트 레벨 + 정보 -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 16px;border-bottom:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-muted);">힌트 강도</span>
        <div id="level-tabs" style="display:flex;gap:4px;"></div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span id="difficulty-badge" class="badge"></span>
        <button class="btn btn-ghost" id="clear-btn"
                style="font-size:11px;padding:4px 8px;color:var(--text-muted);">
          🗑 초기화
        </button>
      </div>
    </div>

    <!-- 채팅 영역 -->
    <div id="chat-area" style="flex:1;overflow-y:auto;padding:16px;display:flex;
                               flex-direction:column;gap:12px;"></div>

    <!-- 입력 영역 -->
    <div style="padding:12px 16px;border-top:1px solid var(--border);background:var(--bg-secondary);">
      <div style="display:flex;gap:8px;">
        <input id="user-input" type="text" placeholder="막힌 부분을 질문하세요..."
               style="flex:1;" maxlength="200" />
        <button class="btn btn-primary" id="send-btn" style="white-space:nowrap;">
          전송
        </button>
        <button class="btn btn-ghost" id="stop-btn" style="display:none;">
          ⏹
        </button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">
        힌트 강도 1→정답 숨김 &nbsp;|&nbsp; 2→구체적 단서 &nbsp;|&nbsp; 3→거의 전부
      </div>
    </div>
  `

  // ── 요소 참조 ──
  const chatArea   = root.querySelector('#chat-area')
  const userInput  = root.querySelector('#user-input')
  const sendBtn    = root.querySelector('#send-btn')
  const stopBtn    = root.querySelector('#stop-btn')
  const clearBtn   = root.querySelector('#clear-btn')
  const adminBtn   = root.querySelector('#admin-btn')
  const stageTabs  = root.querySelector('#stage-tabs')
  const levelTabs  = root.querySelector('#level-tabs')
  const ollamaBadge= root.querySelector('#ollama-badge')
  const diffBadge  = root.querySelector('#difficulty-badge')

  // ── Ollama 상태 확인 ──
  async function checkStatus() {
    const { ok, models } = await checkOllamaStatus()
    ollamaOk = ok
    if (ok) {
      ollamaBadge.textContent  = '● 온라인'
      ollamaBadge.className    = 'badge badge-success'
    } else {
      ollamaBadge.textContent  = '● Ollama 오프라인'
      ollamaBadge.className    = 'badge badge-danger'
    }
    currentModel = await getSetting('model', 'gemma2:2b')
    return { ok, models }
  }

  // ── 문제 탭 렌더 ──
  function renderStageTabs() {
    stageTabs.innerHTML = ''
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button')
      btn.textContent = `${i}번`
      btn.className   = `btn ${i === activeStage ? 'btn-primary' : 'btn-ghost'}`
      btn.style.cssText = 'padding:4px 10px;font-size:11px;'
      btn.onclick = () => { activeStage = i; renderStageTabs(); loadHistory(); updateDiffBadge() }
      stageTabs.appendChild(btn)
    }
  }

  function updateDiffBadge() {
    diffBadge.textContent = DIFFICULTY[activeStage]
    diffBadge.className   = activeStage >= 3 ? 'badge badge-danger' : activeStage === 2 ? 'badge badge-warn' : 'badge badge-success'
  }

  // ── 레벨 탭 렌더 ──
  function renderLevelTabs() {
    levelTabs.innerHTML = ''
    const labels = ['소', '중', '대']
    for (let i = 1; i <= 3; i++) {
      const btn = document.createElement('button')
      btn.textContent = labels[i - 1]
      btn.className   = `btn ${i === hintLevel ? 'btn-primary' : 'btn-ghost'}`
      btn.style.cssText = 'padding:3px 10px;font-size:11px;'
      btn.onclick = () => { hintLevel = i; renderLevelTabs() }
      levelTabs.appendChild(btn)
    }
  }

  // ── 채팅 히스토리 로드 ──
  async function loadHistory() {
    chatHistory = []
    chatArea.innerHTML = ''

    const records = await getChatHistory(activeStage)
    if (records.length === 0) {
      appendSystemMsg(`${STAGE_LABELS[activeStage]} 문제에 대해 무엇이든 물어보세요!`)
      return
    }

    for (const rec of records) {
      appendBubble(rec.role, rec.content, false)
      chatHistory.push({ role: rec.role, content: rec.content })
    }
    chatArea.scrollTop = chatArea.scrollHeight
  }

  // ── 메시지 버블 ──
  function appendBubble(role, text, animate = true) {
    const wrap = document.createElement('div')
    wrap.style.cssText = `display:flex;justify-content:${role === 'user' ? 'flex-end' : 'flex-start'};`

    const bubble = document.createElement('div')
    bubble.style.cssText = `
      max-width:80%;
      padding:10px 14px;
      border-radius:${role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
      background:${role === 'user' ? 'var(--accent)' : 'var(--bg-card)'};
      border:${role === 'user' ? 'none' : '1px solid var(--border)'};
      color:var(--text-primary);
      font-size:13px;
      line-height:1.6;
      white-space:pre-wrap;
      word-break:break-word;
    `

    if (animate && role === 'assistant') {
      bubble.classList.add('cursor-blink')
    }

    bubble.textContent = text
    wrap.appendChild(bubble)
    chatArea.appendChild(wrap)
    chatArea.scrollTop = chatArea.scrollHeight
    return bubble
  }

  function appendSystemMsg(text) {
    const el = document.createElement('div')
    el.style.cssText = 'text-align:center;color:var(--text-muted);font-size:11px;padding:8px;'
    el.textContent = text
    chatArea.appendChild(el)
  }

  // ── 전송 ──
  async function sendMessage() {
    const query = userInput.value.trim()
    if (!query || isLoading) return

    if (!ollamaOk) {
      appendSystemMsg('⚠ Ollama가 실행 중이지 않습니다. 터미널에서 ollama serve를 실행하세요.')
      return
    }

    isLoading = true
    userInput.value = ''
    sendBtn.style.display = 'none'
    stopBtn.style.display = 'block'

    // 사용자 버블
    appendBubble('user', query)
    await saveChatMessage({ stageNumber: activeStage, role: 'user', content: query, hintLevel })
    chatHistory.push({ role: 'user', content: query })

    // AI 응답 버블 (스트리밍)
    const aiBubble = appendBubble('assistant', '', true)

    abortCtrl = new AbortController()
    let fullReply = ''

    try {
      fullReply = await streamHint({
        query,
        activeStage,
        hintLevel,
        history:  chatHistory.slice(-6),
        model:    currentModel,
        signal:   abortCtrl.signal,
        onToken: (token) => {
          fullReply += token
          aiBubble.classList.remove('cursor-blink')
          aiBubble.textContent = fullReply
          chatArea.scrollTop = chatArea.scrollHeight
        }
      })
    } catch (err) {
      if (err.name === 'AbortError') {
        aiBubble.textContent = fullReply || '(중단됨)'
      } else {
        aiBubble.textContent = `오류: ${err.message}`
        aiBubble.style.color = 'var(--danger)'
      }
    } finally {
      aiBubble.classList.remove('cursor-blink')
      if (fullReply) {
        await saveChatMessage({ stageNumber: activeStage, role: 'assistant', content: fullReply, hintLevel })
        chatHistory.push({ role: 'assistant', content: fullReply })
      }
      isLoading = false
      sendBtn.style.display = 'block'
      stopBtn.style.display = 'none'
    }
  }

  // ── 이벤트 바인딩 ──
  sendBtn.onclick = sendMessage
  stopBtn.onclick = () => { abortCtrl?.abort(); isLoading = false }
  userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
  clearBtn.onclick = async () => {
    if (!confirm(`${STAGE_LABELS[activeStage]} 채팅 기록을 초기화할까요?`)) return
    await clearChatHistory(activeStage)
    chatHistory = []
    await loadHistory()
  }
  adminBtn.onclick = () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'admin' }))

  // ── 초기화 ──
  renderStageTabs()
  renderLevelTabs()
  updateDiffBadge()
  checkStatus()
  loadHistory()

  // 30초마다 상태 재확인
  const statusInterval = setInterval(checkStatus, 30_000)
  root._cleanup = () => clearInterval(statusInterval)

  return root
}
