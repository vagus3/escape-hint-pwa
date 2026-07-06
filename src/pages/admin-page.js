import { getAllChunks, upsertChunk, deleteChunk, resetToSeed, seedIfEmpty } from '../services/knowledge.js'
import { checkOllamaStatus, pullModel, DEFAULT_MODEL } from '../services/ollama.js'
import { getSetting, setSetting } from '../services/db.js'
import { showToast } from '../main.js'

export function AdminPage() {
  const root = document.createElement('div')
  root.style.cssText = 'display:flex;flex-direction:column;height:100vh;overflow:hidden;'

  root.innerHTML = `
    <!-- 헤더 -->
    <header style="display:flex;align-items:center;justify-content:space-between;
                   padding:12px 20px;border-bottom:1px solid var(--border);
                   background:var(--bg-secondary);flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn btn-ghost" id="back-btn" style="padding:5px 10px;font-size:12px;">← 돌아가기</button>
        <span style="font-weight:600;font-size:13px;">⚙ 지식 베이스 관리</span>
      </div>
      <button class="btn btn-ghost" id="reset-btn"
              style="font-size:11px;color:var(--danger);border-color:rgba(240,80,80,0.3);">
        초기화
      </button>
    </header>

    <!-- 탭 -->
    <div style="display:flex;border-bottom:1px solid var(--border);background:var(--bg-secondary);flex-shrink:0;">
      <button class="tab-btn active" data-tab="knowledge" 
              style="padding:10px 16px;font-size:12px;background:none;border:none;
                     color:var(--accent);border-bottom:2px solid var(--accent);cursor:pointer;">
        📚 지식 베이스
      </button>
      <button class="tab-btn" data-tab="settings"
              style="padding:10px 16px;font-size:12px;background:none;border:none;
                     color:var(--text-muted);border-bottom:2px solid transparent;cursor:pointer;">
        🤖 Ollama 설정
      </button>
      <button class="tab-btn" data-tab="add"
              style="padding:10px 16px;font-size:12px;background:none;border:none;
                     color:var(--text-muted);border-bottom:2px solid transparent;cursor:pointer;">
        ✚ 지식 추가
      </button>
    </div>

    <!-- 콘텐츠 -->
    <div id="tab-content" style="flex:1;overflow-y:auto;padding:16px;"></div>
  `

  const tabContent = root.querySelector('#tab-content')
  const tabBtns    = root.querySelectorAll('.tab-btn')

  // ── 탭 전환 ──
  function switchTab(name) {
    tabBtns.forEach(b => {
      const active = b.dataset.tab === name
      b.style.color        = active ? 'var(--accent)'  : 'var(--text-muted)'
      b.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent'
    })
    if (name === 'knowledge') renderKnowledge()
    else if (name === 'settings')  renderSettings()
    else if (name === 'add')       renderAddForm()
  }

  tabBtns.forEach(b => b.onclick = () => switchTab(b.dataset.tab))

  // ──────────────────────────────────────────
  //  탭 1: 지식 베이스 목록
  // ──────────────────────────────────────────
  async function renderKnowledge() {
    tabContent.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">불러오는 중...</div>'
    const chunks = await getAllChunks()

    tabContent.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">
        총 ${chunks.length}개 청크 · 클릭하여 편집
      </div>
      <div id="chunk-list" style="display:flex;flex-direction:column;gap:8px;"></div>
    `

    const list = tabContent.querySelector('#chunk-list')
    chunks.forEach(chunk => {
      const card = document.createElement('div')
      card.className = 'card'
      card.style.cssText = 'cursor:pointer;'
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span class="badge ${chunk.type === 'world' ? 'badge-accent' : 'badge-warn'}" style="font-size:10px;">
                ${chunk.type === 'world' ? '세계관' : `${chunk.stageNumber}번 문제`}
              </span>
              <span style="font-weight:500;font-size:13px;">${chunk.title}</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);
                        overflow:hidden;text-overflow:ellipsis;
                        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
              ${chunk.content}
            </div>
          </div>
          <button class="btn btn-danger del-btn" data-id="${chunk.id}"
                  style="padding:4px 8px;font-size:11px;flex-shrink:0;">🗑</button>
        </div>
      `
      card.querySelector('.del-btn').onclick = async (e) => {
        e.stopPropagation()
        if (!confirm(`"${chunk.title}" 청크를 삭제할까요?`)) return
        await deleteChunk(chunk.id)
        showToast('삭제되었습니다')
        renderKnowledge()
      }
      card.onclick = (e) => {
        if (e.target.classList.contains('del-btn')) return
        openEditModal(chunk)
      }
      list.appendChild(card)
    })
  }

  // ── 편집 모달 ──
  function openEditModal(chunk) {
    // 기존 모달 제거
    document.querySelector('#edit-modal')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'edit-modal'
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;
    `
    overlay.innerHTML = `
      <div class="card" style="width:100%;max-width:560px;max-height:80vh;overflow-y:auto;">
        <div style="font-weight:600;margin-bottom:12px;font-size:14px;">청크 편집</div>
        <label style="font-size:11px;color:var(--text-muted);">제목</label>
        <input id="edit-title" value="${chunk.title}" style="margin:4px 0 10px;" />
        <label style="font-size:11px;color:var(--text-muted);">키워드 (쉼표 구분)</label>
        <input id="edit-kw" value="${(chunk.keywords || []).join(', ')}" style="margin:4px 0 10px;" />
        <label style="font-size:11px;color:var(--text-muted);">본문 내용</label>
        <textarea id="edit-content" style="margin:4px 0 12px;min-height:180px;">${chunk.content}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" id="modal-cancel">취소</button>
          <button class="btn btn-primary" id="modal-save">저장</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    overlay.querySelector('#modal-cancel').onclick = () => overlay.remove()
    overlay.querySelector('#modal-save').onclick = async () => {
      const updated = {
        ...chunk,
        title:    overlay.querySelector('#edit-title').value.trim(),
        keywords: overlay.querySelector('#edit-kw').value.split(',').map(k => k.trim()).filter(Boolean),
        content:  overlay.querySelector('#edit-content').value.trim()
      }
      await upsertChunk(updated)
      overlay.remove()
      showToast('저장되었습니다')
      renderKnowledge()
    }
    overlay.onclick = e => { if (e.target === overlay) overlay.remove() }
  }

  // ──────────────────────────────────────────
  //  탭 2: Ollama 설정
  // ──────────────────────────────────────────
  async function renderSettings() {
    const savedModel = await getSetting('model', DEFAULT_MODEL)
    const { ok, models } = await checkOllamaStatus()

    tabContent.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:500;margin-bottom:8px;">Ollama 연결 상태</div>
        <div class="badge ${ok ? 'badge-success' : 'badge-danger'}" style="margin-bottom:8px;">
          ${ok ? '● 연결됨' : '● 연결 안됨'}
        </div>
        ${!ok ? `
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.8;">
            터미널에서 Ollama를 실행하세요:<br>
            <code style="background:var(--bg-input);padding:4px 8px;border-radius:4px;
                         font-family:var(--font-mono);color:var(--accent);">ollama serve</code>
          </div>` : ''}
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:500;margin-bottom:10px;">사용 모델</div>
        ${ok && models.length ? `
          <select id="model-select" style="margin-bottom:10px;">
            ${models.map(m => `<option value="${m}" ${m === savedModel ? 'selected' : ''}>${m}</option>`).join('')}
          </select>` : `
          <input id="model-input" value="${savedModel}" placeholder="ex) gemma2:2b" style="margin-bottom:10px;" />`}
        <button class="btn btn-primary" id="save-model" style="width:100%;">모델 저장</button>
      </div>

      <div class="card">
        <div style="font-size:12px;font-weight:500;margin-bottom:8px;">모델 다운로드</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.7;">
          추천 경량 모델: <strong>gemma2:2b</strong> (~1.7GB) · <strong>llama3.2:3b</strong> (~2GB)<br>
          한국어 우수: <strong>exaone3.5:2.4b</strong> (~1.5GB)
        </div>
        <div style="display:flex;gap:8px;">
          <input id="pull-model-input" placeholder="모델명 입력" style="flex:1;" />
          <button class="btn btn-primary" id="pull-btn">Pull</button>
        </div>
        <div id="pull-status" style="font-size:11px;color:var(--text-muted);margin-top:8px;min-height:16px;
                                     font-family:var(--font-mono);"></div>
      </div>
    `

    const saveModelBtn = tabContent.querySelector('#save-model')
    saveModelBtn.onclick = async () => {
      const val = (tabContent.querySelector('#model-select') || tabContent.querySelector('#model-input'))?.value?.trim()
      if (!val) return
      await setSetting('model', val)
      showToast(`모델 저장: ${val}`)
    }

    const pullBtn    = tabContent.querySelector('#pull-btn')
    const pullInput  = tabContent.querySelector('#pull-model-input')
    const pullStatus = tabContent.querySelector('#pull-status')
    pullBtn.onclick = async () => {
      const name = pullInput.value.trim()
      if (!name) return
      pullBtn.disabled = true
      pullStatus.textContent = '다운로드 시작...'
      try {
        await pullModel(name, status => { pullStatus.textContent = status })
        showToast(`${name} 다운로드 완료!`)
      } catch (e) {
        pullStatus.textContent = `오류: ${e.message}`
      } finally {
        pullBtn.disabled = false
      }
    }
  }

  // ──────────────────────────────────────────
  //  탭 3: 지식 추가
  // ──────────────────────────────────────────
  function renderAddForm() {
    tabContent.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">
        새 게임 정보 청크를 추가합니다. 웹사이트 정보, 세계관, 힌트 등 자유롭게 입력하세요.
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:11px;color:var(--text-muted);">유형</label>
          <select id="new-type" style="margin-top:4px;">
            <option value="stage">문제 관련</option>
            <option value="world">세계관/배경</option>
            <option value="tip">팁/주의사항</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);">문제 번호 (문제 관련일 때)</label>
          <select id="new-stage" style="margin-top:4px;">
            <option value="">없음</option>
            <option value="1">1번 문제</option>
            <option value="2">2번 문제</option>
            <option value="3">3번 문제</option>
            <option value="4">4번 문제</option>
            <option value="5">5번 문제</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);">제목 *</label>
          <input id="new-title" placeholder="예: 3번 문제 추가 힌트" style="margin-top:4px;" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);">키워드 (쉼표 구분)</label>
          <input id="new-kw" placeholder="예: 정육면체, TRACE, 반대면" style="margin-top:4px;" />
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-muted);">내용 * (알수록 AI가 더 정확한 힌트를 줄 수 있습니다)</label>
          <textarea id="new-content" placeholder="웹사이트의 해당 부분에 대한 자세한 설명..." 
                    style="margin-top:4px;min-height:140px;"></textarea>
        </div>
        <button class="btn btn-primary" id="add-chunk-btn">추가하기</button>
      </div>
    `

    tabContent.querySelector('#add-chunk-btn').onclick = async () => {
      const title   = tabContent.querySelector('#new-title').value.trim()
      const content = tabContent.querySelector('#new-content').value.trim()
      if (!title || !content) { showToast('제목과 내용은 필수입니다'); return }

      const stageVal = tabContent.querySelector('#new-stage').value
      await upsertChunk({
        id:          `custom-${Date.now()}`,
        type:        tabContent.querySelector('#new-type').value,
        stageNumber: stageVal ? Number(stageVal) : null,
        title,
        keywords:    tabContent.querySelector('#new-kw').value.split(',').map(k => k.trim()).filter(Boolean),
        content
      })
      showToast('지식 청크가 추가되었습니다')
      renderAddForm()
    }
  }

  // ── 버튼 이벤트 ──
  root.querySelector('#back-btn').onclick  = () => window.dispatchEvent(new CustomEvent('navigate', { detail: 'hint' }))
  root.querySelector('#reset-btn').onclick = async () => {
    if (!confirm('지식 베이스를 초기 상태로 되돌릴까요? 커스텀 데이터가 모두 삭제됩니다.')) return
    await resetToSeed()
    showToast('초기화 완료')
    renderKnowledge()
  }

  // ── 초기화 ──
  switchTab('knowledge')

  return root
}
