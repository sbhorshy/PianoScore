import { Hono } from 'hono'
import type { Db } from '../db/client.js'
import { getFullScore, insertSession, listSessions } from '../db/repo.js'

export function createSessionsRoute(db: Db): Hono {
  const route = new Hono()

  // GET /:id/sessions — practice history
  route.get('/:id/sessions', (c) => {
    return c.json({ sessions: listSessions(db, c.req.param('id')) })
  })

  // POST /:id/sessions — record a completed practice session
  route.post('/:id/sessions', async (c) => {
    const scoreId = c.req.param('id')
    if (!getFullScore(db, scoreId)) return c.json({ error: 'Score not found' }, 404)

    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.pitchAccuracy !== 'number') {
      return c.json({ error: 'Invalid session payload' }, 400)
    }
    const validModes = ['right', 'left', 'both'] as const
    const practiceMode = validModes.includes(body.practiceMode) ? body.practiceMode : 'both'
    const id = insertSession(db, scoreId, {
      startedAt: Number(body.startedAt) || 0,
      endedAt: Number(body.endedAt) || 0,
      pitchAccuracy: body.pitchAccuracy,
      rhythmAccuracy: Number(body.rhythmAccuracy) || 0,
      durationSec: Number(body.durationSec) || 0,
      practiceMode,
    })
    return c.json({ id }, 201)
  })

  return route
}
