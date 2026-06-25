import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as childProcess from 'node:child_process'
import { promises as fs } from 'node:fs'
import { OcrEngine } from '../engine.js'

// Mock child_process
vi.mock('node:child_process')

const validConfig = {
  javaBin: '/fake/java',
  jarPath: '/fake/audiveris.jar',
  tessdataDir: '/fake/tessdata',
  dbPath: '/fake/db.sqlite',
}

describe('OcrEngine.healthCheck', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok when java -version succeeds and jar exists', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0, stdout: '', stderr: 'openjdk 17', pid: 1,
      output: [null, '', ''], signal: null,
    } as never)
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)

    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(true)
  })

  it('returns no_java when java -version fails', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 127, stdout: '', stderr: 'not found', pid: 0,
      output: [null, '', ''], signal: null,
    } as never)
    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_java')
  })

  it('returns no_audiveris when jar missing', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0, stdout: '', stderr: '', pid: 1,
      output: [null, '', ''], signal: null,
    } as never)
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'))

    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_audiveris')
  })
})
