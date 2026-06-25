import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// 曲谱主表。sourceXml 存储原始 MusicXML，供前端 OSMD 渲染。
export const scores = sqliteTable('scores', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  composer: text('composer'),
  tempo: integer('tempo').notNull().default(120),
  sourceFormat: text('source_format').notNull().default('musicxml'),
  sourceXml: text('source_xml'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
})

// 一次完成的练习会话。
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  scoreId: text('score_id')
    .notNull()
    .references(() => scores.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  pitchAccuracy: real('pitch_accuracy').notNull(),
  rhythmAccuracy: real('rhythm_accuracy').notNull(),
  durationSec: real('duration_sec').notNull(),
  practiceMode: text('practice_mode', { enum: ['right', 'left', 'both'] }).notNull().default('both'),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(true),
})

// OCR 识别任务。done 时 scoreId 指向入库的 scores 行（软关联，不加 FK）。
export const ocrTasks = sqliteTable('ocr_tasks', {
  id: text('id').primaryKey(),
  status: text('status', {
    enum: ['pending', 'running', 'done', 'failed'],
  }).notNull(),
  inputFormat: text('input_format').notNull(),
  inputFileName: text('input_file_name').notNull(),
  inputPath: text('input_path'),
  scoreId: text('score_id'),
  errorCode: text('error_code'),
  errorDetail: text('error_detail'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})

export type ScoreRow = typeof scores.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type OcrTaskRow = typeof ocrTasks.$inferSelect
