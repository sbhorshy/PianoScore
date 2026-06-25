import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { OcrTaskRepo } from '../../db/ocrTaskRepo.js'
import { OcrRunner } from '../runner.js'
import { OcrError } from '../errors.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE scores (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, composer TEXT,
      tempo INTEGER NOT NULL DEFAULT 120, source_format TEXT NOT NULL DEFAULT 'musicxml',
      source_xml TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE ocr_tasks (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, input_format TEXT NOT NULL,
      input_file_name TEXT NOT NULL, input_path TEXT, score_id TEXT,
      error_code TEXT, error_detail TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER, completed_at INTEGER
    );
  `)
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

function mockEngine(result: { meta: { title: string; tempo: number }; musicXml: string } | OcrError) {
  return {
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
    recognize: vi.fn().mockImplementation(async () => {
      if (result instanceof OcrError) throw result
      return result
    }),
    cancel: vi.fn(),
  }
}

describe('OcrRunner', () => {
  let close: () => void
  let repo: OcrTaskRepo
  let db: ReturnType<typeof makeDb>['db']

  beforeEach(() => {
    const t = makeDb()
    db = t.db
    repo = new OcrTaskRepo(db)
    close = t.close
  })
  afterEach(() => { close() })

  // 路由 reservation 建好 pending 行后，用 taskId 启动 runner
  function startTask(runner: OcrRunner, fileName = 'a.pdf') {
    const taskId = repo.create({ inputFormat: 'pdf', inputFileName: fileName, inputPath: '/tmp/a.pdf' })
    runner.start({
      taskId,
      filePath: '/tmp/a.pdf',
      format: 'pdf',
      fallbackTitle: fileName.replace(/\.[^.]+$/, ''),
      inputFileName: fileName,
    })
    return taskId
  }

  it('happy path: pending → running → done with scoreId', async () => {
    const engine = mockEngine({ meta: { title: 'T', tempo: 100 }, musicXml: '<xml/>' })
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('done')
    expect(task.scoreId).toBeTruthy()
  })

  it('failure: marks failed with error code', async () => {
    const engine = mockEngine(new OcrError('engine_crash', 'boom', 'detail'))
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('engine_crash')
    expect(task.errorDetail).toBe('detail')
  })

  it('healthCheck failure → failed with no_java', async () => {
    const engine = {
      healthCheck: vi.fn().mockResolvedValue({ ok: false, reason: 'no_java' }),
      recognize: vi.fn(),
      cancel: vi.fn(),
    }
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('no_java')
    expect(engine.recognize).not.toHaveBeenCalled()
  })

  it('cancel kills engine and marks failed', async () => {
    const engine = {
      healthCheck: vi.fn().mockResolvedValue({ ok: true }),
      recognize: vi.fn().mockImplementation(() => new Promise(() => {})), // 永不 resolve
      cancel: vi.fn(),
    }
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    // waitForTask 必须在 cancel 之前注册 waiter（cancel 触发 resolve）
    const donePromise = runner.waitForTask(taskId)
    // 等一拍让 running 状态就绪
    await new Promise((r) => setTimeout(r, 10))
    runner.cancel(taskId)
    await donePromise

    expect(engine.cancel).toHaveBeenCalled()
    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorDetail).toBe('cancelled by user')
  })
})
