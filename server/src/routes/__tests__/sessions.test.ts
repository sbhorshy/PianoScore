import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestApp, TEST_MUSICXML } from './helpers.js'
import type { TestApp } from './helpers.js'

describe('Sessions API', () => {
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

  it('records and retrieves practice session', async () => {
    const scoreId = await importScore()

    const sessionData = {
      startedAt: 1000000,
      endedAt: 1000060,
      pitchAccuracy: 0.95,
      rhythmAccuracy: 0.88,
      durationSec: 60,
      practiceMode: 'right',
    }

    const postRes = await test.app.request(`/api/scores/${scoreId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData),
    })
    expect(postRes.status).toBe(201)
    const postBody = await postRes.json()
    expect(postBody).toHaveProperty('id')

    const getRes = await test.app.request(`/api/scores/${scoreId}/sessions`)
    expect(getRes.status).toBe(200)
    const getBody = (await getRes.json()) as Record<string, unknown>
    const sessions = getBody.sessions as Record<string, unknown>[]
    expect(sessions).toHaveLength(1)

    const session = sessions[0]
    expect(session.pitchAccuracy).toBe(0.95)
    expect(session.rhythmAccuracy).toBe(0.88)
    expect(session.durationSec).toBe(60)
    expect(session.practiceMode).toBe('right')
    expect(session.scoreId).toBe(scoreId)
  })
})
