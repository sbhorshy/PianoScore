import { Hono } from 'hono'
import type { Db } from '../db/client.js'
import { listScores, getFullScore, deleteScore } from '../db/repo.js'

export function createScoresRoute(db: Db): Hono {
  const route = new Hono()

  // GET / — summary list
  route.get('/', (c) => {
    return c.json({ scores: listScores(db) })
  })

  // GET /:id — full score
  route.get('/:id', (c) => {
    const score = getFullScore(db, c.req.param('id'))
    if (!score) return c.json({ error: 'Score not found' }, 404)
    return c.json(score)
  })

  // DELETE /:id — delete with cascade
  route.delete('/:id', (c) => {
    const ok = deleteScore(db, c.req.param('id'))
    if (!ok) return c.json({ error: 'Score not found' }, 404)
    return c.json({ deleted: true })
  })

  return route
}
