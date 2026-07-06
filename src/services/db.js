import { openDB } from 'idb'

const DB_NAME    = 'egcompany-hint-db'
const DB_VERSION = 1

/**
 * DB 스키마:
 *  - knowledge : 게임 지식 청크 저장 (id, type, stageNumber, title, keywords[], content, updatedAt)
 *  - chat_history : 문제별 채팅 기록 (id, stageNumber, role, content, hintLevel, timestamp)
 *  - settings : 앱 설정 (key, value)
 */
let _db = null

export async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // 지식 베이스
      if (!db.objectStoreNames.contains('knowledge')) {
        const ks = db.createObjectStore('knowledge', { keyPath: 'id' })
        ks.createIndex('by_type',  'type',        { unique: false })
        ks.createIndex('by_stage', 'stageNumber', { unique: false })
      }
      // 채팅 기록
      if (!db.objectStoreNames.contains('chat_history')) {
        const ch = db.createObjectStore('chat_history', { keyPath: 'id', autoIncrement: true })
        ch.createIndex('by_stage', 'stageNumber', { unique: false })
      }
      // 설정
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
    }
  })
  return _db
}

export async function getSetting(key, defaultValue = null) {
  const db  = await getDB()
  const row = await db.get('settings', key)
  return row ? row.value : defaultValue
}

export async function setSetting(key, value) {
  const db = await getDB()
  await db.put('settings', { key, value })
}
