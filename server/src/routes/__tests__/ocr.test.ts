import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestApp } from './helpers.js'
import type { TestApp } from './helpers.js'
import { OcrEngine } from '../../ocr/engine.js'
import type { OcrRunner } from '../../ocr/runner.js'

// healthCheck 永远成功的真实 engine（配 fake path，不实际 spawn）
const fakeConfig = {
  javaBin: '/fake/java', jarPath: '/fake/audiveris.jar',
  tessdataDir: '/fake/tessdata', dbPath: ':memory:',
}

function makeMockRunner() {
  return {
    start: vi.fn(),
    cancel: vi.fn(),
  } as unknown as OcrRunner
}

describe('OCR API', () => {
  let test: TestApp
  beforeEach(() => {
    const engine = new OcrEngine(fakeConfig)
    // 让 healthCheck 返回 ok=true（绕过真实 java 检测）
    vi.spyOn(engine, 'healthCheck').mockResolvedValue({ ok: true })
    test = createTestApp({ engine, runner: makeMockRunner() })
  })
  afterEach(() => { test.close(); vi.restoreAllMocks() })

  it('POST /api/ocr rejects non-PDF/image', async () => {
    const fd = new FormData()
    fd.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('POST /api/ocr rejects oversized file', async () => {
    const big = new Uint8Array(21 * 1024 * 1024)
    const fd = new FormData()
    fd.append('file', new File([big], 'a.pdf', { type: 'application/pdf' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('POST /api/ocr accepts PDF and returns taskId', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([0x25, 0x50])], 'score.pdf', { type: 'application/pdf' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(201)
    const body = await res.json() as { taskId: string; status: string }
    expect(body.taskId).toBeTruthy()
    expect(body.status).toBe('pending')
  })

  it('GET /api/ocr/:id returns 404 for unknown', async () => {
    const res = await test.app.request('/api/ocr/nonexistent')
    expect(res.status).toBe(404)
  })

  it('GET /api/health returns ocr availability', async () => {
    const res = await test.app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as { ocr: { available: boolean } }
    expect(body.ocr).toBeDefined()
    expect(body.ocr.available).toBe(true) // healthCheck 被 mock 为 ok
  })

  it('DELETE /api/ocr/:id calls runner.cancel', async () => {
    const engine = new OcrEngine(fakeConfig)
    vi.spyOn(engine, 'healthCheck').mockResolvedValue({ ok: true })
    const runner = makeMockRunner()
    // 这个测试用自己的 engine/runner 实例，绕过 beforeEach 的 test app
    const localTest = createTestApp({ engine, runner })

    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([0x25, 0x50])], 'a.pdf', { type: 'application/pdf' }))
    const createRes = await localTest.app.request('/api/ocr', { method: 'POST', body: fd })
    const { taskId } = await createRes.json() as { taskId: string }

    const res = await localTest.app.request(`/api/ocr/${taskId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(runner.cancel).toHaveBeenCalledWith(taskId)
    localTest.close()
  })
})
