/**
 * Range filtering for ScoringTargets by measure number.
 *
 * Pure functions for filtering targets within a measure range,
 * used by PracticePage for measure-range selection.
 */

import type { ScoringTarget } from '@/types/music'

/** Measure range selection (1-based, inclusive). */
export interface MeasureRange {
  start: number
  end: number
}

/**
 * Filter targets to only include those within the given measure range.
 *
 * Targets without a measureNumber are excluded when a range is active.
 * Returns the full list when range is null.
 */
export function filterTargetsByRange(
  targets: ScoringTarget[],
  range: MeasureRange | null,
): ScoringTarget[] {
  if (!range) return targets
  return targets.filter((t) => {
    const m = t.measureNumber
    return m !== undefined && m >= range.start && m <= range.end
  })
}
