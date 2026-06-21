import { useReducer, useCallback, useRef } from 'react'
import type { ScoringTarget, PracticeStyle } from '@/types/music'
import type { ScoringConfig, ScoringState } from '@/scoring/types'
import type { PositionState } from '@/scoring/position'
import {
  judgeNoteOn,
  judgeNoteOff,
  initScoringState,
  summarize,
  settleTarget,
  type TargetSettlement,
} from '@/scoring/engine'
import {
  initPositionState,
  handleJudgment,
  isPositionComplete,
} from '@/scoring/position'

// ── Rest target skipping (free practice) ────────────────────────────────────

/**
 * In free practice mode, rest targets (midiNotes=[]) require no user action.
 * Skip past consecutive rests so the player only sees actionable targets.
 */
function skipRestTargets(
  position: PositionState,
  targets: ScoringTarget[],
): PositionState {
  let idx = position.targetIndex
  while (idx < targets.length && targets[idx] && targets[idx].midiNotes.length === 0) {
    idx++
  }
  return { targetIndex: idx }
}

// ── Combined state (Position + Scoring, ADR 0002) ────────────────────────

interface PracticeState {
  position: PositionState
  scoring: ScoringState
  /** Settlement results per target index (follow mode). */
  settlements: Map<number, TargetSettlement>
}

function initPracticeState(): PracticeState {
  return {
    position: initPositionState(),
    scoring: initScoringState(),
    settlements: new Map(),
  }
}

// ── Reducer actions ────────────────────────────────────────────────────────

type Action =
  | { type: 'noteOn'; midiNote: number; targets: ScoringTarget[]; cfg: ScoringConfig; practiceStyle: PracticeStyle }
  | { type: 'noteOff'; midiNote: number }
  | { type: 'settleTarget'; target: ScoringTarget }
  | { type: 'reset' }

function reducer(state: PracticeState, action: Action): PracticeState {
  switch (action.type) {
    case 'reset':
      return initPracticeState()
    case 'noteOn': {
      if (isPositionComplete(state.position, action.targets.length)) return state

      // In free mode, auto-skip rest targets we're currently on
      let effectivePosition = state.position
      if (action.practiceStyle === 'free') {
        effectivePosition = skipRestTargets(state.position, action.targets)
        if (isPositionComplete(effectivePosition, action.targets.length)) {
          return { ...state, position: effectivePosition }
        }
      }

      const currentTarget = action.targets[effectivePosition.targetIndex]
      const { state: nextScoring, judgment } = judgeNoteOn(
        state.scoring,
        action.midiNote,
        currentTarget,
        action.cfg,
      )

      // In free mode, advance position via judgment and skip any trailing rests.
      // In follow/listen mode, scoring updates but position does NOT advance here.
      if (action.practiceStyle === 'free') {
        const nextPosition = handleJudgment(effectivePosition, judgment)
        const skippedPosition = skipRestTargets(nextPosition, action.targets)
        return { ...state, position: skippedPosition, scoring: nextScoring }
      }

      return { ...state, scoring: nextScoring }
    }
    case 'noteOff': {
      const nextScoring = judgeNoteOff(state.scoring, action.midiNote)
      return { ...state, scoring: nextScoring }
    }
    case 'settleTarget': {
      const { state: nextScoring, settlement } = settleTarget(
        state.scoring,
        action.target,
      )
      const nextSettlements = new Map(state.settlements)
      nextSettlements.set(action.target.index, settlement)
      return { ...state, scoring: nextScoring, settlements: nextSettlements }
    }
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface UsePracticeResult {
  /** Current scoring state (correct/wrong counts, chord window, heldNotes) */
  scoringState: ScoringState
  /** Current position state (targetIndex) */
  positionState: PositionState
  /** Process an incoming MIDI note-on event */
  handleNoteOn: (midiNote: number) => void
  /** Process an incoming MIDI note-off event */
  handleNoteOff: (midiNote: number) => void
  /** Reset scoring and position to initial state */
  reset: () => void
  /** Whether all targets have been played */
  isComplete: boolean
  /** Summary computed from current state and target count */
  summary: ReturnType<typeof summarize>
  /** Settle a target (follow mode) — called when tempo advances past a target */
  settleTarget: (target: ScoringTarget) => void
  /** Settlement results per target index (follow mode) */
  settlements: Map<number, TargetSettlement>
}

/**
 * Pure state-management hook for scoring + position tracking.
 *
 * Uses the separated Position Tracker (ADR 0002) and Scoring Engine.
 * Receives `targets` and `config`, uses `useReducer`. The hook does NOT
 * know about OSMD rendering — it only manages logical state.
 *
 * In free mode: position advances on correct judgment.
 * In follow/listen mode: position is driven externally (clock); noteOn
 * only updates scoring state without advancing position.
 */
export function usePractice(
  targets: ScoringTarget[],
  config: ScoringConfig,
  practiceStyle: PracticeStyle = 'free',
): UsePracticeResult {
  const [state, dispatch] = useReducer(reducer, undefined, initPracticeState)

  // Keep refs to latest values so the callbacks never go stale.
  const targetsRef = useRef(targets)
  const configRef = useRef(config)
  const practiceStyleRef = useRef(practiceStyle)
  targetsRef.current = targets
  configRef.current = config
  practiceStyleRef.current = practiceStyle

  const handleNoteOn = useCallback((midiNote: number) => {
    dispatch({
      type: 'noteOn',
      midiNote,
      targets: targetsRef.current,
      cfg: configRef.current,
      practiceStyle: practiceStyleRef.current,
    })
  }, [])

  const handleNoteOff = useCallback((midiNote: number) => {
    dispatch({ type: 'noteOff', midiNote })
  }, [])

  const resetCb = useCallback(() => {
    dispatch({ type: 'reset' })
  }, [])

  const settleTargetCb = useCallback((target: ScoringTarget) => {
    dispatch({ type: 'settleTarget', target })
  }, [])

  const complete = isPositionComplete(state.position, targets.length)

  return {
    scoringState: state.scoring,
    positionState: state.position,
    handleNoteOn,
    handleNoteOff,
    reset: resetCb,
    isComplete: complete,
    summary: summarize(
      targets.filter((t) => t.midiNotes.length > 0).length,
      state.scoring,
    ),
    settleTarget: settleTargetCb,
    settlements: state.settlements,
  }
}
