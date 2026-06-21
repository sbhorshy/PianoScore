import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestApp, TEST_MUSICXML } from './helpers.js'
import type { TestApp } from './helpers.js'

describe('POST /api/import', () => {
  let test: TestApp

  beforeEach(() => {
    test = createTestApp()
  })

  afterEach(() => {
    test.close()
  })

  it('imports MusicXML and returns 201 with score summary', async () => {
    const formData = new FormData()
    formData.append('file', new File([TEST_MUSICXML], 'test.xml', { type: 'application/xml' }))

    const res = await test.app.request('/api/import', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('id')
    expect(body.title).toBe('Integration Test')
    expect(body.composer).toBe('Tester')
    expect(body.tempo).toBe(120)
  })

  it('imported score appears in list', async () => {
    const formData = new FormData()
    formData.append('file', new File([TEST_MUSICXML], 'test.xml', { type: 'application/xml' }))

    await test.app.request('/api/import', {
      method: 'POST',
      body: formData,
    })

    const res = await test.app.request('/api/scores')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const scores = body.scores as Record<string, unknown>[]
    expect(scores).toHaveLength(1)
    expect(scores[0].title).toBe('Integration Test')
  })

  it('duplicate imports create separate records', async () => {
    const formData1 = new FormData()
    formData1.append('file', new File([TEST_MUSICXML], 'test.xml', { type: 'application/xml' }))

    const formData2 = new FormData()
    formData2.append('file', new File([TEST_MUSICXML], 'test2.xml', { type: 'application/xml' }))

    await test.app.request('/api/import', { method: 'POST', body: formData1 })
    await test.app.request('/api/import', { method: 'POST', body: formData2 })

    const res = await test.app.request('/api/scores')
    const body = (await res.json()) as Record<string, unknown>
    const scores = body.scores as Record<string, unknown>[]
    expect(scores).toHaveLength(2)
  })

  it('rejects non-MusicXML file', async () => {
    const formData = new FormData()
    formData.append('file', new File(['not xml'], 'test.pdf', { type: 'application/pdf' }))

    const res = await test.app.request('/api/import', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Unsupported file type')
  })

  it('rejects request with no file', async () => {
    const res = await test.app.request('/api/import', {
      method: 'POST',
      body: new FormData(),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('No file provided')
  })
})
