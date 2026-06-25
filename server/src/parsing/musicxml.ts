import { XMLParser } from 'fast-xml-parser'
import { unzipSync, strFromU8 } from 'fflate'
import { ParseError } from './parser.js'
import type { ParsedScore, ScoreParser } from './parser.js'

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['part', 'measure', 'note'].includes(name),
})

// 从 .mxl（zip）中取出根 MusicXML 文档（需求 1.2）。
export function extractMxl(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  // META-INF/container.xml 指向根文档；缺失则回退到第一个非 META-INF 的 .xml。
  const container = files['META-INF/container.xml']
  if (container) {
    const doc = xml.parse(strFromU8(container))
    const full = doc?.container?.rootfiles?.rootfile?.['@_full-path']
    if (full && files[full]) return strFromU8(files[full])
  }
  const fallback = Object.keys(files).find(
    (n) => !n.startsWith('META-INF') && (n.endsWith('.xml') || n.endsWith('.musicxml')),
  )
  if (fallback) return strFromU8(files[fallback])
  throw new ParseError('Invalid .mxl', 'No MusicXML document found inside archive')
}

// zip 魔数 PK\x03\x04
export function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

export class MusicXmlParser implements ScoreParser {
  readonly format = 'musicxml'

  canParse(filename: string, _bytes: Uint8Array): boolean {
    const n = filename.toLowerCase()
    return n.endsWith('.musicxml') || n.endsWith('.xml') || n.endsWith('.mxl')
  }

  async parse(bytes: Uint8Array): Promise<ParsedScore> {
    const text = isZip(bytes) ? extractMxl(bytes) : strFromU8(bytes)
    let doc: Record<string, unknown>
    try {
      doc = xml.parse(text)
    } catch (e) {
      throw new ParseError('Malformed XML', String(e))
    }
    const root = (doc['score-partwise'] ?? doc['score-timewise']) as Record<string, unknown> | undefined
    if (!root) throw new ParseError('Not a MusicXML document', 'Missing <score-partwise> root')
    return extractMusicXmlMetadata(root, text)
  }
}

// 从 MusicXML 根对象提取元数据（标题、作曲家、速度）。fallbackTitle 用于缺标题时回退。
export function extractMusicXmlMetadata(
  root: Record<string, unknown>,
  sourceXml: string,
  fallbackTitle = 'Untitled',
): ParsedScore {
  // 标题：<work><work-title> 或 <movement-title>
  const work = root['work'] as { 'work-title'?: string } | undefined
  const ident = root['identification'] as { creator?: unknown } | undefined
  const title = work?.['work-title'] ?? (root['movement-title'] as string) ?? fallbackTitle

  // 作曲家：<identification><creator type="composer">
  const composer = asArray(ident?.creator)
    .map((c) => (typeof c === 'object' ? (c as Record<string, unknown>)['#text'] : c))
    .find(Boolean) as string | undefined

  // 速度：遍历所有小节找第一个 <sound tempo="...">
  let tempo = 120
  const parts = asArray(root['part'] as unknown)
  if (parts.length) {
    const measuresXml = asArray((parts[0] as Record<string, unknown>)['measure'] as unknown)
    for (const m of measuresXml) {
      const mEl = m as Record<string, unknown>
      const sound = (mEl['sound'] ?? (mEl['direction'] as Record<string, unknown>)?.['sound']) as Record<string, unknown> | undefined
      if (sound?.['@_tempo'] !== undefined) {
        tempo = num(sound['@_tempo'], tempo)
        break
      }
    }
  }

  return { title: String(title), composer, tempo, sourceXml }
}
