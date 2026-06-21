import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestApp, TEST_MUSICXML } from './helpers.js'
import type { TestApp } from './helpers.js'

describe('Scores API', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })

  afterEach(() => {
    test.close()
  })

  async function importScore(): Promise<string> {
    const formData = new FormData()
    formData.append('file', new File([TEST_MUSICXML], 'test.xml', { type: 'application/xml' }))

    const res = await test.app.request('/api/import', {
      method: 'POST',
      body: formData,
    })
    const body = (await res.json()) as Record<string, unknown>
    return body.id as string
  }

  it('returns 404 for nonexistent score', async () => {
    const res = await test.app.request('/api/scores/nonexistent-id')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Score not found')
  })

  it('deletes a score', async () => {
    const id = await importScore()

    const deleteRes = await test.app.request(`/api/scores/${id}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    expect((await deleteRes.json() as Record<string, unknown>).deleted).toBe(true)

    const getRes = await test.app.request(`/api/scores/${id}`)
    expect(getRes.status).toBe(404)
  })

  it('get full score includes sourceXml', async () => {
    const id = await importScore()

    const res = await test.app.request(`/api/scores/${id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('sourceXml')
    expect(body.sourceXml).toContain('Integration Test')
    expect(body.sourceXml).toContain('<score-partwise')
  })
})
