import { describe, it, expect } from 'vitest'
import { extractTargetFromCursor } from '../extractTargets'
import type { CursorNote, CursorGNote } from '../extractTargets'

// ── Mock factories ───────────────────────────────────────────────────────
// NOTE: `halfTone` here mimics OSMD's RAW value (NoteEnum + 12*octave, e.g.
// C4 = 48), which is 12 less than MIDI. extractTargetFromCursor converts it,
// so midiNotes assertions use the MIDI number (input + 12).

interface MockNoteOptions {
  halfTone: number
  staff?: number
  duration?: number
  rest?: boolean
}

function mockNote(opts: MockNoteOptions): CursorNote {
  return {
    halfTone: opts.halfTone,
    isRest: () => opts.rest ?? false,
    ParentStaff: { Id: opts.staff ?? 1 },
    Length: { RealValue: opts.duration ?? 1 },
  }
}

function mockGNote(sourceNote: CursorNote | null): CursorGNote {
  return { sourceNote }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('extractTargetFromCursor', () => {
  it('single right-hand note', () => {
    const note = mockNote({ halfTone: 60, staff: 1 }) // OSMD C5 (→ MIDI 72)
    const result = extractTargetFromCursor([note], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([72])
    expect(result!.target.hands).toEqual(['right'])
    expect(result!.target.index).toBe(0)
  })

  it('single left-hand note', () => {
    const note = mockNote({ halfTone: 36, staff: 2 }) // OSMD C3 (→ MIDI 48)
    const result = extractTargetFromCursor([note], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([48])
    expect(result!.target.hands).toEqual(['left'])
  })

  it('same-hand chord deduplicates hands', () => {
    const note1 = mockNote({ halfTone: 48, staff: 1 }) // OSMD C4 (→ MIDI 60)
    const note2 = mockNote({ halfTone: 52, staff: 1 }) // OSMD E4 (→ MIDI 64)
    const result = extractTargetFromCursor([note1, note2], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([60, 64])
    expect(result!.target.hands).toEqual(['right'])
  })

  it('both hands simultaneously', () => {
    const rightNote = mockNote({ halfTone: 60, staff: 1 }) // OSMD C5 (→ MIDI 72)
    const leftNote = mockNote({ halfTone: 36, staff: 2 })  // OSMD C3 (→ MIDI 48)
    const result = extractTargetFromCursor([rightNote, leftNote], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([72, 48])
    expect(result!.target.hands).toEqual(['right', 'left'])
  })

  it('all rests returns rest entry with empty midiNotes', () => {
    const rest1 = mockNote({ halfTone: 0, rest: true, duration: 0.25 })  // quarter rest
    const rest2 = mockNote({ halfTone: 0, rest: true, duration: 0.5 })   // half rest
    const result = extractTargetFromCursor([rest1, rest2], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([])
    expect(result!.target.hands).toEqual([])
    expect(result!.target.durationBeats).toBe(2)  // max(0.25, 0.5) * 4 = 2
    expect(result!.gNotes).toEqual([])
  })

  it('empty notes array returns null', () => {
    const result = extractTargetFromCursor([], [], 0)
    expect(result).toBeNull()
  })

  it('mixed active and rest', () => {
    const active = mockNote({ halfTone: 48, staff: 1 }) // OSMD C4 (→ MIDI 60)
    const rest = mockNote({ halfTone: 0, rest: true })
    const result = extractTargetFromCursor([active, rest], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.midiNotes).toEqual([60])
  })

  it('takes max duration (×4 converted to quarter-note beats)', () => {
    // RealValue in whole-note units: quarter=0.25, half=0.5, dotted-half=0.75
    const note1 = mockNote({ halfTone: 60, staff: 1, duration: 0.25 })
    const note2 = mockNote({ halfTone: 64, staff: 1, duration: 0.5 })
    const note3 = mockNote({ halfTone: 67, staff: 1, duration: 0.75 })
    const result = extractTargetFromCursor([note1, note2, note3], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.durationBeats).toBe(3)  // max(0.25,0.5,0.75) * 4 = 3
  })

  it('gNotes match only active notes', () => {
    const activeNote = mockNote({ halfTone: 60, staff: 1 })
    const restNote = mockNote({ halfTone: 0, rest: true })
    const activeGn = mockGNote(activeNote)
    const restGn = mockGNote(restNote)

    const result = extractTargetFromCursor(
      [activeNote, restNote],
      [activeGn, restGn],
      0,
    )

    expect(result).not.toBeNull()
    expect(result!.gNotes).toHaveLength(1)
    expect(result!.gNotes[0]).toBe(activeGn)
  })
})
