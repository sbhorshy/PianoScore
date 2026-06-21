import { useEffect, useRef } from 'react'

export interface UseClockOptions {
  tempo: number
  running: boolean
  onTick: (elapsedMs: number) => void
}

/**
 * Clock hook using requestAnimationFrame for smooth timing.
 *
 * Tracks elapsed time since start, calls onTick on each animation frame
 * with the current elapsedMs. Resets when tempo changes.
 *
 * Uses the rAF timestamp parameter (DOMHighResTimeStamp) for accurate
 * frame-to-frame timing.
 */
export function useClock(options: UseClockOptions): void {
  const { tempo, running, onTick } = options

  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  useEffect(() => {
    if (!running) {
      // Stop the clock
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      startTimeRef.current = null
      return
    }

    // Will be set on the first tick callback from rAF timestamp.
    let started = false

    function tick(timestamp: number): void {
      if (!started) {
        startTimeRef.current = timestamp
        started = true
      }

      if (startTimeRef.current === null) return

      const elapsed = timestamp - startTimeRef.current
      onTickRef.current(elapsed)

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      startTimeRef.current = null
    }
  }, [tempo, running])
}
