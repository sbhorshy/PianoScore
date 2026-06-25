import { promises as fs } from 'node:fs'
import path from 'node:path'
import { insertScore } from '../db/repo.js'
import { OcrTaskRepo } from '../db/ocrTaskRepo.js'
import type { OcrEngine } from './engine.js'
import { OcrError } from './errors.js'
import type { Db } from '../db/client.js'

export interface StartInput {
  taskId: string          // 由路由 reservation 创建后传入
  filePath: string
  format: 'pdf' | 'image'
  fallbackTitle: string
  inputFileName: string
}

export class OcrRunner {
  // taskId -> resolve（测试用 waitForTask；也用于 cancel 后清理）
  private waiters = new Map<string, () => void>()

  constructor(
    private db: Db,
    private engine: OcrEngine,
    private repo: OcrTaskRepo,
  ) {}

  // 路由先 reservation（事务建 pending 行 + 409 检查）拿到 taskId，
  // 再写文件，最后调 start 启动异步识别。
  start(input: StartInput): void {
    this.run(input).catch((err) => {
      this.repo.markFailed(input.taskId, 'engine_crash', `unexpected: ${String(err)}`)
      this.cleanup(input.filePath)
      this.resolve(input.taskId)
    })
  }

  // 终止运行中的任务：kill 进程 + 标 failed + 清理。
  // 由 DELETE /api/ocr/:id 调用。
  cancel(taskId: string): void {
    this.engine.cancel()  // kill child（若在运行）
    const task = this.repo.get(taskId)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      this.repo.markFailed(taskId, 'engine_crash', 'cancelled by user')
    }
    if (task?.inputPath) this.cleanup(task.inputPath)
    this.resolve(taskId)
  }

  // 测试用：等待任务到达终态
  async waitForTask(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.set(taskId, resolve)
    })
  }

  private async run(input: StartInput): Promise<void> {
    const { taskId, filePath, format, fallbackTitle } = input

    const health = await this.engine.healthCheck()
    if (!health.ok) {
      this.repo.markFailed(taskId, health.reason!, 'healthCheck failed')
      this.cleanup(filePath)
      this.resolve(taskId)
      return
    }

    this.repo.markRunning(taskId)
    try {
      const result = await this.engine.recognize({
        taskId, filePath, format, fallbackTitle,
      })
      const scoreId = insertScore(this.db, {
        title: result.meta.title,
        composer: result.meta.composer,
        tempo: result.meta.tempo,
        sourceXml: result.musicXml,
      }, { sourceFormat: 'ocr' })
      this.repo.markDone(taskId, scoreId)
    } catch (err) {
      if (err instanceof OcrError) {
        this.repo.markFailed(taskId, err.code, err.detail)
      } else {
        this.repo.markFailed(taskId, 'engine_crash', String(err))
      }
    } finally {
      this.cleanup(filePath)
      this.resolve(taskId)
    }
  }

  // 删除临时文件所在的任务目录（dirname(filePath)）
  private cleanup(filePath: string): void {
    const dir = path.dirname(filePath)
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  private resolve(taskId: string): void {
    this.waiters.get(taskId)?.()
    this.waiters.delete(taskId)
  }
}
