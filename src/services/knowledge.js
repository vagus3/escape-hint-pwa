import { getDB, setSetting, getSetting } from './db.js'
import { ALL_CHUNKS, SEED_VERSION } from '../data/seed-data.js'

/**
 * 지식 베이스 관리
 *  - 시드 데이터 초기 주입
 *  - 청크 CRUD (관리자 페이지에서 편집 가능)
 */

export async function seedIfEmpty() {
  const seeded = await getSetting('seeded', false)
  const seededVersion = await getSetting('seedVersion', null)
  if (seeded && seededVersion === SEED_VERSION) return

  const db = await getDB()
  await db.clear('knowledge')
  const tx = db.transaction('knowledge', 'readwrite')
  for (const chunk of ALL_CHUNKS) {
    await tx.store.put({
      ...chunk,
      updatedAt: new Date().toISOString()
    })
  }
  await tx.done
  await setSetting('seeded', true)
  await setSetting('seedVersion', SEED_VERSION)
  console.log('[KB] 시드 데이터 주입 완료:', ALL_CHUNKS.length, '개 청크')
}

export async function getAllChunks() {
  const db = await getDB()
  return db.getAll('knowledge')
}

export async function getChunksByStage(stageNumber) {
  const db = await getDB()
  const idx = db.transaction('knowledge').store.index('by_stage')
  return idx.getAll(stageNumber)
}

export async function getChunk(id) {
  const db = await getDB()
  return db.get('knowledge', id)
}

export async function upsertChunk(chunk) {
  const db = await getDB()
  await db.put('knowledge', {
    ...chunk,
    updatedAt: new Date().toISOString()
  })
}

export async function deleteChunk(id) {
  const db = await getDB()
  await db.delete('knowledge', id)
}

export async function resetToSeed() {
  const db = await getDB()
  await db.clear('knowledge')
  await setSetting('seeded', false)
  await seedIfEmpty()
}

// ── 채팅 기록 ──

export async function saveChatMessage({ stageNumber, role, content, hintLevel }) {
  const db = await getDB()
  return db.add('chat_history', {
    stageNumber,
    role,
    content,
    hintLevel: hintLevel ?? null,
    timestamp: new Date().toISOString()
  })
}

export async function getChatHistory(stageNumber) {
  const db  = await getDB()
  const idx = db.transaction('chat_history').store.index('by_stage')
  return idx.getAll(stageNumber)
}

export async function clearChatHistory(stageNumber) {
  const db      = await getDB()
  const tx      = db.transaction('chat_history', 'readwrite')
  const idx     = tx.store.index('by_stage')
  const records = await idx.getAllKeys(stageNumber)
  for (const key of records) await tx.store.delete(key)
  await tx.done
}
