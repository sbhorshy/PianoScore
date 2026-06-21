import { describe, it, expect } from 'vitest'
import type { ScoringTarget } from '@/types/music'
import { buildTimeline } from './timeline'

function target(index: number, durationBeats: number): ScoringTarget {
  return {
    index,
    midiNotes: [60],
    hands: ['right'],
    durationBeats,
  }
}

describe('TargetTimeline', () => {
  it('computes onsets from sequential durations', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 0.5)]
    const tl = buildTimeline(targets)
    expect(tl.onsets).toEqual([0, 1, 3])
    expect(tl.durations).toEqual([1, 2, 0.5])
  })

  it('computes totalBeats as sum of all durations', () => {
    const targets = [target(0, 1), target(1, 2), target(2, 0.5)]
    const tl = buildTimeline(targets)
    expect(tl.totalBeats).toBe(3.5)
  })

  it('handles empty targets', () => {
    const tl = buildTimeline([])
    expect(tl.onsets).toEqual([])
    expect(tl.durations).toEqual([])
    expect(tl.totalBeats).toBe(0)
  })

  it('handles single target', () => {
    const tl = buildTimeline([target(0, 4)])
    expect(tl.onsets).toEqual([0])
    expect(tl.durations).toEqual([4])
    expect(tl.totalBeats).toBe(4)
  })

  it('handles fractional durations accurately', () => {
    const targets = [target(0, 0.25), target(1, 0.25), target(2, 0.5)]
    const tl = buildTimeline(targets)
    expect(tl.onsets).toEqual([0, 0.25, 0.5])
    expect(tl.totalBeats).toBeCloseTo(1)
  })
})
