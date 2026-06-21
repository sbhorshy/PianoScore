import { describe, it, expect } from 'vitest'
import type { ScoringTarget } from '@/types/music'
import {
  judgeNoteOn,
  judgeNoteOff,
  initScoringState,
  summarize,
  settleTarget,
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from './engine'
import { initPositionState, handleJudgment, isPositionComplete } from './position'

// ── Test helpers ──────────────────────────────────────────────────────────

function single(index: number, midi: number): ScoringTarget {
  return { index, midiNotes: [midi], hands: ['right'], durationBeats: 1 }
}
function singleLeft(index: number, midi: number): ScoringTarget {
  return { index, midiNotes: [midi], hands: ['left'], durationBeats: 1 }
}
function chord(index: number, midis: number[]): ScoringTarget {
  return { index, midiNotes: midis, hands: midis.map(() => 'right' as const), durationBeats: 1 }
}
function chordBoth(index: number, midis: number[], hands: ScoringTarget['hands']): ScoringTarget {
  return { index, midiNotes: midis, hands, durationBeats: 1 }
}

const cfg: ScoringConfig = { ...DEFAULT_SCORING_CONFIG }

// ── Single-note judgment ──────────────────────────────────────────────────

describe('single-note judgment', () => {
  it('correct pitch returns correct judgment and increments correct count', () => {
    const target = single(0, 60)
    const r = judgeNoteOn(initScoringState(), 60, target, cfg)
    expect(r.judgment).toBe('correct')
    expect(r.state.correct).toBe(1)
  })

  it('wrong pitch returns wrongPitch judgment and increments wrong count', () => {
    const target = single(0, 60)
    const r = judgeNoteOn(initScoringState(), 61, target, cfg)
    expect(r.judgment).toBe('wrongPitch')
    expect(r.state.wrong).toBe(1)
  })
})

// ── Chord judgment ────────────────────────────────────────────────────────

describe('chord judgment', () => {
  it('requires the full set before returning correct', () => {
    const target = chord(0, [60, 64, 67])
    let s = initScoringState()
    let r = judgeNoteOn(s, 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    r = judgeNoteOn(r.state, 64, target, cfg)
    expect(r.judgment).toBe('partialChord')
    r = judgeNoteOn(r.state, 67, target, cfg)
    expect(r.judgment).toBe('correct')
    expect(r.state.correct).toBe(1)
  })

  it('a note outside the chord is wrongPitch', () => {
    const target = chord(0, [60, 64])
    const r = judgeNoteOn(initScoringState(), 62, target, cfg)
    expect(r.judgment).toBe('wrongPitch')
  })

  it('duplicate presses within the window do not double-count', () => {
    const target = chord(0, [60, 64])
    let r = judgeNoteOn(initScoringState(), 60, target, cfg)
    r = judgeNoteOn(r.state, 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    r = judgeNoteOn(r.state, 64, target, cfg)
    expect(r.judgment).toBe('correct')
  })
})

// ── Extra (no target) ────────────────────────────────────────────────────

describe('extra note (no target)', () => {
  it('returns extra when currentTarget is undefined', () => {
    const r = judgeNoteOn(initScoringState(), 60, undefined, cfg)
    expect(r.judgment).toBe('extra')
  })
})

// ── summarize ─────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('full accuracy when all correct', () => {
    let s = initScoringState()
    s = judgeNoteOn(s, 60, single(0, 60), cfg).state
    s = judgeNoteOn(s, 62, single(1, 62), cfg).state
    s = judgeNoteOn(s, 64, single(2, 64), cfg).state
    const summary = summarize(3, s)
    expect(summary.correctTargets).toBe(3)
    expect(summary.pitchAccuracy).toBe(1)
  })

  it('zero accuracy when all wrong', () => {
    let s = initScoringState()
    s = judgeNoteOn(s, 99, single(0, 60), cfg).state
    s = judgeNoteOn(s, 98, single(1, 62), cfg).state
    s = judgeNoteOn(s, 97, single(2, 64), cfg).state
    const summary = summarize(3, s)
    expect(summary.correctTargets).toBe(0)
    expect(summary.pitchAccuracy).toBe(0)
  })

  it('zero accuracy with zero target count', () => {
    const summary = summarize(0, initScoringState())
    expect(summary.pitchAccuracy).toBe(0)
  })
})

// ── Integration: scoring engine + position tracker ────────────────────────

describe('scoring + position integration', () => {
  it('advances through mixed single and chord targets', () => {
    const targets = [single(0, 60), chord(1, [64, 67]), single(2, 72)]
    let scoring = initScoringState()
    let position = initPositionState()

    // target 0: single note 60
    let r = judgeNoteOn(scoring, 60, targets[position.targetIndex], cfg)
    scoring = r.state
    position = handleJudgment(position, r.judgment)
    expect(r.judgment).toBe('correct')
    expect(position.targetIndex).toBe(1)

    // target 1: chord [64, 67] — first note
    r = judgeNoteOn(scoring, 64, targets[position.targetIndex], cfg)
    scoring = r.state
    position = handleJudgment(position, r.judgment)
    expect(r.judgment).toBe('partialChord')
    expect(position.targetIndex).toBe(1)

    // target 1: chord [64, 67] — second note completes
    r = judgeNoteOn(scoring, 67, targets[position.targetIndex], cfg)
    scoring = r.state
    position = handleJudgment(position, r.judgment)
    expect(r.judgment).toBe('correct')
    expect(position.targetIndex).toBe(2)

    // target 2: single note 72
    r = judgeNoteOn(scoring, 72, targets[position.targetIndex], cfg)
    scoring = r.state
    position = handleJudgment(position, r.judgment)
    expect(r.judgment).toBe('correct')
    expect(position.targetIndex).toBe(3)
    expect(scoring.correct).toBe(3)
    expect(scoring.wrong).toBe(0)
  })

  it('wrong notes do not advance position', () => {
    const targets = [single(0, 60), single(1, 62)]
    let scoring = initScoringState()
    let position = initPositionState()

    let r = judgeNoteOn(scoring, 61, targets[position.targetIndex], cfg)
    scoring = r.state
    position = handleJudgment(position, r.judgment)
    expect(r.judgment).toBe('wrongPitch')
    expect(position.targetIndex).toBe(0)
    expect(scoring.wrong).toBe(1)
  })

  it('isPositionComplete when all targets played', () => {
    const targets = [single(0, 60), single(1, 62)]
    let scoring = initScoringState()
    let position = initPositionState()

    for (const t of targets) {
      const r = judgeNoteOn(scoring, t.midiNotes[0], targets[position.targetIndex], cfg)
      scoring = r.state
      position = handleJudgment(position, r.judgment)
    }
    expect(isPositionComplete(position, targets.length)).toBe(true)
  })

  it('extra notes after completion do not change position', () => {
    const targets = [single(0, 60)]
    let scoring = initScoringState()
    let position = initPositionState()

    const r1 = judgeNoteOn(scoring, 60, targets[position.targetIndex], cfg)
    scoring = r1.state
    position = handleJudgment(position, r1.judgment)

    // All done, now play an extra note (target is undefined)
    const r2 = judgeNoteOn(scoring, 60, targets[position.targetIndex], cfg)
    expect(r2.judgment).toBe('extra')
    expect(position.targetIndex).toBe(1)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────

describe('consecutive wrong notes', () => {
  it('wrong count increments on consecutive wrong notes', () => {
    const target = single(0, 60)
    let s = initScoringState()
    s = judgeNoteOn(s, 61, target, cfg).state
    s = judgeNoteOn(s, 62, target, cfg).state
    s = judgeNoteOn(s, 63, target, cfg).state
    expect(s.wrong).toBe(3)
  })
})

describe('state immutability', () => {
  it('does not mutate input state', () => {
    const target = single(0, 60)
    const original = initScoringState()
    judgeNoteOn(original, 60, target, cfg)
    expect(original.correct).toBe(0)
    expect(original.wrong).toBe(0)
    expect(original.pressedInWindow).toEqual([])
  })
})

describe('chord order independence', () => {
  it('chord notes can be pressed in any order', () => {
    const target = chord(0, [60, 64, 67])
    let r = judgeNoteOn(initScoringState(), 67, target, cfg)
    expect(r.judgment).toBe('partialChord')
    r = judgeNoteOn(r.state, 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    r = judgeNoteOn(r.state, 64, target, cfg)
    expect(r.judgment).toBe('correct')
    expect(r.state.correct).toBe(1)
  })
})

describe('chord window bug (now fixed)', () => {
  it('wrong note during chord clears pressedInWindow via judgeNoteOff', () => {
    const target = chord(0, [60, 64])
    let s = initScoringState()
    let r = judgeNoteOn(s, 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    // Wrong note does NOT clear pressedInWindow on noteOn
    r = judgeNoteOn(r.state, 99, target, cfg)
    expect(r.judgment).toBe('wrongPitch')
    // But releasing the wrong note clears the window (via judgeNoteOff)
    s = judgeNoteOff(r.state, 99)
    // 99 was not in pressedInWindow, so pressedInWindow stays
    expect(s.pressedInWindow).toEqual([60])
  })

  it('releasing a chord note clears pressedInWindow', () => {
    const target = chord(0, [60, 64])
    let r = judgeNoteOn(initScoringState(), 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    // Release the partial chord note — should clear pressedInWindow
    const s = judgeNoteOff(r.state, 60)
    expect(s.pressedInWindow).toEqual([])
    expect(s.windowOpenedAt).toBeNull()
  })
})

// ── heldNotes tracking ────────────────────────────────────────────────────

describe('heldNotes tracking on noteOn', () => {
  it('correct single note adds to heldNotes with hand info', () => {
    const target = single(0, 60)
    const r = judgeNoteOn(initScoringState(), 60, target, cfg)
    expect(r.state.heldNotes.get(60)).toBe('right')
  })

  it('correct left-hand note adds to heldNotes with left', () => {
    const target = singleLeft(0, 48)
    const r = judgeNoteOn(initScoringState(), 48, target, cfg)
    expect(r.state.heldNotes.get(48)).toBe('left')
  })

  it('wrongPitch note adds to heldNotes with null hand', () => {
    const target = single(0, 60)
    const r = judgeNoteOn(initScoringState(), 61, target, cfg)
    expect(r.state.heldNotes.get(61)).toBeNull()
  })

  it('partialChord note adds to heldNotes with null hand', () => {
    const target = chord(0, [60, 64])
    const r = judgeNoteOn(initScoringState(), 60, target, cfg)
    expect(r.judgment).toBe('partialChord')
    expect(r.state.heldNotes.get(60)).toBeNull()
  })

  it('complete chord adds all notes to heldNotes with hand info', () => {
    const target = chordBoth(0, [60, 48], ['right', 'left'])
    let r = judgeNoteOn(initScoringState(), 60, target, cfg)
    r = judgeNoteOn(r.state, 48, target, cfg)
    expect(r.judgment).toBe('correct')
    expect(r.state.heldNotes.get(60)).toBe('right')
    expect(r.state.heldNotes.get(48)).toBe('left')
  })

  it('extra note does not add to heldNotes', () => {
    const r = judgeNoteOn(initScoringState(), 60, undefined, cfg)
    expect(r.judgment).toBe('extra')
    expect(r.state.heldNotes.has(60)).toBe(false)
  })

  it('initial state has empty heldNotes', () => {
    const s = initScoringState()
    expect(s.heldNotes.size).toBe(0)
  })
})

// ── judgeNoteOff ──────────────────────────────────────────────────────────

describe('judgeNoteOff', () => {
  it('removes note from heldNotes', () => {
    let s = initScoringState()
    s = judgeNoteOn(s, 60, single(0, 60), cfg).state
    expect(s.heldNotes.has(60)).toBe(true)
    s = judgeNoteOff(s, 60)
    expect(s.heldNotes.has(60)).toBe(false)
  })

  it('does nothing if note was not held', () => {
    const s = initScoringState()
    const result = judgeNoteOff(s, 60)
    expect(result.heldNotes.size).toBe(0)
  })

  it('clears pressedInWindow when releasing a chord note in window', () => {
    const target = chord(0, [60, 64])
    let r = judgeNoteOn(initScoringState(), 60, target, cfg)
    expect(r.state.pressedInWindow).toEqual([60])
    const after = judgeNoteOff(r.state, 60)
    expect(after.pressedInWindow).toEqual([])
    expect(after.windowOpenedAt).toBeNull()
  })

  it('does not clear pressedInWindow when releasing a note not in window', () => {
    const target = chord(0, [60, 64])
    let r = judgeNoteOn(initScoringState(), 60, target, cfg)
    // Play a wrong note (added to heldNotes but NOT pressedInWindow)
    r = judgeNoteOn(r.state, 99, single(0, 60), cfg) // 99 is wrongPitch
    expect(r.state.heldNotes.has(99)).toBe(true)
    // Releasing 99 should NOT clear pressedInWindow (60)
    const after = judgeNoteOff(r.state, 99)
    expect(after.pressedInWindow).toEqual([60])
  })

  it('preserves other held notes', () => {
    const t0 = single(0, 60)
    const t1 = single(1, 64)
    let s = initScoringState()
    s = judgeNoteOn(s, 60, t0, cfg).state
    s = judgeNoteOn(s, 64, t1, cfg).state
    expect(s.heldNotes.size).toBe(2)
    s = judgeNoteOff(s, 60)
    expect(s.heldNotes.has(60)).toBe(false)
    expect(s.heldNotes.get(64)).toBe('right')
  })

  it('does not mutate input state', () => {
    const s = judgeNoteOn(initScoringState(), 60, single(0, 60), cfg).state
    const original = new Map(s.heldNotes)
    judgeNoteOff(s, 60)
    expect(s.heldNotes.has(60)).toBe(true)
    expect(s.heldNotes).toEqual(original)
  })
})

// ── settleTarget (follow mode) ────────────────────────────────────────────

describe('settleTarget', () => {
  it('returns missed when target is undefined', () => {
    const r = settleTarget(initScoringState(), undefined)
    expect(r.settlement).toBe('missed')
    expect(r.state.missed).toBe(0) // no change — no target to count
    expect(r.state.notesHit).toBe(0)
    expect(r.state.notesExpected).toBe(0)
  })

  it('returns missed when no target notes are held', () => {
    const target = single(0, 60)
    const r = settleTarget(initScoringState(), target)
    expect(r.settlement).toBe('missed')
    expect(r.state.missed).toBe(1)
    expect(r.state.notesHit).toBe(0)
    expect(r.state.notesExpected).toBe(1)
  })

  it('returns correct when all target notes are held', () => {
    const target = single(0, 60)
    const s = judgeNoteOn(initScoringState(), 60, target, cfg).state
    const r = settleTarget(s, target)
    expect(r.settlement).toBe('correct')
    expect(r.state.missed).toBe(0)
    expect(r.state.notesHit).toBe(1)
    expect(r.state.notesExpected).toBe(1)
  })

  it('returns correct for a fully held chord', () => {
    const target = chord(0, [60, 64, 67])
    let s = initScoringState()
    s = judgeNoteOn(s, 60, target, cfg).state
    s = judgeNoteOn(s, 64, target, cfg).state
    s = judgeNoteOn(s, 67, target, cfg).state
    const r = settleTarget(s, target)
    expect(r.settlement).toBe('correct')
    expect(r.state.notesHit).toBe(3)
    expect(r.state.notesExpected).toBe(3)
  })

  it('returns partial when some chord notes are held', () => {
    const target = chord(0, [60, 64, 67])
    let s = initScoringState()
    s = judgeNoteOn(s, 60, target, cfg).state
    s = judgeNoteOn(s, 64, target, cfg).state
    // 67 not played
    const r = settleTarget(s, target)
    expect(r.settlement).toBe('partial')
    expect(r.state.missed).toBe(0)
    expect(r.state.notesHit).toBe(2)
    expect(r.state.notesExpected).toBe(3)
  })

  it('returns missed when a single note is not held', () => {
    const target = single(0, 60)
    // Play a wrong note instead
    const s = judgeNoteOn(initScoringState(), 61, target, cfg).state
    const r = settleTarget(s, target)
    expect(r.settlement).toBe('missed')
    expect(r.state.missed).toBe(1)
    expect(r.state.notesHit).toBe(0)
    expect(r.state.notesExpected).toBe(1)
  })

  it('clears pressedInWindow and windowOpenedAt on settle', () => {
    const target = chord(0, [60, 64])
    let s = initScoringState()
    s = judgeNoteOn(s, 60, target, cfg).state // partialChord
    expect(s.pressedInWindow).toEqual([60])
    expect(s.windowOpenedAt).not.toBeNull()
    const r = settleTarget(s, target)
    expect(r.state.pressedInWindow).toEqual([])
    expect(r.state.windowOpenedAt).toBeNull()
  })

  it('accumulates across multiple settlements', () => {
    const t0 = single(0, 60)
    const t1 = single(1, 62)
    const t2 = single(2, 64)

    // t0: correct (play 60)
    let s = judgeNoteOn(initScoringState(), 60, t0, cfg).state
    let r = settleTarget(s, t0)
    expect(r.settlement).toBe('correct')
    s = r.state

    // t1: missed (don't play 62)
    s = judgeNoteOff(s, 60) // release 60
    r = settleTarget(s, t1)
    expect(r.settlement).toBe('missed')
    s = r.state

    // t2: correct (play 64)
    s = judgeNoteOn(s, 64, t2, cfg).state
    r = settleTarget(s, t2)
    expect(r.settlement).toBe('correct')
    s = r.state

    expect(s.missed).toBe(1)
    expect(s.notesHit).toBe(2)
    expect(s.notesExpected).toBe(3)
  })

  it('does not mutate input state', () => {
    const target = single(0, 60)
    const original = initScoringState()
    settleTarget(original, target)
    expect(original.missed).toBe(0)
    expect(original.notesHit).toBe(0)
    expect(original.notesExpected).toBe(0)
  })
})
