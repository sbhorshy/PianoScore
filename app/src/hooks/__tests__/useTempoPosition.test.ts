// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
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

  it('fires each settle exactly once even under StrictMode (no double-accumulate)', () => {
    // settleTarget in the scoring engine accumulates missed/notesHit/
    // notesExpected additively. If the hook fired side effects inside the
    // setPosition updater, React's StrictMode double-invoke would double them.
    // Guard against regression: render under StrictMode, tick once, assert the
    // callback runs once per crossed target.
    const onSettleTarget = vi.fn()
    const { result } = renderHook(
      () =>
        useTempoPosition({
          targets,
          tempo: 120,
          running: true,
          onSettleTarget,
        }),
      { wrapper: StrictMode },
    )

    act(() => {
      result.current.tick(1100)
    })

    expect(result.current.position.targetIndex).toBe(2)
    // Exactly one call per crossed target (0 and 1) — NOT two each.
    expect(onSettleTarget).toHaveBeenCalledTimes(2)
    expect(onSettleTarget).toHaveBeenNthCalledWith(1, targets[0])
    expect(onSettleTarget).toHaveBeenNthCalledWith(2, targets[1])
  })

  it('fires onComplete exactly once when reaching the end', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(
      () =>
        useTempoPosition({
          targets,
          tempo: 120,
          running: true,
          onComplete,
        }),
      { wrapper: StrictMode },
    )

    act(() => {
      result.current.tick(2000)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('reset re-enables onComplete on the next run', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() =>
      useTempoPosition({ targets, tempo: 120, running: true, onComplete }),
    )

    act(() => {
      result.current.tick(2000)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.reset()
    })
    act(() => {
      result.current.tick(2000)
    })
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
})
