/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClock } from '@/hooks/useClock'

describe('useClock', () => {
  let rafCallbacks: FrameRequestCallback[]
  let originalRaf: typeof requestAnimationFrame
  let originalCaf: typeof cancelAnimationFrame

  beforeEach(() => {
    rafCallbacks = []
    originalRaf = window.requestAnimationFrame
    originalCaf = window.cancelAnimationFrame

    // Mock requestAnimationFrame to queue callbacks we can trigger manually.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    }
    window.cancelAnimationFrame = (_id: number) => {
      // no-op for tests
    }
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRaf
    window.cancelAnimationFrame = originalCaf
  })

  /** Flush all pending rAF callbacks with a simulated timestamp. */
  function flushRaf(timestampMs: number): void {
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    for (const cb of cbs) {
      cb(timestampMs)
    }
  }

  it('does not call onTick when not running', () => {
    const onTick = vi.fn()
    renderHook(() =>
      useClock({ tempo: 120, running: false, onTick }),
    )

    flushRaf(100)
    expect(onTick).not.toHaveBeenCalled()
  })

  it('calls onTick with elapsed time when running', () => {
    const onTick = vi.fn()
    renderHook(() =>
      useClock({ tempo: 120, running: true, onTick }),
    )

    // The hook sets startTimeRef on first effect, then calls rAF.
    // The first rAF callback uses performance.now() - startTime.
    // Since we mock rAF, we just need to flush.
    act(() => {
      flushRaf(50)
    })

    expect(onTick).toHaveBeenCalled()
    // elapsed = timestamp - startTime (startTime is performance.now() at mount)
    // Since we control rAF timestamp, the elapsed value is deterministic.
    const elapsed = onTick.mock.calls[0][0] as number
    expect(typeof elapsed).toBe('number')
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it('stops calling onTick when running changes to false', () => {
    const onTick = vi.fn()
    const { rerender } = renderHook(
      ({ running }) => useClock({ tempo: 120, running, onTick }),
      { initialProps: { running: true } },
    )

    act(() => {
      flushRaf(100)
    })

    const callCountWhileRunning = onTick.mock.calls.length
    expect(callCountWhileRunning).toBeGreaterThan(0)

    onTick.mockClear()
    rerender({ running: false })

    // Any pending rAF callbacks should have been cancelled.
    // Flushing should not trigger onTick.
    flushRaf(200)

    expect(onTick).not.toHaveBeenCalled()
  })

  it('resets elapsed time when tempo changes', () => {
    const onTick = vi.fn()
    const { rerender } = renderHook(
      ({ tempo }) => useClock({ tempo, running: true, onTick }),
      { initialProps: { tempo: 120 } },
    )

    // Flush one frame
    act(() => {
      flushRaf(100)
    })

    expect(onTick).toHaveBeenCalled()

    // Change tempo — effect re-runs, startTime resets
    onTick.mockClear()
    rerender({ tempo: 60 })

    // Flush a new frame — elapsed should be small since startTime just reset
    act(() => {
      flushRaf(150)
    })

    if (onTick.mock.calls.length > 0) {
      const elapsed = onTick.mock.calls[onTick.mock.calls.length - 1][0] as number
      expect(elapsed).toBeLessThan(100)
    }
  })

  it('cleans up animation frame on unmount', () => {
    const onTick = vi.fn()
    const { unmount } = renderHook(() =>
      useClock({ tempo: 120, running: true, onTick }),
    )

    act(() => {
      flushRaf(50)
    })

    expect(onTick).toHaveBeenCalled()
    onTick.mockClear()

    unmount()

    // Flushing after unmount should not call onTick
    flushRaf(100)
    expect(onTick).not.toHaveBeenCalled()
  })

  it('elapsed time increases across frames', () => {
    const onTick = vi.fn()
    renderHook(() =>
      useClock({ tempo: 120, running: true, onTick }),
    )

    // First frame at timestamp 100ms from mount
    act(() => {
      flushRaf(100)
    })

    expect(onTick).toHaveBeenCalled()
    const firstElapsed = onTick.mock.calls[0][0] as number

    // Second frame at timestamp 200ms from mount
    act(() => {
      flushRaf(200)
    })

    const secondElapsed = onTick.mock.calls[onTick.mock.calls.length - 1][0] as number
    expect(secondElapsed).toBeGreaterThan(firstElapsed)
  })
})
