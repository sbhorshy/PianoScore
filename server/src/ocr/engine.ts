import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { extractMxl, isZip, extractMusicXmlMetadata } from '../parsing/musicxml.js'
import { OcrError } from './errors.js'
import type { ErrorCode } from './errors.js'
import type { OcrConfig } from './config.js'

export interface RecognizeInput {
  taskId: string
  filePath: string
  format: 'pdf' | 'image'
  fallbackTitle: string  // 上传文件名去扩展名，用于无标题乐谱的元数据回退
}

export interface OcrResult {
  musicXml: string
  meta: { title: string; composer?: string; tempo: number }
}

export interface HealthResult {
  ok: boolean
  reason?: ErrorCode
}

const TIMEOUT_MS = 90_000
const STDERR_CAP = 64 * 1024

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export class OcrEngine {
  private availableCache: HealthResult | null = null
  private currentChild: ChildProcess | null = null

  constructor(private config: OcrConfig) {}

  async healthCheck(): Promise<HealthResult> {
    if (this.availableCache) return this.availableCache

    // 1. java -version
    const javaCheck = spawnSync(this.config.javaBin, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (javaCheck.status !== 0) {
      this.availableCache = { ok: false, reason: 'no_java' }
      return this.availableCache
    }

    // 2. jar 存在
    try {
      await fs.access(this.config.jarPath)
    } catch {
      this.availableCache = { ok: false, reason: 'no_audiveris' }
      return this.availableCache
    }

    this.availableCache = { ok: true }
    return this.availableCache
  }

  async recognize(input: RecognizeInput): Promise<OcrResult> {
    const health = await this.healthCheck()
    if (!health.ok) {
      throw new OcrError(health.reason!, `${health.reason} detected by healthCheck`)
    }

    const outDir = path.join(path.dirname(input.filePath), 'out')
    await fs.mkdir(outDir, { recursive: true })

    // 仅在显式配置时注入 TESSDATA_PREFIX；否则让 Audiveris 用系统默认路径
    // （undefined 会被 Node 序列化成字面量 "undefined"，导致 Tesseract 找不到 tessdata）
    const childEnv = { ...process.env }
    if (this.config.tessdataDir) {
      childEnv.TESSDATA_PREFIX = this.config.tessdataDir
    }

    const child = spawn(this.config.javaBin, [
      '-jar', this.config.jarPath,
      '-batch', '-transcribe', '-export', '-sheets', '1',
      '-output', outDir,
      '--', input.filePath,
    ], {
      env: childEnv,
    })

    await this.runWithTimeout(child)

    // 找输出文件：优先 .mxl，回退 .xml
    const entries = await fs.readdir(outDir)
    const mxlFile = entries.find((e) => e.endsWith('.mxl'))
    const xmlFile = entries.find((e) => e.endsWith('.xml'))
    const target = mxlFile ?? xmlFile
    if (!target) {
      const listing = entries.join(', ') || '(empty)'
      throw new OcrError('no_output', 'Audiveris produced no .mxl/.xml', `outDir: ${listing}`)
    }

    const fileBytes = await fs.readFile(path.join(outDir, target))
    const xmlText = isZip(fileBytes) ? extractMxl(fileBytes) : fileBytes.toString('utf8')

    let doc: Record<string, unknown>
    try {
      doc = xmlParser.parse(xmlText)
    } catch (e) {
      throw new OcrError('no_output', 'Audiveris output is not valid XML', String(e))
    }

    const root = (doc['score-partwise'] ?? doc['score-timewise']) as
      | Record<string, unknown> | undefined
    if (!root) {
      throw new OcrError('no_output', 'Audiveris output missing <score-partwise>')
    }

    // 0 音符检测
    const noteCount = countNotes(root)
    if (noteCount === 0) {
      throw new OcrError('low_confidence', 'Audiveris output has 0 notes')
    }

    // 复用元数据提取，fallback 用调用方传入的上传文件名
    // 显式挑出 meta 字段，避免 sourceXml 被带入（ParsedScore 含 sourceXml，但这里单独返回）
    const parsed = extractMusicXmlMetadata(root, xmlText, input.fallbackTitle)
    const meta = {
      title: parsed.title,
      composer: parsed.composer,
      tempo: parsed.tempo,
    }

    return { musicXml: xmlText, meta }
  }

  // 外部（OcrRunner.cancel）终止运行中的进程
  cancel(): void {
    this.currentChild?.kill('SIGKILL')
  }

  // 包裹 child 进程：超时 kill + exit code 校验 + stderr 封顶
  // 抽成方法便于子类/测试覆盖
  protected async runWithTimeout(child: ChildProcess): Promise<void> {
    this.currentChild = child
    return new Promise((resolve, reject) => {
      let stderrBuf = ''
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGKILL')
        reject(new OcrError('engine_crash', 'Audiveris timed out', `${TIMEOUT_MS}ms`))
      }, TIMEOUT_MS)

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8')
        // 封顶：保留尾部
        if (stderrBuf.length > STDERR_CAP) {
          stderrBuf = stderrBuf.slice(-STDERR_CAP)
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        if (killed) return // timeout 已 reject
        reject(new OcrError('engine_crash', 'Failed to spawn Audiveris', String(err)))
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) return // 已 reject
        if (code === 0) {
          resolve()
        } else {
          reject(new OcrError('engine_crash', `Audiveris exited with code ${code}`, stderrBuf.slice(-2000)))
        }
      })
    })
  }
}

function countNotes(root: Record<string, unknown>): number {
  const parts = Array.isArray(root['part']) ? root['part'] : root['part'] ? [root['part']] : []
  let count = 0
  for (const p of parts as Record<string, unknown>[]) {
    const measures = Array.isArray(p['measure']) ? p['measure'] : p['measure'] ? [p['measure']] : []
    for (const m of measures as Record<string, unknown>[]) {
      const notes = Array.isArray(m['note']) ? m['note'] : m['note'] ? [m['note']] : []
      count += notes.length
    }
  }
  return count
}
