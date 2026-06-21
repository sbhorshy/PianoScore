/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayback } from '@/hooks/usePlayback'
import type { ScoringTarget } from '@/types/music'
import type { AudioOutput } from '@/services/audio'

// ── Test fixtures ────────────────────────────────────────────────────────

const note = (index: number, midi: number[], beats: number = 1): ScoringTarget => ({
  index,
  midiNotes: midi,
  hands: midi.length > 1 ? ['right', 'left'] : ['right'],
  durationBeats: beats,
})

const rest = (index: number, beats: number = 1): ScoringTarget => ({
  index,
  midiNotes: [],
  hands: [],
  durationBeats: beats,
})

// Quarter notes: C D E at 120 BPM (500ms/beat)
const quarterNotes: ScoringTarget[] = [
  note(0, [60], 1),
  note(1, [62], 1),
  note(2, [64], 1),
]

// Notes with a rest gap in the middle
const notesWithRest: ScoringTarget[] = [
  note(0, [60], 1),   // 0..1 beats
  rest(1, 1),          // 1..2 beats (rest)
  note(2, [62], 1),   // 2..3 beats
]

// Rest at the beginning
const restAtStart: ScoringTarget[] = [
  rest(0, 1),          // 0..1 beats (rest)
  note(1, [60], 1),   // 1..2 beats
  note(2, [62], 1),   // 2..3 beats
]

// Rest at the end
const restAtEnd: ScoringTarget[] = [
  note(0, [60], 1),
  note(1, [62], 1),
  rest(2, 1),
]

// Variable durations with rests
const mixedDurations: ScoringTarget[] = [
  note(0, [60], 2),   // half note: 0..2 beats
  rest(1, 1),          // rest:      2..3 beats
  note(2, [62], 0.5), // eighth:    3..3.5 beats
  note(3, [64], 0.5), // eighth:    3.5..4 beats
]

// ── Mock rAF ─────────────────────────────────────────────────────────────

let rafCallbacks: FrameRequestCallback[]
let originalRaf: typeof requestAnimationFrame
let originalCaf: typeof cancelAnimationFrame

beforeEach(() => {
  rafCallbacks = []
  originalRaf = window.requestAnimationFrame
  originalCaf = window.cancelAnimationFrame
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  }
  window.cancelAnimationFrame = (_id: number) => { /* no-op */ }
})

afterEach(() => {
  window.requestAnimationFrame = originalRaf
  window.cancelAnimationFrame = originalCaf
})

function flushRaf(timestampMs: number): void {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) cb(timestampMs)
}

function createMockAudioOutput(): AudioOutput {
  return {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    now: vi.fn(() => 0),
    dispose: vi.fn(),
  }
}

// ── Listen mode playback tests ────────────────────────────────────────────

describe('usePlayback — listen mode scenarios', () => {
  it('plays through 3 quarter notes at 120 BPM with correct timing', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: quarterNotes, tempo: 120, audioOutput: output }),
    )

    // Play — position set to BEFORE_START sentinel, no noteOn yet
    act(() => { result.current.play() })
    expect(output.noteOn).not.toHaveBeenCalled()

    // First tick (elapsed=0): advance from -1→0 triggers noteOn for target 0
    act(() => { flushRaf(0) })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 500ms (1 beat) — target 0 ends, advance to target 1
    act(() => { flushRaf(500) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(62)

    // At 1000ms (2 beats) — target 1 ends, advance to target 2
    act(() => { flushRaf(1000) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(output.noteOn).toHaveBeenCalledWith(64)

    // At 1500ms (3 beats) — target 2 ends, past all targets
    act(() => { flushRaf(1500) })
    expect(output.noteOff).toHaveBeenCalledWith(64)
    expect(result.current.currentPosition.targetIndex).toBe(3)
  })

  it('rest in the middle: note → rest → note preserves timing gap', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: notesWithRest, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 500ms (1 beat) — target 0 ends, advance to rest (target 1)
    act(() => { flushRaf(500) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    // Rest target: no noteOn sent
    expect(output.noteOn).not.toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(1)

    // At 1000ms (2 beats) — rest ends, advance to target 2
    act(() => { flushRaf(1000) })
    expect(output.noteOn).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(2)

    // At 1500ms (3 beats) — target 2 ends
    act(() => { flushRaf(1500) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(3)
  })

  it('rest at start: silent gap before first note', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: restAtStart, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })

    // First tick: advance to rest target (no noteOn)
    act(() => { flushRaf(0) })
    expect(output.noteOn).not.toHaveBeenCalled()

    // At 500ms (1 beat) — rest ends, advance to target 1 (C4)
    act(() => { flushRaf(500) })
    expect(output.noteOn).toHaveBeenCalledWith(60)
    expect(result.current.currentPosition.targetIndex).toBe(1)

    // At 1000ms (2 beats) — target 1 ends, advance to target 2
    act(() => { flushRaf(1000) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(62)
  })

  it('rest at end: final note ends, rest passes, completion', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: restAtEnd, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 500ms — target 0 → target 1
    act(() => { flushRaf(500) })
    expect(output.noteOn).toHaveBeenCalledWith(62)

    // At 1000ms — target 1 → rest (target 2)
    act(() => { flushRaf(1000) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(2)

    // At 1500ms — rest ends, past all targets
    act(() => { flushRaf(1500) })
    expect(result.current.currentPosition.targetIndex).toBe(3)
  })

  it('mixed durations: half note → rest → eighth notes', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: mixedDurations, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 900ms (1.8 beats) — still within half note (0..2 beats)
    act(() => { flushRaf(900) })
    expect(output.noteOff).not.toHaveBeenCalledWith(60)

    // At 1000ms (2 beats) — half note ends, advance to rest
    act(() => { flushRaf(1000) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(result.current.currentPosition.targetIndex).toBe(1)

    // At 1500ms (3 beats) — rest ends, advance to eighth note (target 2)
    act(() => { flushRaf(1500) })
    expect(output.noteOn).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(2)

    // At 1750ms (3.5 beats) — eighth note ends, advance to target 3
    act(() => { flushRaf(1750) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(output.noteOn).toHaveBeenCalledWith(64)
    expect(result.current.currentPosition.targetIndex).toBe(3)

    // At 2000ms (4 beats) — last eighth note ends
    act(() => { flushRaf(2000) })
    expect(output.noteOff).toHaveBeenCalledWith(64)
    expect(result.current.currentPosition.targetIndex).toBe(4)
  })

  it('stop during a rest silences nothing (no notes playing)', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: notesWithRest, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })

    // Advance to the rest
    act(() => { flushRaf(500) })
    expect(result.current.currentPosition.targetIndex).toBe(1)

    // Stop during rest
    act(() => { result.current.stop() })

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentPosition.targetIndex).toBe(0)
  })

  it('onComplete fires after last target passes', () => {
    const onComplete = vi.fn()
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: quarterNotes,
        tempo: 120,
        audioOutput: output,
        onComplete,
      }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })

    // Advance past all targets
    act(() => { flushRaf(2000) })

    expect(onComplete).toHaveBeenCalled()
  })

  it('60 BPM: quarter notes last 1000ms each', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets: [note(0, [60], 1), note(1, [62], 1)], tempo: 60, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 900ms (0.9 beats) — still on target 0
    act(() => { flushRaf(900) })
    expect(output.noteOff).not.toHaveBeenCalledWith(60)

    // At 1000ms (1 beat) — target 0 ends, advance to target 1
    act(() => { flushRaf(1000) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(62)

    // At 2000ms (2 beats) — target 1 ends
    act(() => { flushRaf(2000) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(2)
  })

  it('consecutive rests are traversed correctly', () => {
    const targets: ScoringTarget[] = [
      note(0, [60], 1),   // 0..1
      rest(1, 1),          // 1..2
      rest(2, 1),          // 2..3
      note(3, [62], 1),   // 3..4
    ]
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 120, audioOutput: output }),
    )

    act(() => { result.current.play() })
    act(() => { flushRaf(0) })

    // At 500ms — target 0 → rest 1
    act(() => { flushRaf(500) })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(result.current.currentPosition.targetIndex).toBe(1)

    // At 1000ms — rest 1 → rest 2
    act(() => { flushRaf(1000) })
    expect(result.current.currentPosition.targetIndex).toBe(2)

    // At 1500ms — rest 2 → target 3
    act(() => { flushRaf(1500) })
    expect(output.noteOn).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(3)

    // At 2000ms — target 3 ends
    act(() => { flushRaf(2000) })
    expect(output.noteOff).toHaveBeenCalledWith(62)
    expect(result.current.currentPosition.targetIndex).toBe(4)
  })
})
