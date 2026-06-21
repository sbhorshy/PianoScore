import { describe, it, expect } from 'vitest'
import { MusicXmlParser } from './musicxml'
import { ParseError } from './parser'

const enc = (s: string) => new TextEncoder().encode(s)

// 最小 MusicXML：1 小节，含标题、作曲家、速度。
const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>Test Piece</work-title></work>
  <identification><creator type="composer">Tester</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <sound tempo="100"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`

describe('MusicXmlParser', () => {
  it('parses title, composer, tempo', async () => {
    const r = await new MusicXmlParser().parse(enc(SAMPLE))
    expect(r.title).toBe('Test Piece')
    expect(r.composer).toBe('Tester')
    expect(r.tempo).toBe(100)
  })

  it('returns sourceXml as the raw XML string', async () => {
    const r = await new MusicXmlParser().parse(enc(SAMPLE))
    expect(r.sourceXml).toContain('<score-partwise')
    expect(r.sourceXml).toContain('Test Piece')
  })

  it('defaults title to Untitled when missing', async () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`
    const r = await new MusicXmlParser().parse(enc(xml))
    expect(r.title).toBe('Untitled')
    expect(r.composer).toBeUndefined()
  })

  it('uses movement-title when work-title is absent', async () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <movement-title>Movement A</movement-title>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`
    const r = await new MusicXmlParser().parse(enc(xml))
    expect(r.title).toBe('Movement A')
  })

  it('defaults tempo to 120 when no sound tempo element', async () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>No Tempo</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`
    const r = await new MusicXmlParser().parse(enc(xml))
    expect(r.tempo).toBe(120)
  })

  it('rejects non-MusicXML with ParseError', async () => {
    await expect(new MusicXmlParser().parse(enc('<html><body>nope</body></html>'))).rejects.toThrow(ParseError)
  })

  it('recognizes .musicxml, .xml, .mxl files', () => {
    const parser = new MusicXmlParser()
    expect(parser.canParse('test.musicxml', new Uint8Array())).toBe(true)
    expect(parser.canParse('test.xml', new Uint8Array())).toBe(true)
    expect(parser.canParse('test.mxl', new Uint8Array())).toBe(true)
    expect(parser.canParse('test.pdf', new Uint8Array())).toBe(false)
  })
})
