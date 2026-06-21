/**
 * Position Tracker — manages `targetIndex` independently from scoring logic.
 *
 * Pure functions operating on `PositionState`. The Position Tracker decides
 * **when** to advance; the Scoring Engine decides **what** was played.
 *
 * Two strategies (ADR 0002):
 *   - EventDrivenPosition (free practice): advance on correct judgment
 *   - TempoDrivenPosition (follow/listen): advance on clock tick via timeline
 */

import type { Judgment } from './types'
import type { ScoringTarget } from '@/types/music'

// ── State ──────────────────────────────────────────────────────────────────

export interface PositionState {
  targetIndex: number
}

export function initPositionState(): PositionState {
  return { targetIndex: 0 }
}

// ── Target timeline (TempoDrivenPosition) ───────────────────────────────────

/** Cumulative beat-offset for each target in the score. */
export interface TargetTimelineEntry {
  onsetBeat: number
  durationBeats: number
}

export type TargetTimeline = TargetTimelineEntry[]

/**
 * Build a timeline from ScoringTarget[].
 *
 * Two modes:
 *  - Real-onset (preferred): when every target carries `onsetBeat` (OSMD's
 *    enrolled timestamp), each entry's onset is the true musical onset,
 *    normalized so the first target starts at beat 0. Each entry's stepping
 *    `durationBeats` is the gap to the *next* target's onset, so the cursor
 *    advances at the correct musical time even when voices overlap (a
 *    sustained note no longer "eats" the timeline of the notes beneath it).
 *    The final entry keeps its own note length.
 *  - Accumulation (fallback): when onsets are absent, accumulate each target's
 *    own durationBeats. Correct only for monophonic input where the gap to the
 *    next note equals the note's own length.
 *
 * Entry i covers the beat range [onsetBeat, onsetBeat + durationBeats).
 */
export function buildTargetTimeline(targets: ScoringTarget[]): TargetTimeline {
  const hasRealOnsets =
    targets.length > 0 && targets.every((t) => typeof t.onsetBeat === 'number')

  if (hasRealOnsets) {
    const base = targets[0].onsetBeat as number
    return targets.map((t, i) => {
      const onsetBeat = (t.onsetBeat as number) - base
      const next = targets[i + 1]
      // Stepping duration = gap to the next target's onset. The cursor should
      // leave this position exactly when the next one begins.
      let durationBeats: number
      if (next) {
        const gap = (next.onsetBeat as number) - (t.onsetBeat as number)
        // Guard against zero/negative gaps (shouldn't occur — each cursor stop
        // has a distinct timestamp) by falling back to the note's own length.
        durationBeats = gap > 0 ? gap : t.durationBeats
      } else {
        durationBeats = t.durationBeats
      }
      return { onsetBeat, durationBeats }
    })
  }

  let cumulative = 0
  return targets.map((t) => {
    const entry: TargetTimelineEntry = {
      onsetBeat: cumulative,
      durationBeats: t.durationBeats,
    }
    cumulative += t.durationBeats
    return entry
  })
}

// ── Event-driven advancement (free practice) ──────────────────────────────

export function advancePosition(state: PositionState): PositionState {
  return { targetIndex: state.targetIndex + 1 }
}

/** Advance only on 'correct' judgment — the EventDrivenPosition strategy. */
export function handleJudgment(state: PositionState, judgment: Judgment): PositionState {
  if (judgment === 'correct') {
    return advancePosition(state)
  }
  return state
}

// ── Tempo-driven advancement (follow / listen mode) ───────────────────────

/**
 * Determine the current target index from elapsed time and tempo.
 *
 * Pure function: (state, timeline, tempo, elapsedMs) -> updated state.
 *
 * - elapsedMs / (60000 / tempo) = current beat position
 * - Binary search the timeline for the entry whose [onset, onset+duration)
 *   range covers the current beat.
 * - Never goes backwards from the current state (monotonic advance).
 */
export function tempoTick(
  state: PositionState,
  timeline: TargetTimeline,
  tempo: number,
  elapsedMs: number,
): PositionState {
  if (timeline.length === 0) {
    return state
  }

  // Convert elapsed time to beat position.
  const msPerBeat = 60000 / tempo
  const currentBeat = elapsedMs / msPerBeat

  // Find the target whose range covers currentBeat.
  // Timeline is sorted by onsetBeat, so we scan linearly.
  // For large timelines a binary search would be better, but for MVP this is fine.
  let targetIndex = timeline.length // default: past the end
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]
    if (currentBeat < entry.onsetBeat + entry.durationBeats) {
      targetIndex = i
      break
    }
  }

  // Never go backwards — monotonically advance or stay.
  if (targetIndex < state.targetIndex) {
    return state
  }

  return { targetIndex }
}

// ── Completion check ──────────────────────────────────────────────────────

export function isPositionComplete(state: PositionState, targetCount: number): boolean {
  return state.targetIndex >= targetCount
}

// ── Reset ─────────────────────────────────────────────────────────────────

export function resetPosition(): PositionState {
  return initPositionState()
}
