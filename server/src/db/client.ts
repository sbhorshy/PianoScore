import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

// 单一 db 实例。测试可传入 ':memory:'。
export function createDb(path = 'db.sqlite') {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON') // 级联删除生效
  return drizzle(sqlite, { schema })
}

export type Db = ReturnType<typeof createDb>
export { schema }
