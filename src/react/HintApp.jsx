import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  Bookmark,
  BookOpen,
  CheckSquare,
  CircleUserRound,
  Clock3,
  FileText,
  Heart,
  Home,
  Info,
  Lightbulb,
  MoreHorizontal,
  Play,
  Puzzle,
  Search,
  SendHorizontal,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  UserRound,
  UsersRound
} from 'lucide-react'
import { listGames } from '../services/games.js'
import { requestHint, getUserEmail, setUserEmail } from '../services/ai-api.js'

const NAV_ITEMS = [
  { id: 'home', label: '홈', Icon: Home },
  { id: 'content', label: '콘텐츠', Icon: CheckSquare },
  { id: 'profile', label: '마이페이지', Icon: UserRound }
]

const GAME_META = {
  egcompany: {
    status: '온라인',
    rating: '4.8',
    reviews: '1,234',
    players: '1~4명',
    time: '90~120분',
    feature: 'AI 힌트',
    tags: ['회사', '메일', '3D 퍼즐'],
    poster: 'poster-lab',
    progress: 0
  }
}

const SAMPLE_THEMES = [
  { id: 'mansion', title: '달빛 아래의 저택', status: '온라인', rating: '4.7', poster: 'poster-mansion' },
  { id: 'library', title: '의문의 서재', status: '오프라인', rating: '4.6', poster: 'poster-library' },
  { id: 'station', title: '지하철의 비밀', status: '오프라인', rating: '4.5', poster: 'poster-station' }
]

export function HintApp() {
  const [games, setGames] = useState([])
  const [activeNav, setActiveNav] = useState('home')
  const [mode, setMode] = useState('main')
  const [userEmail, setUserEmailState] = useState(() => getUserEmail())
  const [emailInput, setEmailInput] = useState('')
  const [selectedGameId, setSelectedGameId] = useState('')
  const [messagesByGame, setMessagesByGame] = useState({})
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const chatRef = useRef(null)

  const selectedGame = useMemo(
    () => games.find(game => game.id === selectedGameId) || games[0],
    [games, selectedGameId]
  )
  const selectedMeta = getMeta(selectedGame)
  const gameKey = selectedGame?.id || 'game'
  const messages = messagesByGame[gameKey] || []

  useEffect(() => {
    listGames().then(items => {
      setGames(items)
      setSelectedGameId(items[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading, mode])

  function openDetail(game) {
    setSelectedGameId(game.id)
    setMode('detail')
  }

  function openPlay(game = selectedGame) {
    if (!game) return
    setSelectedGameId(game.id)
    setMode('play')
  }

  function updateMessages(nextMessages) {
    setMessagesByGame(prev => ({ ...prev, [gameKey]: nextMessages }))
  }

  async function submitQuestion(event, quickQuestion) {
    event?.preventDefault()
    const cleanQuestion = (quickQuestion || question).trim()
    if (!cleanQuestion || isLoading || !selectedGame) return

    const nextMessages = [...messages, { role: 'user', content: cleanQuestion }]
    updateMessages(nextMessages)
    setQuestion('')
    setIsLoading(true)

    try {
      const result = await requestHint({
        game: selectedGame,
        question: cleanQuestion,
        history: nextMessages
      })
      updateMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: result.answer,
          hintLevel: result.hintLevel,
          matchedStage: result.matchedStage,
          source: result.source
        }
      ])
    } catch (error) {
      updateMessages([
        ...nextMessages,
        { role: 'assistant', content: `힌트를 불러오지 못했습니다. ${error.message}`, hintLevel: null }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  function saveEmail(event) {
    event.preventDefault()
    const trimmed = emailInput.trim().toLowerCase()
    if (!trimmed) return
    setUserEmail(trimmed)
    setUserEmailState(trimmed)
  }

  if (!userEmail) {
    return (
      <main className="app-frame">
        <section className="screen email-gate">
          <div className="email-gate-inner">
            <div className="bot-avatar"><Sparkles size={32} /></div>
            <h1>EGCompany 힌트 시스템</h1>
            <p>웹사이트 가입 시 사용한 이메일을 입력하면<br />힌트 사용 기록이 자동으로 연동됩니다.</p>
            <form onSubmit={saveEmail}>
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="가입 이메일 입력"
                required
                autoFocus
              />
              <button className="primary-cta" type="submit">시작하기</button>
            </form>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-frame">
      {mode === 'detail' && selectedGame && (
        <GameDetail game={selectedGame} meta={selectedMeta} onBack={() => setMode('main')} onPlay={() => openPlay(selectedGame)} />
      )}

      {mode === 'play' && selectedGame && (
        <PlayScreen
          game={selectedGame}
          meta={selectedMeta}
          messages={messages}
          question={question}
          isLoading={isLoading}
          chatRef={chatRef}
          onBack={() => setMode('detail')}
          onQuestionChange={setQuestion}
          onSubmit={submitQuestion}
        />
      )}

      {mode === 'main' && (
        <>
          {activeNav === 'home' && (
            <HomeScreen games={games} selectedGame={selectedGame} onDetail={openDetail} onPlay={openPlay} />
          )}
          {activeNav === 'content' && (
            <ContentScreen games={games} onDetail={openDetail} />
          )}
          {activeNav === 'profile' && (
            <ProfileScreen games={games} onDetail={openDetail} />
          )}
          <BottomNav activeNav={activeNav} onChange={setActiveNav} />
        </>
      )}
    </main>
  )
}

function HomeScreen({ games, selectedGame, onDetail, onPlay }) {
  return (
    <section className="screen has-bottom-nav">
      <header className="home-header">
        <div>
          <p className="brand-word">ERG</p>
          <h1>오늘도 멋진 탈출을 준비해볼까요?</h1>
        </div>
        <button className="icon-button" type="button" aria-label="알림"><Bell size={18} /></button>
      </header>

      <div className="search-row">
        <label className="search-field">
          <Search size={18} />
          <input placeholder="방탈출 검색" />
        </label>
        <button className="icon-button" type="button" aria-label="필터"><SlidersHorizontal size={18} /></button>
      </div>

      <div className="mode-toggle">
        <button className="active">온라인</button>
        <button>오프라인</button>
      </div>

      <SectionTitle title="추천 방탈출" action="더보기" />
      <div className="horizontal-list">
        {games.map(game => (
          <GameCard key={game.id} game={game} onClick={() => onDetail(game)} />
        ))}
        {SAMPLE_THEMES.map(theme => <ThemeCard key={theme.id} theme={theme} />)}
      </div>

      <section className="notice-panel">
        <h2>TIP & 유의사항</h2>
        <NoticeItem title="힌트는 단계적으로 제공돼요." text="처음에는 방향만, 반복 질문에는 더 구체적인 단서를 제공합니다." />
        <NoticeItem title="정답은 직접 공개하지 않아요." text="테스트 정책상 3단계 힌트까지만 제공합니다." />
        <NoticeItem title="AI가 추리를 도와드려요." text="막힌 장치, 단서 의미, 다음 행동을 자유롭게 물어보세요." />
      </section>

      {selectedGame && (
        <button className="floating-play" type="button" onClick={() => onPlay(selectedGame)}>
          최근 콘텐츠 이어가기
        </button>
      )}
    </section>
  )
}

function ContentScreen({ games, onDetail }) {
  return (
    <section className="screen has-bottom-nav">
      <PageHeader title="콘텐츠" rightIcon={Search} />
      <div className="category-tabs">
        {['전체', '온라인', '오프라인', '신작', '인기'].map((item, index) => (
          <button className={index === 0 ? 'active' : ''} key={item}>{item}</button>
        ))}
      </div>
      <div className="content-list-view">
        {games.map(game => <ContentRow key={game.id} game={game} onClick={() => onDetail(game)} />)}
        {SAMPLE_THEMES.map(theme => <ContentRow key={theme.id} game={theme} compact />)}
      </div>
    </section>
  )
}

function GameDetail({ game, meta, onBack, onPlay }) {
  return (
    <section className="screen detail-screen">
      <PageHeader title="" leftIcon={ArrowLeft} rightIcon={Share2} onLeft={onBack} />
      <div className={`detail-poster image-poster ${meta.poster}`}>
        <span>{meta.status}</span>
      </div>
      <h1>{game.title}</h1>
      <div className="rating-row">
        <span>난이도</span>
        <strong>★★★★★</strong>
        <span>{meta.rating} ({meta.reviews})</span>
      </div>
      <div className="tag-row">
        {(meta.tags || []).map(tag => <span key={tag}>#{tag}</span>)}
      </div>
      <p className="detail-copy">{game.description}</p>
      <div className="fact-grid">
        <Fact Icon={Clock3} label="플레이 시간" value={meta.time} />
        <Fact Icon={UsersRound} label="추천 인원" value={meta.players} />
        <Fact Icon={Puzzle} label="특징" value={meta.feature} />
      </div>
      <section className="included">
        <h2>포함 요소</h2>
        <div>
          <span><BookOpen size={15} />스토리</span>
          <span><Puzzle size={15} />퍼즐</span>
          <span><Lightbulb size={15} />힌트 시스템</span>
        </div>
      </section>
      <button className="primary-cta" type="button" onClick={onPlay}><Play size={18} fill="currentColor" />게임 플레이</button>
    </section>
  )
}

function PlayScreen({
  game,
  meta,
  messages,
  question,
  isLoading,
  chatRef,
  onBack,
  onQuestionChange,
  onSubmit
}) {
  const inputRef = useRef(null)
  const examples = [
    'WESEN 개체는 어떤 걸 골라야 해?',
    '큐브에서 뭘 해야 하는지 모르겠어.',
    'WESEN 파일 화면에서 다음으로 뭘 눌러야 해?'
  ]

  function fillExample(item) {
    onQuestionChange(item)
    inputRef.current?.focus()
  }

  return (
    <section className="screen play-screen">
      <PageHeader title={game.title} leftIcon={ArrowLeft} rightIcon={MoreHorizontal} onLeft={onBack} />
      <div className="progress-header">
        <span>진행도</span>
        <strong>{meta.progress}%</strong>
      </div>
      <div className="progress-line"><span style={{ width: `${meta.progress}%` }} /></div>

      <section className="tabs">
        <button className="active"><Sparkles size={16} />AI 도움</button>
        <button disabled><Lightbulb size={16} />힌트 기록</button>
        <button disabled><StickyNote size={16} />노트</button>
      </section>

      <section className="chat-area rich-chat" ref={chatRef}>
        {messages.length === 0 && (
          <>
            <div className="helper-card">
              <div className="bot-avatar"><Sparkles size={24} /></div>
              <p>안녕하세요! 문제를 고르지 않아도 됩니다. 현재 화면에서 막힌 내용을 그대로 질문해보세요.</p>
            </div>
            <div className="question-examples">
              <span>질문 예시</span>
              {examples.map(item => (
                <button key={item} type="button" onClick={() => fillExample(item)}>{item}</button>
              ))}
            </div>
          </>
        )}

        {messages.map((message, index) => (
          <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.hintLevel && <span className="hint-level">힌트 {message.hintLevel}단계</span>}
            {message.matchedStage?.title && <span className="hint-level">{message.matchedStage.title}</span>}
            <p>{message.content}</p>
          </article>
        ))}

        {isLoading && <article className="message assistant"><p>힌트를 준비하고 있습니다...</p></article>}
      </section>

      <form className="composer" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          value={question}
          onChange={event => onQuestionChange(event.target.value)}
          placeholder="현재 화면에서 막힌 내용을 입력하세요..."
          maxLength={200}
        />
        <button className="send-button" type="submit" disabled={isLoading} aria-label="전송"><SendHorizontal size={18} fill="currentColor" /></button>
      </form>
      <p className="ai-disclaimer">AI의 답변은 참고용이며, 정답을 직접 제공하지 않습니다.</p>
    </section>
  )
}

function ProfileScreen({ games, onDetail }) {
  return (
    <section className="screen has-bottom-nav">
      <PageHeader title="마이페이지" rightIcon={Settings} />
      <section className="profile-card">
        <div className="profile-avatar"><CircleUserRound size={34} /></div>
        <div>
          <h1>Escaper</h1>
          <p>빛을 찾는 탐험가</p>
          <div className="level-line"><span /></div>
        </div>
      </section>

      <SectionTitle title="최근 플레이한 게임" action="더보기" />
      <div className="horizontal-list small">
        {games.map(game => <GameCard key={game.id} game={game} onClick={() => onDetail(game)} small />)}
      </div>

      <div className="menu-list">
        {[
          ['내 정보', CircleUserRound],
          ['플레이 기록', Clock3],
          ['찜한 콘텐츠', Heart],
          ['내 노트', StickyNote],
          ['AI 히스토리', Sparkles],
          ['공지사항', Info],
          ['이용약관', FileText],
          ['버전 정보', Settings]
        ].map(([item, Icon]) => (
          <button key={item} type="button"><span><Icon size={17} />{item}</span><strong>›</strong></button>
        ))}
      </div>
    </section>
  )
}

function BottomNav({ activeNav, onChange }) {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(item => (
        <button className={activeNav === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => onChange(item.id)}>
          <item.Icon size={20} />
          {item.label}
        </button>
      ))}
    </nav>
  )
}

function GameCard({ game, onClick, small = false }) {
  const meta = getMeta(game)
  return (
    <button className={`game-card ${small ? 'small' : ''}`} type="button" onClick={onClick}>
      <div className={`image-poster ${meta.poster}`}><span>{meta.status}</span></div>
      <strong>{game.title}</strong>
      <p>★ {meta.rating}</p>
    </button>
  )
}

function ThemeCard({ theme }) {
  return (
    <button className="game-card" type="button">
      <div className={`image-poster ${theme.poster}`}><span>{theme.status}</span></div>
      <strong>{theme.title}</strong>
      <p>★ {theme.rating}</p>
    </button>
  )
}

function ContentRow({ game, onClick, compact = false }) {
  const meta = compact ? game : getMeta(game)
  return (
    <button className="content-row" type="button" onClick={onClick}>
      <div className={`image-poster ${meta.poster}`}><span>{meta.status}</span></div>
      <div>
        <strong>{game.title}</strong>
        <p>난이도 ★★★★★ · {meta.rating}</p>
        <div className="tag-row">
          {(meta.tags || ['추리', '암호', '스토리']).slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}
        </div>
      </div>
      <span className="bookmark"><Bookmark size={18} /></span>
    </button>
  )
}

function PageHeader({ title, leftIcon: LeftIcon, rightIcon: RightIcon, onLeft }) {
  return (
    <header className="page-header">
      <button className="icon-button" type="button" onClick={onLeft} aria-label="뒤로">{LeftIcon && <LeftIcon size={19} />}</button>
      <h1>{title}</h1>
      <button className="icon-button" type="button" aria-label="메뉴">{RightIcon && <RightIcon size={19} />}</button>
    </header>
  )
}

function SectionTitle({ title, action }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <button type="button">{action} ›</button>
    </div>
  )
}

function NoticeItem({ title, text }) {
  return (
    <article>
      <span><Info size={16} /></span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  )
}

function Fact({ Icon, label, value }) {
  return (
    <div>
      {Icon && <Icon size={17} />}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getMeta(game) {
  return GAME_META[game?.id] || {
    status: '온라인',
    rating: '4.8',
    reviews: '128',
    players: '1~4명',
    time: '60~90분',
    feature: '힌트 전용',
    tags: ['방탈출', '힌트', 'AI'],
    poster: 'poster-lab',
    progress: 30
  }
}
