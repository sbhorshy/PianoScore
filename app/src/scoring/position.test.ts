import { describe, it, expect } from 'vitest'
import {
  initPositionState,
  advancePosition,
  handleJudgment,
  isPositionComplete,
  resetPosition,
  tempoTick,
  buildTargetTimeline,
  type TargetTimeline,
} from './position'
import type { Judgment } from './engine'

describe('PositionState', () => {
  it('starts at targetIndex 0', () => {
    const state = initPositionState()
    expect(state.targetIndex).toBe(0)
  })
})

describe('advancePosition', () => {
  it('increments targetIndex', () => {
    const state = initPositionState()
    const next = advancePosition(state)
    expect(next.targetIndex).toBe(1)
    // immutability: original unchanged
    expect(state.targetIndex).toBe(0)
  })

  it('chains multiple advances', () => {
    let state = initPositionState()
    state = advancePosition(state)
    state = advancePosition(state)
    state = advancePosition(state)
    expect(state.targetIndex).toBe(3)
  })
})

describe('handleJudgment', () => {
  it('advances on correct judgment', () => {
    const state = initPositionState()
    const next = handleJudgment(state, 'correct')
    expect(next.targetIndex).toBe(1)
  })

  it.each(['wrongPitch', 'partialChord', 'extra'] satisfies Judgment[])(
    'does NOT advance on %s judgment',
    (judgment) => {
      const state = initPositionState()
      const next = handleJudgment(state, judgment)
      expect(next.targetIndex).toBe(0)
    },
  )
})

describe('isPositionComplete', () => {
  it('returns false when targetIndex < targetCount', () => {
    expect(isPositionComplete({ targetIndex: 0 }, 5)).toBe(false)
  })

  it('returns true when targetIndex >= targetCount', () => {
    expect(isPositionComplete({ targetIndex: 5 }, 5)).toBe(true)
  })

  it('returns true when targetIndex > targetCount', () => {
    expect(isPositionComplete({ targetIndex: 10 }, 5)).toBe(true)
  })

  it('returns true for empty targets (0 count)', () => {
    expect(isPositionComplete({ targetIndex: 0 }, 0)).toBe(true)
  })
})

describe('resetPosition', () => {
  it('returns state with targetIndex 0', () => {
    const advanced = advancePosition(initPositionState())
    const reset = resetPosition()
    expect(reset.targetIndex).toBe(0)
    // original unchanged
    expect(advanced.targetIndex).toBe(1)
  })
})

// ── TempoDrivenPosition (tempoTick) ─────────────────────────────────────────

describe('buildTargetTimeline', () => {
  it('builds cumulative onset beats from ScoringTarget durations', () => {
    const targets = [
      { index: 0, midiNotes: [60], hands: ['right'] as ['right'], durationBeats: 1 },
      { index: 1, midiNotes: [64], hands: ['right'] as ['right'], durationBeats: 2 },
      { index: 2, midiNotes: [67], hands: ['right'] as ['right'], durationBeats: 0.5 },
    ]
    const timeline = buildTargetTimeline(targets)
    expect(timeline).toEqual([
      { onsetBeat: 0, durationBeats: 1 },
      { onsetBeat: 1, durationBeats: 2 },
      { onsetBeat: 3, durationBeats: 0.5 },
    ])
  })

  it('returns empty array for empty targets', () => {
    expect(buildTargetTimeline([])).toEqual([])
  })
})

describe('tempoTick', () => {
  // Helper: build a timeline from an array of durationBeats.
  function makeTimeline(durations: number[]): TargetTimeline {
    let cumulative = 0
    return durations.map((d) => {
      const entry = { onsetBeat: cumulative, durationBeats: d }
      cumulative += d
      return entry
    })
  }

  it('returns targetIndex 0 when elapsed is in first target range', () => {
    // 120 BPM -> 1 beat = 500ms. Target 0: beats [0, 1).
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 250)
    expect(result.targetIndex).toBe(0)
  })

  it('returns targetIndex 1 when elapsed is in second target range', () => {
    // 120 BPM -> 1 beat = 500ms. Target 1: beats [1, 2).
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 750)
    expect(result.targetIndex).toBe(1)
  })

  it('returns targetIndex 2 for third target', () => {
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 1250)
    expect(result.targetIndex).toBe(2)
  })

  it('clamps to timeline length when elapsed exceeds all targets', () => {
    const timeline = makeTimeline([1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 5000)
    expect(result.targetIndex).toBe(2) // one past last -> position complete
  })

  it('returns 0 when elapsed is 0', () => {
    const timeline = makeTimeline([1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 0)
    expect(result.targetIndex).toBe(0)
  })

  it('handles variable duration targets correctly', () => {
    // Target 0: 2 beats, Target 1: 1 beat, Target 2: 4 beats.
    // 60 BPM -> 1 beat = 1000ms.
    const timeline = makeTimeline([2, 1, 4])

    let result = tempoTick(initPositionState(), timeline, 60, 500)
    expect(result.targetIndex).toBe(0)

    result = tempoTick(initPositionState(), timeline, 60, 1500)
    expect(result.targetIndex).toBe(0) // still within 2-beat target

    result = tempoTick(initPositionState(), timeline, 60, 2100)
    expect(result.targetIndex).toBe(1)

    result = tempoTick(initPositionState(), timeline, 60, 3000)
    expect(result.targetIndex).toBe(2)

    result = tempoTick(initPositionState(), timeline, 60, 6000)
    expect(result.targetIndex).toBe(2)
  })

  it('handles faster tempo (240 BPM)', () => {
    // 240 BPM -> 1 beat = 250ms.
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 240, 375)
    expect(result.targetIndex).toBe(1)
  })

  it('handles slower tempo (60 BPM)', () => {
    // 60 BPM -> 1 beat = 1000ms.
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 60, 1500)
    expect(result.targetIndex).toBe(1)
  })

  it('at exact onset boundary falls into the next target', () => {
    // At beat 1.0 exactly -> target 1 (onset of target 1).
    const timeline = makeTimeline([1, 1, 1])
    const result = tempoTick(initPositionState(), timeline, 120, 500)
    expect(result.targetIndex).toBe(1)
  })

  it('handles empty timeline by returning initial state', () => {
    const timeline: TargetTimeline = []
    const result = tempoTick(initPositionState(), timeline, 120, 100)
    expect(result.targetIndex).toBe(0)
  })

  it('handles single-target timeline', () => {
    const timeline = makeTimeline([2])
    // 120 BPM -> 2 beats = 1000ms.

    let result = tempoTick(initPositionState(), timeline, 120, 100)
    expect(result.targetIndex).toBe(0)

    result = tempoTick(initPositionState(), timeline, 120, 900)
    expect(result.targetIndex).toBe(0)

    result = tempoTick(initPositionState(), timeline, 120, 1100)
    expect(result.targetIndex).toBe(1) // past the single target
  })

  it('never goes backwards from current state', () => {
    const timeline = makeTimeline([1, 1, 1])
    const state = { targetIndex: 2 }
    const result = tempoTick(state, timeline, 120, 100)
    expect(result.targetIndex).toBe(2)
  })

  it('preserves complete state when timeline maps to earlier', () => {
    const timeline = makeTimeline([1, 1, 1])
    const state = { targetIndex: 3 }
    const result = tempoTick(state, timeline, 120, 100)
    expect(result.targetIndex).toBe(3)
  })
})
