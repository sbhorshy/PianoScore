import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScoringTarget } from '@/types/music'
import { buildTargetTimeline, initPositionState, tempoTick, type PositionState } from '@/scoring/position'
import { useClock } from './useClock'

interface UseTempoPositionOptions {
  targets: ScoringTarget[]
  tempo: number
  running: boolean
  onSettleTarget?: (target: ScoringTarget) => void
  onComplete?: () => void
}

interface UseTempoPositionResult {
  position: PositionState
  reset: () => void
  tick: (elapsedMs: number) => void
}

/**
 * Tempo-driven position driver for follow mode: owns a PositionState advanced
 * by a rAF clock via tempoTick, and fires settle-on-advance + complete callbacks
 * exactly once per crossed target.
 *
 * StrictMode-safe: side effects (callbacks) run in the `tick` event handler
 * using a positionRef snapshot — never inside the setPosition updater, which
 * React may invoke twice in dev StrictMode. refs are synced in effects, not
 * during render.
 */
export function useTempoPosition(options: UseTempoPositionOptions): UseTempoPositionResult {
  const { targets, tempo, running, onSettleTarget, onComplete } = options
  const [position, setPosition] = useState<PositionState>(initPositionState)
  const timeline = useMemo(() => buildTargetTimeline(targets), [targets])

  // Latest-value refs, synced in effects (never assigned during render).
  const targetsRef = useRef(targets)
  const onSettleTargetRef = useRef(onSettleTarget)
  const onCompleteRef = useRef(onComplete)
  const positionRef = useRef(position)
  const completedRef = useRef(false)

  useEffect(() => {
    targetsRef.current = targets
  }, [targets])
  useEffect(() => {
    onSettleTargetRef.current = onSettleTarget
  }, [onSettleTarget])
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])
  useEffect(() => {
    positionRef.current = position
  }, [position])

  const tick = useCallback(
    (elapsedMs: number) => {
      const prev = positionRef.current
      const next = tempoTick(prev, timeline, tempo, elapsedMs)

      // Side effects fire once here, in the event handler — NOT in the
      // setPosition updater (which React may double-invoke under StrictMode).
      if (next.targetIndex !== prev.targetIndex) {
        for (let i = prev.targetIndex; i < next.targetIndex; i++) {
          const target = targetsRef.current[i]
          if (target) onSettleTargetRef.current?.(target)
        }
      }
      if (next.targetIndex >= targetsRef.current.length && !completedRef.current) {
        completedRef.current = true
        onCompleteRef.current?.()
      }

      // The updater is now pure: it only returns the precomputed next state.
      positionRef.current = next
      setPosition(next)
    },
    [timeline, tempo],
  )

  useClock({ tempo, running, onTick: tick })

  const reset = useCallback(() => {
    completedRef.current = false
    positionRef.current = initPositionState()
    setPosition(initPositionState())
  }, [])

  return { position, reset, tick }
}
