import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from '../services/firebase.js'
import { deleteGame, listGames, saveGame } from '../services/games.js'
import { SEED_DATA } from '../data/seed-data.js'

const EMPTY_GAME = {
  title: '',
  subtitle: '',
  difficulty: '보통',
  description: '',
  stages: []
}

const SAMPLE_STAGE_JSON = JSON.stringify(SEED_DATA.stages.map(stage => ({
  id: String(stage.stageNumber),
  number: stage.stageNumber,
  title: stage.title,
  difficulty: stage.difficulty,
  keywords: stage.keywords,
  content: stage.content,
  hints: stage.hints
})), null, 2)

export function AdminPage() {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [games, setGames] = useState([])
  const [draft, setDraft] = useState(EMPTY_GAME)
  const [stageJson, setStageJson] = useState('[]')

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, async nextUser => {
      setIsCheckingAuth(true)
      setUser(nextUser)
      setError('')

      if (!nextUser || !db) {
        setIsAdmin(false)
        setIsCheckingAuth(false)
        return
      }

      const adminDoc = await getDoc(doc(db, 'admins', nextUser.uid))
      setIsAdmin(adminDoc.exists())
      setIsCheckingAuth(false)
    })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    refreshGames()
  }, [isAdmin])

  async function refreshGames() {
    setGames(await listGames())
  }

  async function login(event) {
    event.preventDefault()
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (loginError) {
      setError(loginError.message)
    }
  }

  async function submitGame(event) {
    event.preventDefault()
    setError('')

    try {
      await saveGame({
        ...draft,
        stages: normalizeStages(parseStages(stageJson))
      })
      setDraft(EMPTY_GAME)
      setStageJson('[]')
      await refreshGames()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function removeGame(id) {
    if (!window.confirm('이 콘텐츠를 삭제할까요?')) return
    await deleteGame(id)
    await refreshGames()
  }

  if (!isFirebaseConfigured) {
    return (
      <main className="admin-shell">
        <section className="card">
          <h1>Firebase 설정 필요</h1>
          <p className="muted">Vercel 환경 변수에 Firebase 설정값을 등록하면 관리자 로그인을 사용할 수 있습니다.</p>
        </section>
      </main>
    )
  }

  if (isCheckingAuth) {
    return (
      <main className="admin-shell">
        <section className="auth-card">
          <p className="eyebrow">Admin</p>
          <h1>권한 확인 중</h1>
          <p className="muted">관리자 계정을 확인하고 있습니다.</p>
        </section>
      </main>
    )
  }

  if (!user || !isAdmin) {
    return (
      <main className="admin-shell">
        <form className="auth-card" onSubmit={login}>
          <p className="eyebrow">Admin</p>
          <h1>관리자 로그인</h1>
          <input value={email} onChange={event => setEmail(event.target.value)} placeholder="관리자 이메일" type="email" />
          <input value={password} onChange={event => setPassword(event.target.value)} placeholder="비밀번호" type="password" />
          <button className="btn btn-primary" type="submit">로그인</button>
          {user && !isAdmin && <p className="error-text">관리자 권한이 없는 계정입니다.</p>}
          {user && !isAdmin && <button className="btn btn-ghost" type="button" onClick={() => signOut(auth)}>다른 계정으로 로그인</button>}
          {error && <p className="error-text">{error}</p>}
        </form>
      </main>
    )
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>콘텐츠 관리</h1>
        </div>
        <button className="btn btn-ghost" onClick={() => signOut(auth)}>로그아웃</button>
      </header>

      <section className="admin-grid">
        <form className="card editor-card" onSubmit={submitGame}>
          <h2>힌트 콘텐츠 등록</h2>
          <p className="muted">문제 풀이 지식은 공개 DB가 아닌 서버 전용 컬렉션에 분리 저장됩니다.</p>
          <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="콘텐츠명" required />
          <input value={draft.subtitle} onChange={event => setDraft({ ...draft, subtitle: event.target.value })} placeholder="부제" />
          <textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="설명" />
          <button className="btn btn-ghost" type="button" onClick={() => setStageJson(SAMPLE_STAGE_JSON)}>샘플 JSON 채우기</button>
          <textarea value={stageJson} onChange={event => setStageJson(event.target.value)} placeholder="문제/힌트 JSON" className="json-input" />
          <button className="btn btn-primary" type="submit">저장</button>
          {error && <p className="error-text">{error}</p>}
        </form>

        <section className="content-list">
          {games.map(game => (
            <article className="card content-item" key={game.id}>
              <div>
                <h2>{game.title}</h2>
                <p>{game.subtitle || game.description}</p>
              </div>
              <button className="btn btn-danger" onClick={() => removeGame(game.id)}>삭제</button>
            </article>
          ))}
        </section>
      </section>
    </main>
  )
}

function parseStages(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error('문제/힌트 JSON 형식이 올바르지 않습니다.')
  }
}

function normalizeStages(stages) {
  return stages.map((stage, index) => ({
    ...stage,
    id: stage.id || String(stage.number || index + 1),
    number: Number(stage.number || index + 1)
  }))
}
