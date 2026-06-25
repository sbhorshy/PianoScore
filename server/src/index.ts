import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { db } from './db/instance.js'
import { createScoresRoute } from './routes/scores.js'
import { createSessionsRoute } from './routes/sessions.js'
import { createImportRoute } from './routes/import.js'
import { createOcrRoute } from './routes/ocr.js'
import { OcrEngine } from './ocr/engine.js'
import { OcrRunner } from './ocr/runner.js'
import { OcrTaskRepo } from './db/ocrTaskRepo.js'
import { loadOcrConfig } from './ocr/config.js'

const app = new Hono()

// Only allow frontend dev origin
app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)

const ocrConfig = loadOcrConfig()
const ocrEngine = new OcrEngine(ocrConfig)
const ocrTaskRepo = new OcrTaskRepo(db)
const ocrRunner = new OcrRunner(db, ocrEngine, ocrTaskRepo)

// 启动时预热 healthCheck（结果缓存在 engine 内部，供 /api/health 复用）
ocrEngine.healthCheck().catch(() => {})

app.get('/api/health', async (c) => {
  const ocr = await ocrEngine.healthCheck()
  return c.json({ status: 'healthy', ocr: { available: ocr.ok, reason: ocr.reason } })
})

// Business routes (modular, each with injected db)
app.route('/api/scores', createScoresRoute(db))
app.route('/api/scores', createSessionsRoute(db)) // /:id/sessions
app.route('/api/import', createImportRoute(db))
app.route('/api/ocr', createOcrRoute(db, ocrRunner))

const port = 8000
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PianoScore server on http://localhost:${info.port}`)
})

export { app }
