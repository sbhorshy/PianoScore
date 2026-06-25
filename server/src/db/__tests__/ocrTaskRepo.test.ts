import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { OcrTaskRepo } from '../ocrTaskRepo.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE ocr_tasks (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, input_format TEXT NOT NULL,
      input_file_name TEXT NOT NULL, input_path TEXT, score_id TEXT,
      error_code TEXT, error_detail TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER, completed_at INTEGER
    );
  `)
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

describe('OcrTaskRepo', () => {
  let repo: OcrTaskRepo
  let close: () => void

  beforeEach(() => {
    const t = makeDb()
    repo = new OcrTaskRepo(t.db)
    close = t.close
  })
  afterEach(() => close())

  it('creates and gets a task', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    const task = repo.get(id)
    expect(task).toBeDefined()
    expect(task!.status).toBe('pending')
    expect(task!.inputFormat).toBe('pdf')
    expect(task!.inputFileName).toBe('a.pdf')
  })

  it('marks running with startedAt', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markRunning(id)
    expect(repo.get(id)!.status).toBe('running')
    expect(repo.get(id)!.startedAt).toBeGreaterThan(0)
  })

  it('marks done with scoreId and completedAt', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markDone(id, 'score-123')
    const task = repo.get(id)!
    expect(task.status).toBe('done')
    expect(task.scoreId).toBe('score-123')
    expect(task.completedAt).toBeGreaterThan(0)
  })

  it('marks failed with error code/detail', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markFailed(id, 'engine_crash', 'exit code 1')
    const task = repo.get(id)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('engine_crash')
    expect(task.errorDetail).toBe('exit code 1')
  })

  it('finds active task (pending/running)', () => {
    const id1 = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    const active = repo.findActive()
    expect(active?.id).toBe(id1)
    repo.markDone(id1, 's1')
    expect(repo.findActive()).toBeNull()
  })

  it('deletes a task', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    expect(repo.delete(id)).toBe(true)
    expect(repo.get(id)).toBeUndefined()
  })

  it('updates inputPath after creation', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf' })
    expect(repo.get(id)!.inputPath).toBeNull()
    repo.updateInputPath(id, '/tmp/a.pdf')
    expect(repo.get(id)!.inputPath).toBe('/tmp/a.pdf')
  })
})
