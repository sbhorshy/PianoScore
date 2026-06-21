import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { Hono } from 'hono'
import { createImportRoute } from '../import.js'
import { createScoresRoute } from '../scores.js'
import { createSessionsRoute } from '../sessions.js'
import type { Db } from '../../db/client.js'

export interface TestApp {
  app: Hono
  db: Db
  close: () => void
}

export function createTestApp(): TestApp {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })

  // Create tables from schema definitions
  sqlite.exec(`
    CREATE TABLE scores (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      composer TEXT,
      tempo INTEGER NOT NULL DEFAULT 120,
      source_format TEXT NOT NULL DEFAULT 'musicxml',
      source_xml TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      pitch_accuracy REAL NOT NULL,
      rhythm_accuracy REAL NOT NULL,
      duration_sec REAL NOT NULL,
      practice_mode TEXT NOT NULL DEFAULT 'both',
      completed INTEGER NOT NULL DEFAULT 1
    );
  `)

  const app = new Hono()
  app.route('/api/scores', createScoresRoute(db))
  app.route('/api/scores', createSessionsRoute(db))
  app.route('/api/import', createImportRoute(db))

  return {
    app,
    db,
    close: () => sqlite.close(),
  }
}

export const TEST_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>Integration Test</work-title>
  </work>
  <identification>
    <creator type="composer">Tester</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>C</step>
          <octave>4</octave>
        </pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`
