import { useEffect, useRef, memo } from 'react'
import { OsmdService } from '@/services/osmd'

/** Result status for a completed target. */
export type TargetResult = 'correct' | 'wrong' | 'missed'

export interface OsmdScoreProps {
  xml: string
  currentTargetIndex: number
  filteredTargetIndices: Set<number>
  /** Which targets are completed and their result. */
  completedTargets: Map<number, TargetResult>
  /** Whether to show the OSMD cursor band. */
  showCursor?: boolean
  onReady?: (service: OsmdService) => void
  onNoteClick?: (targetIndex: number) => void
}

// ── Color palette ────────────────────────────────────────────────────────

const COLORS = {
  future: '#000000',
  current: '#3b82f6',
  correct: '#22c55e',
  wrong: '#ef4444',
  missed: '#9ca3af',
  reference: '#d1d5db',
} as const

/**
 * React wrapper around OsmdService.
 *
 * Renders the score via OSMD into a container div. Delegates all
 * coloring and practice-mode logic to the OsmdService instance,
 * which is created on mount and destroyed on unmount.
 *
 * Coloring states:
 *   - future (default): black
 *   - current target: blue (#3b82f6)
 *   - completed correct: green (#22c55e)
 *   - completed wrong: red (#ef4444)
 *   - missed (follow mode): gray (#9ca3af)
 *   - reference hand (inactive hand in single-hand mode): faint gray (#d1d5db)
 */
function OsmdScoreInner(props: OsmdScoreProps) {
  const {
    xml,
    currentTargetIndex,
    filteredTargetIndices,
    completedTargets,
    showCursor = false,
    onReady,
    onNoteClick,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const serviceRef = useRef<OsmdService | null>(null)
  // Track previous target index for auto-scroll
  const prevTargetIndexRef = useRef<number>(-1)

  // Create OsmdService, load XML, notify parent via onReady.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const svc = new OsmdService()
    serviceRef.current = svc

    svc.load(el, xml).then(() => {
      onReady?.(svc)
    })

    return () => {
      svc.destroy()
      serviceRef.current = null
    }
    // Only re-create the service when xml changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml])

  // Register note-click handler.
  useEffect(() => {
    const svc = serviceRef.current
    if (!svc || !onNoteClick) return

    svc.onNoteClick(onNoteClick)
  }, [onNoteClick])

  // Color targets based on their state (future / current / completed).
  useEffect(() => {
    const svc = serviceRef.current
    if (!svc || svc.getTotalTargets() === 0) return

    svc.resetAllColors()

    const total = svc.getTotalTargets()
    for (let i = 0; i < total; i++) {
      if (completedTargets.has(i)) {
        const result = completedTargets.get(i)
        if (result === 'correct') {
          svc.colorPosition(i, COLORS.correct)
        } else if (result === 'wrong') {
          svc.colorPosition(i, COLORS.wrong)
        } else if (result === 'missed') {
          svc.colorPosition(i, COLORS.missed)
        }
      } else if (i === currentTargetIndex) {
        svc.colorPosition(i, COLORS.current)
      }
    }
  }, [currentTargetIndex, completedTargets])

  // Apply practice-mode filtering (hand selection etc.).
  useEffect(() => {
    const svc = serviceRef.current
    if (!svc || svc.getTotalTargets() === 0) return

    if (filteredTargetIndices.size > 0) {
      // Single-hand mode: gray out the non-active hand's targets.
      const total = svc.getTotalTargets()
      for (let i = 0; i < total; i++) {
        if (!filteredTargetIndices.has(i)) {
          svc.colorPosition(i, COLORS.reference)
        }
      }
    }
  }, [filteredTargetIndices])

  // Cursor display and auto-scroll.
  useEffect(() => {
    const svc = serviceRef.current
    if (!svc || svc.getTotalTargets() === 0) return

    if (showCursor) {
      svc.showCursor()
    } else {
      svc.hideCursor()
    }
  }, [showCursor])

  // Auto-scroll when cursor position changes.
  useEffect(() => {
    const svc = serviceRef.current
    if (!svc || svc.getTotalTargets() === 0 || !showCursor) return

    if (currentTargetIndex !== prevTargetIndexRef.current && currentTargetIndex >= 0) {
      const cursorEl = svc.setCursorPosition(currentTargetIndex)
      if (cursorEl) {
        cursorEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      prevTargetIndexRef.current = currentTargetIndex
    }
  }, [currentTargetIndex, showCursor])

  return (
    <div
      ref={containerRef}
      style={{ overflowX: 'auto', width: '100%' }}
    />
  )
}

export const OsmdScore = memo(OsmdScoreInner)
