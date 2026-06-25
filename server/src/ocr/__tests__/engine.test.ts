import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as childProcess from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { zipSync, strToU8 } from 'fflate'
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

// helper: 创建 mock child + 模拟 outDir 文件
// outFiles 写到与 recognize 实现读取一致的目录：path.dirname(filePath)/out
function mockSpawn(
  filePath: string,
  opts: {
    exitCode?: number
    outFiles?: Record<string, string | Buffer>  // fileName -> content
    delayMs?: number
  },
) {
  const child = new EventEmitter() as never as import('node:child_process').ChildProcess
  ;(child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter()
  ;(child as unknown as { kill: unknown }).kill = vi.fn()

  vi.mocked(childProcess.spawn).mockImplementation(() => child)

  // 延迟 emit：让 recognize 内的 mkdir/spawn/listener 注册先完成
  // setTimeout(0) 会在 await 期间触发导致 close 丢失，用 50ms 留足同步窗口
  setTimeout(async () => {
    if (opts.outFiles) {
      const outDir = path.join(path.dirname(filePath), 'out')
      await fs.rm(outDir, { recursive: true, force: true })
      await fs.mkdir(outDir, { recursive: true })
      for (const [name, content] of Object.entries(opts.outFiles)) {
        await fs.writeFile(path.join(outDir, name), content)
      }
    }
    child.emit('close', opts.exitCode ?? 0)
  }, opts.delayMs ?? 50)

  return child
}

const NOTE_XML = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>OCR Title</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
  </measure></part>
</score-partwise>`

describe('OcrEngine.recognize', () => {
  beforeEach(() => vi.clearAllMocks())

  // 用唯一临时文件路径，确保 outDir 真实可写且 mock 与实现读到同一目录
  const filePath = path.join(os.tmpdir(), `pianoscore-engine-test/input.pdf`)

  it('parses .xml output and extracts meta', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined) // healthCheck jar
    await mockSpawn(filePath, { outFiles: { 'input.xml': NOTE_XML } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '某曲谱',
    })
    expect(result.meta.title).toBe('OCR Title')
    expect(result.musicXml).toContain('<score-partwise')
  })

  it('uses fallbackTitle when XML has no title', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const noTitleXml = NOTE_XML.replace(
      /<work>.*?<\/work>/, '',
    )
    await mockSpawn(filePath, { outFiles: { 'input.xml': noTitleXml } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '月光奏鸣曲',
    })
    expect(result.meta.title).toBe('月光奏鸣曲')
  })

  it('throws engine_crash on non-zero exit', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const child = await mockSpawn(filePath, { exitCode: 1 })
    ;((child as unknown as { stderr: EventEmitter }).stderr).emit('data', Buffer.from('boom'))

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toMatchObject({ code: 'engine_crash' })
  })

  it('throws no_output when outDir empty', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    await mockSpawn(filePath, { outFiles: {} })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toMatchObject({ code: 'no_output' })
  })

  it('throws low_confidence when XML has 0 notes', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const emptyXml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
</score-partwise>`
    await mockSpawn(filePath, { outFiles: { 'input.xml': emptyXml } })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toMatchObject({ code: 'low_confidence' })
  })

  it('parses .mxl (zipped) output — Audiveris default format', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    // 构造符合 .mxl 规范的 zip：META-INF/container.xml + 根文档
    const containerXml = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`
    const zip = zipSync({
      'META-INF/container.xml': strToU8(containerXml),
      'score.xml': strToU8(NOTE_XML),
    })
    await mockSpawn(filePath, { outFiles: { 'input.mxl': Buffer.from(zip) } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '某曲谱',
    })
    expect(result.meta.title).toBe('OCR Title')
    expect(result.musicXml).toContain('<score-partwise')
    expect(result.musicXml).toContain('C</step>')  // note 解压后可读
  })
})
