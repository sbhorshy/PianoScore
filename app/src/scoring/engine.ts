import type { ScoringTarget } from '@/types/music'
import type { Judgment, ScoringConfig, ScoringState } from './types'

export * from './types'

// ── Helpers ──────────────────────────────────────────────────────────────

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((n) => sa.has(n))
}

// ── Core: judge a single MIDI note-on ────────────────────────────────────
// Pure function: (scoring state, midi note, current target, config) → new scoring state + judgment.
// Does NOT manage targetIndex — that is the Position Tracker's job (ADR 0002).

export interface JudgeResult {
  state: ScoringState
  judgment: Judgment
}

export function judgeNoteOn(
  state: ScoringState,
  midiNote: number,
  currentTarget: ScoringTarget | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: ScoringConfig,
): JudgeResult {
  if (!currentTarget) {
    return { state, judgment: 'extra' }
  }

  // Pitch not in the target set → wrongPitch
  if (!currentTarget.midiNotes.includes(midiNote)) {
    const heldNotes = new Map(state.heldNotes)
    heldNotes.set(midiNote, null)
    return {
      state: { ...state, wrong: state.wrong + 1, heldNotes },
      judgment: 'wrongPitch',
    }
  }

  // Single-note target: hit → correct
  if (currentTarget.midiNotes.length === 1) {
    const heldNotes = new Map(state.heldNotes)
    heldNotes.set(midiNote, currentTarget.hands[0] ?? null)
    return {
      state: {
        ...state,
        pressedInWindow: [],
        windowOpenedAt: null,
        correct: state.correct + 1,
        heldNotes,
      },
      judgment: 'correct',
    }
  }

  // Chord target: aggregate pitches within the window
  const pressed = state.pressedInWindow.includes(midiNote)
    ? state.pressedInWindow
    : [...state.pressedInWindow, midiNote]

  if (setsEqual(pressed, currentTarget.midiNotes)) {
    const heldNotes = new Map(state.heldNotes)
    for (let i = 0; i < currentTarget.midiNotes.length; i++) {
      heldNotes.set(currentTarget.midiNotes[i], currentTarget.hands[i] ?? null)
    }
    return {
      state: {
        ...state,
        pressedInWindow: [],
        windowOpenedAt: null,
        correct: state.correct + 1,
        heldNotes,
      },
      judgment: 'correct',
    }
  }

  // Window not yet complete → partialChord
  const heldNotes = new Map(state.heldNotes)
  heldNotes.set(midiNote, null)
  return {
    state: {
      ...state,
      pressedInWindow: pressed,
      windowOpenedAt: state.windowOpenedAt ?? performance.now(),
      heldNotes,
    },
    judgment: 'partialChord',
  }
}

// ── Note-off: release a held note ─────────────────────────────────────────

export function judgeNoteOff(
  state: ScoringState,
  midiNote: number,
): ScoringState {
  const heldNotes = new Map(state.heldNotes)
  heldNotes.delete(midiNote)

  // If the note was in pressedInWindow, clear the window (fixes chord-window bug)
  if (state.pressedInWindow.includes(midiNote)) {
    return {
      ...state,
      pressedInWindow: [],
      windowOpenedAt: null,
      heldNotes,
    }
  }

  return { ...state, heldNotes }
}

// ── Target settlement (follow mode) ─────────────────────────────────────────

export type TargetSettlement = 'correct' | 'partial' | 'missed'

export interface SettleResult {
  state: ScoringState
  settlement: TargetSettlement
}

/**
 * Settle a target that has passed (follow mode).
 *
 * Counts how many of the target's midiNotes are in heldNotes,
 * classifies as correct / partial / missed, and updates counters.
 * Clears pressedInWindow and windowOpenedAt for the settled target.
 */
export function settleTarget(
  state: ScoringState,
  target: ScoringTarget | undefined,
): SettleResult {
  if (!target) {
    return { state, settlement: 'missed' }
  }

  let hitCount = 0
  for (const note of target.midiNotes) {
    if (state.heldNotes.has(note)) {
      hitCount++
    }
  }

  const total = target.midiNotes.length
  let settlement: TargetSettlement
  if (hitCount === total) {
    settlement = 'correct'
  } else if (hitCount > 0) {
    settlement = 'partial'
  } else {
    settlement = 'missed'
  }

  const missed = settlement === 'missed' ? state.missed + 1 : state.missed

  return {
    state: {
      ...state,
      missed,
      notesHit: state.notesHit + hitCount,
      notesExpected: state.notesExpected + total,
      pressedInWindow: [],
      windowOpenedAt: null,
    },
    settlement,
  }
}

// ── Summary ──────────────────────────────────────────────────────────────

export interface ScoringSummary {
  totalTargets: number
  correctTargets: number
  wrongTargets: number
  pitchAccuracy: number   // 0..1
}

export function summarize(targetCount: number, state: ScoringState): ScoringSummary {
  return {
    totalTargets: targetCount,
    correctTargets: state.correct,
    wrongTargets: state.wrong,
    pitchAccuracy: targetCount ? state.correct / targetCount : 0,
  }
}
