import { useCallback, useMemo, useRef, useState } from 'react'
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

export function useTempoPosition(options: UseTempoPositionOptions): UseTempoPositionResult {
  const { targets, tempo, running, onSettleTarget, onComplete } = options
  const [position, setPosition] = useState<PositionState>(initPositionState)
  const timeline = useMemo(() => buildTargetTimeline(targets), [targets])
  const targetsRef = useRef(targets)
  const onSettleTargetRef = useRef(onSettleTarget)
  const onCompleteRef = useRef(onComplete)
  const completedRef = useRef(false)

  targetsRef.current = targets
  onSettleTargetRef.current = onSettleTarget
  onCompleteRef.current = onComplete

  const tick = useCallback((elapsedMs: number) => {
    setPosition((prev) => {
      const next = tempoTick(prev, timeline, tempo, elapsedMs)
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
      return next
    })
  }, [timeline, tempo])

  useClock({ tempo, running, onTick: tick })

  const reset = useCallback(() => {
    completedRef.current = false
    setPosition(initPositionState())
  }, [])

  return { position, reset, tick }
}
