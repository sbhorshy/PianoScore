import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadOcrConfig } from '../config.js'

describe('loadOcrConfig', () => {
  const original = { ...process.env }
  beforeEach(() => {
    delete process.env.PIANOSCORE_JAVA
    delete process.env.PIANOSCORE_AUDIVERIS_JAR
    delete process.env.PIANOSCORE_TESSDATA
    delete process.env.PIANOSCORE_DB
  })
  afterEach(() => { process.env = { ...original } })

  it('uses env vars when set', () => {
    process.env.PIANOSCORE_JAVA = '/app/jre/bin/java'
    process.env.PIANOSCORE_AUDIVERIS_JAR = '/app/audiveris.jar'
    process.env.PIANOSCORE_TESSDATA = '/app/tessdata'
    const cfg = loadOcrConfig()
    expect(cfg.javaBin).toBe('/app/jre/bin/java')
    expect(cfg.jarPath).toBe('/app/audiveris.jar')
    expect(cfg.tessdataDir).toBe('/app/tessdata')
  })

  it('falls back to PATH java and local jar in dev', () => {
    const cfg = loadOcrConfig()
    expect(cfg.javaBin).toBe('java')
    expect(cfg.jarPath).toBe('./audiveris.jar')
    expect(cfg.tessdataDir).toBeUndefined()
  })
})
