// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTempoPosition } from '../useTempoPosition'
import type { ScoringTarget } from '@/types/music'

const targets: ScoringTarget[] = [
  { index: 0, midiNotes: [60], hands: ['right'], durationBeats: 1 },
  { index: 1, midiNotes: [62], hands: ['right'], durationBeats: 1 },
  { index: 2, midiNotes: [64], hands: ['right'], durationBeats: 1 },
]

describe('useTempoPosition', () => {
  it('settles every target crossed by a tempo tick', () => {
    const onSettleTarget = vi.fn()
    const { result } = renderHook(() =>
      useTempoPosition({
        targets,
        tempo: 120,
        running: true,
        onSettleTarget,
      }),
    )

    act(() => {
      result.current.tick(1100)
    })

    expect(result.current.position.targetIndex).toBe(2)
    expect(onSettleTarget).toHaveBeenCalledWith(targets[0])
    expect(onSettleTarget).toHaveBeenCalledWith(targets[1])
  })
})
