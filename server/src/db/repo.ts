import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from './client.js'
import { scores, sessions } from './schema.js'
import type { ParsedScore } from '../parsing/parser.js'

export interface ScoreSummary {
  id: string
  title: string
  composer: string | null
  tempo: number
}

export interface FullScore extends ScoreSummary {
  sourceXml: string | null
}

// 持久化一首曲谱（元数据 + 原始 XML），返回新 id。
export function insertScore(db: Db, parsed: ParsedScore): string {
  const id = randomUUID()
  db.insert(scores).values({
    id,
    title: parsed.title,
    composer: parsed.composer ?? null,
    tempo: parsed.tempo,
    sourceFormat: 'musicxml',
    sourceXml: parsed.sourceXml,
  }).run()
  return id
}

export function listScores(db: Db): ScoreSummary[] {
  const all = db.select().from(scores).all()
  return all.map((s) => ({
    id: s.id,
    title: s.title,
    composer: s.composer,
    tempo: s.tempo,
  }))
}

export function getFullScore(db: Db, id: string): FullScore | null {
  const s = db.select().from(scores).where(eq(scores.id, id)).get()
  if (!s) return null
  return {
    id: s.id,
    title: s.title,
    composer: s.composer,
    tempo: s.tempo,
    sourceXml: s.sourceXml,
  }
}

export function deleteScore(db: Db, id: string): boolean {
  const res = db.delete(scores).where(eq(scores.id, id)).run()
  return res.changes > 0 // 级联删除 sessions（schema onDelete + PRAGMA）
}

export interface SessionInput {
  startedAt: number
  endedAt: number
  pitchAccuracy: number
  rhythmAccuracy: number
  durationSec: number
  practiceMode: 'right' | 'left' | 'both'
}

export function insertSession(db: Db, scoreId: string, s: SessionInput): string {
  const id = randomUUID()
  db.insert(sessions).values({ id, scoreId, completed: true, ...s }).run()
  return id
}

export function listSessions(db: Db, scoreId: string) {
  return db.select().from(sessions).where(eq(sessions.scoreId, scoreId)).all()
}
