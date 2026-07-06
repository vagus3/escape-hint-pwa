import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase.js'
import { SEED_DATA } from '../data/seed-data.js'

const DEFAULT_GAME = {
  ...SEED_DATA.game,
  stages: SEED_DATA.stages.map(stage => ({
    id: String(stage.stageNumber),
    number: stage.stageNumber,
    title: stage.title,
    difficulty: stage.difficulty,
    keywords: stage.keywords,
    content: stage.content,
    hints: stage.hints
  }))
}

export function getFallbackGames() {
  return [DEFAULT_GAME]
}

export async function listGames() {
  if (!isFirebaseConfigured || !db) return getFallbackGames()

  try {
    const snap = await getDocs(query(collection(db, 'games'), orderBy('updatedAt', 'desc')))
    const games = snap.docs.map(row => ({ id: row.id, ...row.data() }))
    return games.length ? games : getFallbackGames()
  } catch (error) {
    console.warn('[games] Firestore 목록 조회 실패, fallback 사용:', error)
    return getFallbackGames()
  }
}

export async function saveGame(game) {
  if (!isFirebaseConfigured || !db) throw new Error('Firebase 환경 변수가 설정되지 않았습니다.')
  const id = game.id || `game-${Date.now()}`
  const publicGame = toPublicGame({ ...game, id })

  await setDoc(doc(db, 'games', id), {
    ...publicGame,
    updatedAt: serverTimestamp()
  }, { merge: true })

  await setDoc(doc(db, 'gameKnowledge', id), {
    gameId: id,
    title: game.title,
    stages: game.stages || [],
    updatedAt: serverTimestamp()
  }, { merge: true })

  return id
}

export async function deleteGame(id) {
  if (!isFirebaseConfigured || !db) throw new Error('Firebase 환경 변수가 설정되지 않았습니다.')
  await deleteDoc(doc(db, 'games', id))
  await deleteDoc(doc(db, 'gameKnowledge', id))
}

function toPublicGame(game) {
  return {
    id: game.id,
    title: game.title,
    subtitle: game.subtitle || '',
    difficulty: game.difficulty || '보통',
    progressLabel: game.progressLabel || '힌트 전용',
    description: game.description || '',
    sourceUrl: game.sourceUrl || '',
    stages: (game.stages || []).map((stage, index) => ({
      id: String(stage.id || stage.number || index + 1),
      number: Number(stage.number || index + 1),
      title: stage.title || `${index + 1}번 구간`,
      difficulty: stage.difficulty || '보통',
      keywords: stage.keywords || []
    }))
  }
}
