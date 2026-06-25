import { Hono } from 'hono'
import type { Db } from '../db/client.js'
import { getScoreSummary, insertScore } from '../db/repo.js'
import { ParserRegistry, ParseError } from '../parsing/parser.js'
import { MusicXmlParser } from '../parsing/musicxml.js'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXT = ['.musicxml', '.xml', '.mxl']

export function createImportRoute(db: Db): Hono {
  const registry = new ParserRegistry()
  registry.register(new MusicXmlParser())

  const route = new Hono()

  route.post('/', async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']
    if (!(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400)
    }

    const name = file.name.toLowerCase()
    if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
      return c.json({ error: 'Unsupported file type', detail: `Allowed: ${ALLOWED_EXT.join(', ')}` }, 400)
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large', detail: 'Max 10MB' }, 400)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const parser = registry.select(file.name, bytes)
    if (!parser) {
      return c.json({ error: 'No parser for this file' }, 400)
    }

    try {
      const parsed = await parser.parse(bytes)
      const id = insertScore(db, parsed)
      const summary = getScoreSummary(db, id)
      return c.json(summary, 201)
    } catch (err) {
      if (err instanceof ParseError) {
        return c.json({ error: err.message, detail: err.detail }, 400)
      }
      return c.json({ error: 'Parse failed', detail: String(err) }, 400)
    }
  })

  return route
}
