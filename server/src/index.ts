import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { db } from './db/instance.js'
import { createScoresRoute } from './routes/scores.js'
import { createSessionsRoute } from './routes/sessions.js'
import { createImportRoute } from './routes/import.js'

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

app.get('/api/health', (c) => c.json({ status: 'healthy' }))

// Business routes (modular, each with injected db)
app.route('/api/scores', createScoresRoute(db))
app.route('/api/scores', createSessionsRoute(db)) // /:id/sessions
app.route('/api/import', createImportRoute(db))

const port = 8000
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PianoScore server on http://localhost:${info.port}`)
})

export { app }
