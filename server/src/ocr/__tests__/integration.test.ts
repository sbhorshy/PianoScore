import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OcrEngine } from '../engine.js'

// ESM 下 __dirname 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(__dirname, '../../../test-fixtures')

const JAR = process.env.PIANOSCORE_AUDIVERIS_JAR

// 无 jar 则跳过整个 describe（fixture 也不会被访问）
const describeOrSkip = JAR ? describe : describe.skip

describeOrSkip('OcrEngine integration (real Audiveris)', () => {
  const engine = new OcrEngine({
    javaBin: process.env.PIANOSCORE_JAVA ?? 'java',
    jarPath: JAR!,
    tessdataDir: process.env.PIANOSCORE_TESSDATA,
    dbPath: ':memory:',
  })

  it('recognizes a simple score PDF', async () => {
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(path.join(FIXTURES_DIR, 'score-ocr.pdf'), inputPath)

    const result = await engine.recognize({
      taskId: 'it1', filePath: inputPath, format: 'pdf', fallbackTitle: 'score-ocr',
    })
    expect(result.musicXml).toContain('<score-partwise')
    expect(result.meta.tempo).toBeGreaterThan(0)

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000) // 60s 超时

  it('fails on non-score input', async () => {
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(path.join(FIXTURES_DIR, 'not-score.pdf'), inputPath)

    await expect(engine.recognize({
      taskId: 'it2', filePath: inputPath, format: 'pdf', fallbackTitle: 'not-score',
    })).rejects.toThrow()

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000)
})
