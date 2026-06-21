/**
 * Regression tests: verify RealValue → durationBeats conversion is correct.
 *
 * OSMD returns Length.RealValue in whole-note units (quarter = 0.25, half = 0.5).
 * extractTargetFromCursor must convert to quarter-note beats (× 4) so that
 * buildTargetTimeline / tempoTick produce musically correct timing.
 */
import { describe, it, expect } from 'vitest'
import { extractTargetFromCursor } from '../extractTargets'
import { buildTargetTimeline, tempoTick, initPositionState } from '@/scoring/position'
import type { CursorNote } from '../extractTargets'
import type { ScoringTarget } from '@/types/music'

// ── OSMD whole-note unit constants ─────────────────────────────────────────

const QUARTER = 0.25   // quarter note
const HALF    = 0.5    // half note
const WHOLE   = 1.0    // whole note

function realNote(halfTone: number, staff: number, duration: number): CursorNote {
  return {
    halfTone,
    isRest: () => false,
    ParentStaff: { Id: staff },
    Length: { RealValue: duration },
  }
}

describe('RealValue → durationBeats conversion', () => {
  it('converts quarter note RealValue=0.25 to durationBeats=1.0', () => {
    const note = realNote(72, 1, QUARTER)
    const result = extractTargetFromCursor([note], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.durationBeats).toBe(1.0)
  })

  it('converts half note RealValue=0.5 to durationBeats=2.0', () => {
    const note = realNote(72, 1, HALF)
    const result = extractTargetFromCursor([note], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.durationBeats).toBe(2.0)
  })

  it('converts whole note RealValue=1.0 to durationBeats=4.0', () => {
    const note = realNote(72, 1, WHOLE)
    const result = extractTargetFromCursor([note], [], 0)

    expect(result).not.toBeNull()
    expect(result!.target.durationBeats).toBe(4.0)
  })
})

describe('End-to-end timing with ×4 conversion', () => {
  it('4 quarter notes at 120 BPM span 4 beats (2000ms)', () => {
    const targets: ScoringTarget[] = [0, 1, 2, 3].map((i) => ({
      index: i,
      midiNotes: [72 + i],
      hands: ['right'] as const,
      durationBeats: 1.0,  // QUARTER * 4
    }))

    const timeline = buildTargetTimeline(targets)

    expect(timeline).toEqual([
      { onsetBeat: 0, durationBeats: 1 },
      { onsetBeat: 1, durationBeats: 1 },
      { onsetBeat: 2, durationBeats: 1 },
      { onsetBeat: 3, durationBeats: 1 },
    ])

    const totalBeats = timeline[3]!.onsetBeat + timeline[3]!.durationBeats
    expect(totalBeats).toBe(4.0)
  })

  it('quarter note at 120 BPM lasts 500ms', () => {
    const targets: ScoringTarget[] = [
      { index: 0, midiNotes: [72], hands: ['right'], durationBeats: 1.0 },
      { index: 1, midiNotes: [74], hands: ['right'], durationBeats: 1.0 },
    ]
    const timeline = buildTargetTimeline(targets)
    const tempo = 120

    // Quarter note should last 500ms at 120 BPM
    const at400ms = tempoTick(initPositionState(), timeline, tempo, 400)
    expect(at400ms.targetIndex).toBe(0)  // still on first quarter note

    const at500ms = tempoTick(initPositionState(), timeline, tempo, 500)
    expect(at500ms.targetIndex).toBe(1)  // boundary — advances to second

    const at900ms = tempoTick(initPositionState(), timeline, tempo, 900)
    expect(at900ms.targetIndex).toBe(1)  // still on second quarter note

    const at1000ms = tempoTick(initPositionState(), timeline, tempo, 1000)
    expect(at1000ms.targetIndex).toBe(2)  // past the end
  })

  it('half notes at 120 BPM last 1000ms each', () => {
    const targets: ScoringTarget[] = [
      { index: 0, midiNotes: [72, 76], hands: ['right'], durationBeats: 2.0 },
      { index: 1, midiNotes: [79], hands: ['right'], durationBeats: 2.0 },
    ]
    const timeline = buildTargetTimeline(targets)
    const tempo = 120

    // Half note = 2 quarter-note beats = 1000ms at 120 BPM
    const at900ms = tempoTick(initPositionState(), timeline, tempo, 900)
    expect(at900ms.targetIndex).toBe(0)  // still in first half note

    const at1000ms = tempoTick(initPositionState(), timeline, tempo, 1000)
    expect(at1000ms.targetIndex).toBe(1)  // boundary — advances

    const at1999ms = tempoTick(initPositionState(), timeline, tempo, 1999)
    expect(at1999ms.targetIndex).toBe(1)  // still in second half note

    const at2000ms = tempoTick(initPositionState(), timeline, tempo, 2000)
    expect(at2000ms.targetIndex).toBe(2)  // past the end
  })

  it('60 BPM: quarter note lasts 1000ms', () => {
    const targets: ScoringTarget[] = [
      { index: 0, midiNotes: [60], hands: ['right'], durationBeats: 1.0 },
      { index: 1, midiNotes: [62], hands: ['right'], durationBeats: 1.0 },
    ]
    const timeline = buildTargetTimeline(targets)
    const tempo = 60  // msPerBeat = 1000ms

    const at500ms = tempoTick(initPositionState(), timeline, tempo, 500)
    expect(at500ms.targetIndex).toBe(0)  // still on first note

    const at1000ms = tempoTick(initPositionState(), timeline, tempo, 1000)
    expect(at1000ms.targetIndex).toBe(1)  // boundary

    const at2000ms = tempoTick(initPositionState(), timeline, tempo, 2000)
    expect(at2000ms.targetIndex).toBe(2)  // past end
  })
})
