import { eq, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from './client.js'
import { ocrTasks } from './schema.js'

export interface CreateTaskInput {
  inputFormat: string
  inputFileName: string
  inputPath?: string
}

export class OcrTaskRepo {
  constructor(private db: Db) {}

  create(input: CreateTaskInput): string {
    const id = randomUUID()
    this.db.insert(ocrTasks).values({
      id,
      status: 'pending',
      inputFormat: input.inputFormat,
      inputFileName: input.inputFileName,
      inputPath: input.inputPath ?? null,
    }).run()
    return id
  }

  get(id: string) {
    return this.db.select().from(ocrTasks).where(eq(ocrTasks.id, id)).get()
  }

  markRunning(id: string): void {
    this.db.update(ocrTasks).set({
      status: 'running',
      startedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  markDone(id: string, scoreId: string): void {
    this.db.update(ocrTasks).set({
      status: 'done',
      scoreId,
      completedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  markFailed(id: string, errorCode: string, errorDetail?: string): void {
    this.db.update(ocrTasks).set({
      status: 'failed',
      errorCode,
      errorDetail: errorDetail ?? null,
      completedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  // 查找 pending 或 running 的任务（用于 409 串行约束）
  findActive() {
    return this.db.select().from(ocrTasks)
      .where(or(eq(ocrTasks.status, 'pending'), eq(ocrTasks.status, 'running')))
      .get() ?? null
  }

  // reservation 后写完临时文件回填路径
  updateInputPath(id: string, inputPath: string): void {
    this.db.update(ocrTasks).set({ inputPath }).where(eq(ocrTasks.id, id)).run()
  }

  delete(id: string): boolean {
    const res = this.db.delete(ocrTasks).where(eq(ocrTasks.id, id)).run()
    return res.changes > 0
  }
}
