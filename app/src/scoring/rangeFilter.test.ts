import { describe, it, expect } from 'vitest'
import type { ScoringTarget } from '@/types/music'
import { filterTargetsByRange, type MeasureRange } from './rangeFilter'

// ── Test helpers ──────────────────────────────────────────────────────────

function target(index: number, measureNumber?: number): ScoringTarget {
  return {
    index,
    midiNotes: [60 + index],
    hands: ['right'],
    durationBeats: 1,
    ...(measureNumber !== undefined ? { measureNumber } : {}),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('filterTargetsByRange', () => {
  it('returns all targets when range is null', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 3)]
    const result = filterTargetsByRange(targets, null)
    expect(result).toEqual(targets)
  })

  it('filters targets within the given measure range', () => {
    const targets = [
      target(0, 1),
      target(1, 1),
      target(2, 2),
      target(3, 3),
      target(4, 3),
      target(5, 4),
    ]
    const range: MeasureRange = { start: 2, end: 3 }
    const result = filterTargetsByRange(targets, range)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.index)).toEqual([2, 3, 4])
  })

  it('returns single measure when start equals end', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 3)]
    const range: MeasureRange = { start: 2, end: 2 }
    const result = filterTargetsByRange(targets, range)
    expect(result).toHaveLength(1)
    expect(result[0].index).toBe(1)
  })

  it('excludes targets without measureNumber when range is active', () => {
    const targets = [
      target(0, 1),
      target(1), // no measureNumber
      target(2, 2),
    ]
    const range: MeasureRange = { start: 1, end: 2 }
    const result = filterTargetsByRange(targets, range)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.index)).toEqual([0, 2])
  })

  it('returns empty array when no targets match the range', () => {
    const targets = [target(0, 1), target(1, 2)]
    const range: MeasureRange = { start: 5, end: 10 }
    const result = filterTargetsByRange(targets, range)
    expect(result).toHaveLength(0)
  })

  it('returns empty array for empty targets', () => {
    const range: MeasureRange = { start: 1, end: 3 }
    const result = filterTargetsByRange([], range)
    expect(result).toHaveLength(0)
  })

  it('handles range covering all measures', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 3)]
    const range: MeasureRange = { start: 1, end: 3 }
    const result = filterTargetsByRange(targets, range)
    expect(result).toEqual(targets)
  })

  it('does not mutate the input array', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 3)]
    const original = [...targets]
    const range: MeasureRange = { start: 1, end: 2 }
    filterTargetsByRange(targets, range)
    expect(targets).toEqual(original)
  })
})
