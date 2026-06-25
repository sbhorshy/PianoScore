import { Hono } from 'hono'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Db } from '../db/client.js'
import { OcrTaskRepo } from '../db/ocrTaskRepo.js'
import type { OcrRunner } from '../ocr/runner.js'

const MAX_BYTES = 20 * 1024 * 1024 // 20MB
const ALLOWED_EXT: Record<string, 'pdf' | 'image'> = {
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
}

export function createOcrRoute(db: Db, runner: OcrRunner): Hono {
  const repo = new OcrTaskRepo(db)
  const route = new Hono()

  route.post('/', async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']
    if (!(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400)
    }

    const name = file.name.toLowerCase()
    const matched = Object.entries(ALLOWED_EXT).find(([ext]) => name.endsWith(ext))
    if (!matched) {
      return c.json({ error: 'Unsupported file type', detail: `Allowed: ${Object.keys(ALLOWED_EXT).join(', ')}` }, 400)
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large', detail: 'Max 20MB' }, 400)
    }

    // === Reservation：同步事务化，消除 findActive/create 竞态 ===
    // SQLite better-sqlite3 本身同步，findActive + create 在同一事件循环 tick 内完成，
    // 不会有其他请求插入。先检查再创建。
    const active = repo.findActive()
    if (active) {
      return c.json({ error: 'An OCR task is already running', activeTaskId: active.id }, 409)
    }
    const ext = path.extname(file.name)
    const taskId = repo.create({
      inputFormat: matched[1] === 'pdf' ? 'pdf' : ext.slice(1),
      inputFileName: file.name,
    })
    // reservation 完成，后续异步操作不影响并发判断

    // 写临时文件
    const taskDir = path.join(os.tmpdir(), 'pianoscore-ocr', taskId)
    const inputPath = path.join(taskDir, `input${ext}`)
    try {
      await fs.mkdir(taskDir, { recursive: true })
      await fs.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      // 写文件失败：回滚任务
      repo.markFailed(taskId, 'engine_crash', `failed to write temp file: ${String(err)}`)
      return c.json({ taskId, status: 'failed', errorCode: 'engine_crash' }, 201)
    }

    // 回填 inputPath 并启动 runner
    repo.updateInputPath(taskId, inputPath)
    runner.start({
      taskId,
      filePath: inputPath,
      format: matched[1],
      fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
      inputFileName: file.name,
    })

    return c.json({ taskId, status: 'pending' }, 201)
  })

  route.get('/:id', (c) => {
    const task = repo.get(c.req.param('id'))
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const elapsedMs = task.startedAt
      ? (task.completedAt ?? Math.floor(Date.now() / 1000)) - task.startedAt
      : 0

    if (task.status === 'done') {
      return c.json({ status: 'done', scoreId: task.scoreId })
    }
    if (task.status === 'failed') {
      return c.json({ status: 'failed', errorCode: task.errorCode, errorDetail: task.errorDetail })
    }
    return c.json({ status: task.status, inputFileName: task.inputFileName, elapsedMs: elapsedMs * 1000 })
  })

  route.delete('/:id', (c) => {
    const id = c.req.param('id')
    // runner.cancel 负责 kill 进程 + 标 failed + 清理目录
    runner.cancel(id)
    const deleted = repo.delete(id)
    return c.json({ deleted })
  })

  return route
}
