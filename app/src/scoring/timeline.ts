/**
 * TargetTimeline — precomputed beat positions from ScoringTarget[].
 *
 * Used by TempoDrivenPosition (Step 1B) to know when each target starts
 * and how long it lasts. Built once when targets are loaded.
 */

import type { ScoringTarget } from '@/types/music'

export interface TargetTimeline {
  onsets: number[]       // beat position where each target starts
  durations: number[]    // duration in beats for each target
  totalBeats: number     // sum of all durations
}

export function buildTimeline(targets: ScoringTarget[]): TargetTimeline {
  const durations = targets.map((t) => t.durationBeats)
  const onsets: number[] = []
  let accumulated = 0
  for (const d of durations) {
    onsets.push(accumulated)
    accumulated += d
  }
  return {
    onsets,
    durations,
    totalBeats: durations.reduce((sum, d) => sum + d, 0),
  }
}
