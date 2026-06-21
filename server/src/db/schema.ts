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

export type ScoreRow = typeof scores.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
