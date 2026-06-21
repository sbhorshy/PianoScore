import { describe, it, expect } from 'vitest'
import { extractTargetFromCursor } from './extractTargets'
import type { CursorNote, CursorGNote } from './extractTargets'

// ── Test fixtures ────────────────────────────────────────────────────────
// Build a fake OSMD-like note. Length is in whole-note units (quarter = 0.25).

function note(
  halfTone: number,
  opts: {
    staff?: number
    lengthWhole?: number
    rest?: boolean
  } = {},
): CursorNote {
  const { staff = 1, lengthWhole = 0.25, rest = false } = opts
  return {
    halfTone,
    isRest: () => rest,
    ParentStaff: { Id: staff },
    Length: { RealValue: lengthWhole },
  }
}

/** Wrap notes in a shared Tie. notes[0] is the StartNote; rest are continuations. */
function tieChain(notes: CursorNote[]): void {
  let totalWhole = 0
  for (const n of notes) totalWhole += n.Length.RealValue
  const tie = {
    StartNote: notes[0],
    Duration: { RealValue: totalWhole },
  }
  for (const n of notes) {
    n.NoteTie = tie
  }
}

function gnote(source: CursorNote | null): CursorGNote {
  return { sourceNote: source }
}

// ── Untied notes (baseline — no regression) ────────────────────────────────

describe('extractTargetFromCursor — untied', () => {
  it('extracts a single note as one target', () => {
    const n = note(48) // OSMD C4
    const res = extractTargetFromCursor([n], [gnote(n)], 0)
    expect(res?.target.midiNotes).toEqual([60]) // → MIDI C4
    expect(res?.target.noteDurations).toEqual([1]) // 0.25 whole × 4 = 1 beat
  })

  it('keeps a repeated same-pitch note as its own target (no tie → not a continuation)', () => {
    // Two SEPARATE C4 strikes with no tie must both score. This is the case a
    // pitch-based heuristic would wrongly merge.
    const first = note(48)
    const r1 = extractTargetFromCursor([first], [gnote(first)], 0)
    const second = note(48)
    const r2 = extractTargetFromCursor([second], [gnote(second)], 1)
    expect(r1?.target.midiNotes).toEqual([60])
    expect(r2?.target.midiNotes).toEqual([60])
  })
})

// ── Tie handling ────────────────────────────────────────────────────────────

describe('extractTargetFromCursor — ties', () => {
  it('start note carries the merged tie duration', () => {
    // C half-note tied to C half-note: struck once, rings 2 + 2 = 4 beats.
    const start = note(48, { lengthWhole: 0.5 })
    const cont = note(48, { lengthWhole: 0.5 })
    tieChain([start, cont])

    const res = extractTargetFromCursor([start], [gnote(start)], 0)
    expect(res?.target.midiNotes).toEqual([60])
    // 0.5 + 0.5 = 1.0 whole × 4 = 4 beats merged, not 2.
    expect(res?.target.noteDurations).toEqual([4])
    expect(res?.target.durationBeats).toBe(4)
  })

  it('continuation onset becomes an empty placeholder target (rest-like)', () => {
    const start = note(48, { lengthWhole: 0.5 })
    const cont = note(48, { lengthWhole: 0.5 })
    tieChain([start, cont])

    // The cursor stop where only the continuation sounds.
    const res = extractTargetFromCursor([cont], [gnote(cont)], 1)
    expect(res?.target.midiNotes).toEqual([])
    expect(res?.target.hands).toEqual([])
    // gNote retained so the sustained notehead can be colored.
    expect(res?.gNotes).toHaveLength(1)
  })

  it('handles a 3-note tie chain: only the first onset strikes', () => {
    // C ~ C ~ C, each a quarter (0.25 whole). Merged = 0.75 whole = 3 beats.
    const a = note(48, { lengthWhole: 0.25 })
    const b = note(48, { lengthWhole: 0.25 })
    const c = note(48, { lengthWhole: 0.25 })
    tieChain([a, b, c])

    const r0 = extractTargetFromCursor([a], [gnote(a)], 0)
    const r1 = extractTargetFromCursor([b], [gnote(b)], 1)
    const r2 = extractTargetFromCursor([c], [gnote(c)], 2)

    expect(r0?.target.midiNotes).toEqual([60])
    expect(r0?.target.noteDurations).toEqual([3]) // whole chain
    expect(r1?.target.midiNotes).toEqual([]) // continuation
    expect(r2?.target.midiNotes).toEqual([]) // continuation
  })

  it('partially-tied chord keeps only the freshly-struck notes', () => {
    // Onset: C (tied over from previous beat) + E + G (new strikes).
    // Target must be [E, G]; the sustained C is not re-struck.
    const cStart = note(48, { lengthWhole: 0.5 })
    const cCont = note(48, { lengthWhole: 0.5 })
    tieChain([cStart, cCont])
    const e = note(52, { lengthWhole: 0.25 }) // OSMD E4
    const g = note(55, { lengthWhole: 0.25 }) // OSMD G4

    const res = extractTargetFromCursor(
      [cCont, e, g],
      [gnote(cCont), gnote(e), gnote(g)],
      5,
    )
    expect(res?.target.midiNotes).toEqual([64, 67]) // MIDI E4, G4
    expect(res?.target.noteDurations).toEqual([1, 1])
  })
})

// ── OSMD halfTone → MIDI conversion ───────────────────────────────────────
// Regression: OSMD's raw halfTone is NoteEnum + 12*octave (C4 = 48), which is
// 12 less than the standard MIDI number (C4 = 60). extractTargetFromCursor
// applies the +12 conversion so ScoringTarget.midiNotes are true MIDI values.

describe('extractTargetFromCursor — OSMD halfTone to MIDI', () => {
  it('C4 (OSMD 48) → MIDI 60', () => {
    const res = extractTargetFromCursor([note(48)], [gnote(note(48))], 0)
    expect(res?.target.midiNotes).toEqual([60])
  })

  it('C5 (OSMD 60) → MIDI 72', () => {
    const res = extractTargetFromCursor([note(60)], [gnote(note(60))], 0)
    expect(res?.target.midiNotes).toEqual([72])
  })

  it('A0 (OSMD 9) → MIDI 21, the bottom of the 88-key piano', () => {
    const res = extractTargetFromCursor([note(9)], [gnote(note(9))], 0)
    expect(res?.target.midiNotes).toEqual([21])
  })

  it('preserves accidentals: F#4 (OSMD 54) → MIDI 66', () => {
    const res = extractTargetFromCursor([note(54)], [gnote(note(54))], 0)
    expect(res?.target.midiNotes).toEqual([66])
  })

  it('applies the offset to every note in a chord', () => {
    // OSMD C4(48) + E4(52) + G4(55) → MIDI 60, 64, 67
    const c = note(48)
    const e = note(52)
    const g = note(55)
    const res = extractTargetFromCursor([c, e, g], [gnote(c), gnote(e), gnote(g)], 0)
    expect(res?.target.midiNotes).toEqual([60, 64, 67])
  })
})

