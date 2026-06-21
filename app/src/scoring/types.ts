// ── Scoring module contract ──────────────────────────────────────────────
// The sole entry point for judgment logic.  Later changes to judgment rules
// (strictness, chord tolerance, etc.) only touch this directory — UI and
// hooks are unaffected.

import type { Hand } from '@/types/music'

// ── Judgment result (returned by judgeNoteOn) ─────────────────────────────
export type Judgment = 'correct' | 'wrongPitch' | 'partialChord' | 'extra'

export interface ScoringConfig {
  chordWindowMs: number    // chord aggregation time window
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  chordWindowMs: 120,
}

/**
 * Scoring state — NO targetIndex (that lives in PositionState).
 * Only tracks judgment statistics, chord-window aggregation, and held notes.
 */
export interface ScoringState {
  pressedInWindow: number[]  // pitches pressed within the current chord window
  windowOpenedAt: number | null
  correct: number
  wrong: number
  /** Currently held-down MIDI notes and which hand they belong to (null if unknown) */
  heldNotes: Map<number, Hand | null>
  /** Targets that passed without being played (follow mode) */
  missed: number
  /** Individual notes correctly played — partial chord support */
  notesHit: number
  /** Total individual notes expected */
  notesExpected: number
}

export function initScoringState(): ScoringState {
  return {
    pressedInWindow: [],
    windowOpenedAt: null,
    correct: 0,
    wrong: 0,
    heldNotes: new Map(),
    missed: 0,
    notesHit: 0,
    notesExpected: 0,
  }
}
