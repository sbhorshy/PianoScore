/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePractice } from '@/hooks/usePractice'
import type { ScoringTarget } from '@/types/music'

function single(index: number, midi: number): ScoringTarget {
  return { index, midiNotes: [midi], hands: ['right'], durationBeats: 1 }
}

describe('usePractice', () => {
  it('noteOn advances position and increments correct count', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.positionState.targetIndex).toBe(1)
    expect(result.current.scoringState.correct).toBe(1)
  })

  it('reset returns to initial state', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.positionState.targetIndex).toBe(1)

    act(() => {
      result.current.reset()
    })

    expect(result.current.positionState.targetIndex).toBe(0)
    expect(result.current.scoringState.correct).toBe(0)
    expect(result.current.scoringState.wrong).toBe(0)
  })

  it('ignores noteOn after completion', () => {
    const targets = [single(0, 60)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.positionState.targetIndex).toBe(1)
    expect(result.current.scoringState.correct).toBe(1)

    act(() => {
      result.current.handleNoteOn(62)
    })

    expect(result.current.positionState.targetIndex).toBe(1)
    expect(result.current.scoringState.correct).toBe(1)
  })

  it('noteOff removes note from heldNotes', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.scoringState.heldNotes.has(60)).toBe(true)

    act(() => {
      result.current.handleNoteOff(60)
    })

    expect(result.current.scoringState.heldNotes.has(60)).toBe(false)
  })

  it('noteOff clears pressedInWindow when chord note released', () => {
    const chord: ScoringTarget = { index: 0, midiNotes: [60, 64], hands: ['right', 'right'], durationBeats: 1 }
    const targets = [chord, single(1, 72)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    // Partial chord
    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.scoringState.pressedInWindow).toEqual([60])

    // Release the partial chord note
    act(() => {
      result.current.handleNoteOff(60)
    })

    expect(result.current.scoringState.pressedInWindow).toEqual([])
  })

  it('reset clears heldNotes', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.scoringState.heldNotes.size).toBe(1)

    act(() => {
      result.current.reset()
    })

    expect(result.current.scoringState.heldNotes.size).toBe(0)
  })
})

// ── Follow mode ────────────────────────────────────────────────────────────

describe('usePractice (follow mode)', () => {
  it('noteOn updates scoring but does NOT advance position', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    // Scoring should update
    expect(result.current.scoringState.correct).toBe(1)
    expect(result.current.scoringState.heldNotes.has(60)).toBe(true)
    // Position should NOT advance in follow mode
    expect(result.current.positionState.targetIndex).toBe(0)
  })

  it('settleTarget records settlement and updates scoring', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    // Play the note
    act(() => {
      result.current.handleNoteOn(60)
    })

    // Settle target 0
    act(() => {
      result.current.settleTarget(targets[0])
    })

    expect(result.current.settlements.get(0)).toBe('correct')
    expect(result.current.scoringState.notesHit).toBe(1)
    expect(result.current.scoringState.notesExpected).toBe(1)
    expect(result.current.scoringState.missed).toBe(0)
  })

  it('settleTarget records missed when no notes played', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    // Don't play anything — settle target 0
    act(() => {
      result.current.settleTarget(targets[0])
    })

    expect(result.current.settlements.get(0)).toBe('missed')
    expect(result.current.scoringState.missed).toBe(1)
    expect(result.current.scoringState.notesHit).toBe(0)
    expect(result.current.scoringState.notesExpected).toBe(1)
  })

  it('settleTarget records partial for incomplete chord', () => {
    const chord: ScoringTarget = {
      index: 0,
      midiNotes: [60, 64, 67],
      hands: ['right', 'right', 'right'],
      durationBeats: 1,
    }
    const targets = [chord, single(1, 72)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    // Play only 2 of 3 chord notes
    act(() => {
      result.current.handleNoteOn(60)
    })
    act(() => {
      result.current.handleNoteOn(64)
    })

    act(() => {
      result.current.settleTarget(targets[0])
    })

    expect(result.current.settlements.get(0)).toBe('partial')
    expect(result.current.scoringState.notesHit).toBe(2)
    expect(result.current.scoringState.notesExpected).toBe(3)
    expect(result.current.scoringState.missed).toBe(0)
  })

  it('reset clears settlements', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    act(() => {
      result.current.settleTarget(targets[0])
    })
    expect(result.current.settlements.size).toBe(1)

    act(() => {
      result.current.reset()
    })

    expect(result.current.settlements.size).toBe(0)
    expect(result.current.scoringState.missed).toBe(0)
    expect(result.current.scoringState.notesHit).toBe(0)
    expect(result.current.scoringState.notesExpected).toBe(0)
  })

  it('accumulates settlements across multiple targets', () => {
    const targets = [single(0, 60), single(1, 62), single(2, 64)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'follow'),
    )

    // t0: play 60 → correct
    act(() => { result.current.handleNoteOn(60) })
    act(() => { result.current.settleTarget(targets[0]) })

    // t1: don't play → missed
    act(() => { result.current.handleNoteOff(60) })
    act(() => { result.current.settleTarget(targets[1]) })

    // t2: play 64 → correct
    act(() => { result.current.handleNoteOn(64) })
    act(() => { result.current.settleTarget(targets[2]) })

    expect(result.current.settlements.get(0)).toBe('correct')
    expect(result.current.settlements.get(1)).toBe('missed')
    expect(result.current.settlements.get(2)).toBe('correct')
    expect(result.current.scoringState.missed).toBe(1)
    expect(result.current.scoringState.notesHit).toBe(2)
    expect(result.current.scoringState.notesExpected).toBe(3)
  })

  it('listen mode also does not advance position on noteOn', () => {
    const targets = [single(0, 60), single(1, 62)]

    const { result } = renderHook(() =>
      usePractice(targets, { chordWindowMs: 120 }, 'listen'),
    )

    act(() => {
      result.current.handleNoteOn(60)
    })

    expect(result.current.scoringState.correct).toBe(1)
    expect(result.current.positionState.targetIndex).toBe(0)
  })
})
