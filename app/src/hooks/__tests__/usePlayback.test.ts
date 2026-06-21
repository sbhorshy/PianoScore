/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayback } from '@/hooks/usePlayback'
import type { ScoringTarget } from '@/types/music'

// ── Test fixtures ────────────────────────────────────────────────────────

const makeTarget = (
  index: number,
  midiNotes: number[],
  durationBeats: number = 1,
): ScoringTarget => ({
  index,
  midiNotes,
  hands: midiNotes.length > 1 ? ['right', 'left'] : ['right'],
  durationBeats,
})

const singleNoteTargets: ScoringTarget[] = [
  makeTarget(0, [60]),
  makeTarget(1, [62]),
  makeTarget(2, [64]),
]

const chordTargets: ScoringTarget[] = [
  makeTarget(0, [60, 64, 67]), // C major chord
  makeTarget(1, [62]),
  makeTarget(2, [65, 69]), // F major chord
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
  window.cancelAnimationFrame = (_id: number) => {
    // no-op
  }
})

afterEach(() => {
  window.requestAnimationFrame = originalRaf
  window.cancelAnimationFrame = originalCaf
})

function flushRaf(timestampMs: number): void {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) {
    cb(timestampMs)
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('usePlayback', () => {
  // Return type is inferred (not annotated as AudioOutput) so the vi.fn() mock
  // types are preserved — tests below read `.mock.calls`. The shape is still
  // structurally assignable to AudioOutput where passed to usePlayback.
  function createMockAudioOutput() {
    return {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      now: vi.fn(() => 0),
      dispose: vi.fn(),
    }
  }

  it('starts not playing with position at 0', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentPosition.targetIndex).toBe(0)
  })

  it('sets isPlaying to true on play()', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    expect(result.current.isPlaying).toBe(true)
  })

  it('sets isPlaying to false on stop()', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })
    expect(result.current.isPlaying).toBe(true)

    act(() => {
      result.current.stop()
    })
    expect(result.current.isPlaying).toBe(false)
  })

  it('resets position to 0 on stop()', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    // Flush some frames to advance position
    act(() => {
      flushRaf(0)
      flushRaf(2000) // ~2 seconds at 120 BPM = ~4 beats = past all targets
    })

    act(() => {
      result.current.stop()
    })

    expect(result.current.currentPosition.targetIndex).toBe(0)
  })

  it('sends noteOn for first target on first clock tick', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    // play() sets BEFORE_START sentinel, no noteOn yet
    act(() => {
      result.current.play()
    })
    expect(output.noteOn).not.toHaveBeenCalled()
    expect(result.current.isPlaying).toBe(true)

    // First tick at elapsed=0: advance from -1→0 triggers noteOn
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)
    expect(result.current.currentPosition.targetIndex).toBe(0)
  })

  it('advances position as time passes and sends noteOn/noteOff', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    // First tick triggers noteOn for target 0
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // At 120 BPM, 1 beat = 500ms
    // Target 0: onset 0, duration 1 beat → ends at beat 1 (500ms)
    // Target 1: onset 1, duration 1 beat → ends at beat 2 (1000ms)

    // Tick at t=600ms: past beat 1 → targetIndex becomes 1
    act(() => {
      flushRaf(600)
    })

    // noteOff for target 0 (MIDI 60), noteOn for target 1 (MIDI 62)
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(62)
  })

  it('sends noteOff for all playing notes on stop', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    // First tick triggers noteOn
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // Stop without advancing — should still noteOff the playing note
    act(() => {
      result.current.stop()
    })

    // Should have called noteOff for MIDI 60 during stop
    expect(output.noteOff).toHaveBeenCalledWith(60)
  })

  it('handles chords (multiple midiNotes per target)', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: chordTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    // First tick triggers noteOn for target 0 (chord: 60, 64, 67)
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(64)
    expect(output.noteOn).toHaveBeenCalledWith(67)

    // Second tick at t=600ms: past beat 1 → targetIndex advances to 1 (MIDI 62)
    act(() => {
      flushRaf(600)
    })

    // noteOff for target 0 (chord: 60, 64, 67)
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOff).toHaveBeenCalledWith(64)
    expect(output.noteOff).toHaveBeenCalledWith(67)

    // noteOn for target 1 (single note: 62)
    expect(output.noteOn).toHaveBeenCalledWith(62)
  })

  it('works when audioOutput is null (no audio)', () => {
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets,
        tempo: 120,
        audioOutput: null,
      }),
    )

    act(() => {
      result.current.play()
    })

    // Should not crash
    act(() => {
      flushRaf(0)
      flushRaf(600)
    })

    act(() => {
      result.current.stop()
    })

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentPosition.targetIndex).toBe(0)
  })

  it('works with empty targets array', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: [],
        tempo: 120,
        audioOutput: output,
      }),
    )

    act(() => {
      result.current.play()
    })

    act(() => {
      flushRaf(500)
    })

    expect(result.current.isPlaying).toBe(true)

    act(() => {
      result.current.stop()
    })

    expect(result.current.isPlaying).toBe(false)
  })

  it('stoppedRef prevents rAF tick from playing notes after stop()', () => {
    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: singleNoteTargets, // C4(60), D4(62), E4(64) all durationBeats=1
        tempo: 120,
        audioOutput: output,
      }),
    )

    // 1. Start playback
    act(() => {
      result.current.play()
    })

    // 2. First tick: noteOn(60) for target 0
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // 3. Advance past beat 1 (500ms) — position moves to target 1
    act(() => {
      flushRaf(600)
    })
    expect(output.noteOff).toHaveBeenCalledWith(60)
    expect(output.noteOn).toHaveBeenCalledWith(62)

    // 4. Stop playback — silenceAll fires noteOff for currently playing note
    act(() => {
      result.current.stop()
    })
    expect(result.current.isPlaying).toBe(false)

    // 5. Record call counts after stop (includes silenceAll noteOff)
    const noteOffCallsAfterStop = output.noteOff.mock.calls.length
    const noteOnCallsAfterStop = output.noteOn.mock.calls.length

    // 6. Simulate a late rAF tick (race condition!) — should be a no-op
    act(() => {
      flushRaf(1200)
    })

    // 7. No new noteOff calls after stop
    expect(output.noteOff.mock.calls.length).toBe(noteOffCallsAfterStop)
    // 8. No new noteOn calls after stop
    expect(output.noteOn.mock.calls.length).toBe(noteOnCallsAfterStop)
  })

  it('sends noteOff based on durationBeats before next target starts', () => {
    // Variable-duration targets: C4(60)=0.5 beats, D4(62)=1 beat, E4(64)=0.5 beats
    // Timeline at 120 BPM (500ms/beat):
    //   target0: [0, 0.5) beats = [0ms, 250ms)
    //   target1: [0.5, 1.5) beats = [250ms, 750ms)
    //   target2: [1.5, 2.0) beats = [750ms, 1000ms)
    const variableTargets: ScoringTarget[] = [
      makeTarget(0, [60], 0.5),
      makeTarget(1, [62], 1),
      makeTarget(2, [64], 0.5),
    ]

    const output = createMockAudioOutput()
    const { result } = renderHook(() =>
      usePlayback({
        targets: variableTargets,
        tempo: 120,
        audioOutput: output,
      }),
    )

    // 1. Start playback
    act(() => {
      result.current.play()
    })

    // 2. First tick triggers noteOn(60) for target 0
    act(() => {
      flushRaf(0)
    })
    expect(output.noteOn).toHaveBeenCalledWith(60)

    // 3. At 200ms elapsed = 0.4 beats, still within target 0's range (0.5 beats)
    act(() => {
      flushRaf(200)
    })

    // 4. noteOff should NOT have been called for 60 yet
    expect(output.noteOff).not.toHaveBeenCalledWith(60)

    // 5. At 300ms elapsed = 0.6 beats, past target 0's durationBeats (0.5)
    act(() => {
      flushRaf(300)
    })

    // 6. noteOff(60) should fire because the note's own duration has elapsed
    expect(output.noteOff).toHaveBeenCalledWith(60)

    // 7. At 800ms elapsed = 1.6 beats, past target 1 onset (0.5 beats)
    act(() => {
      flushRaf(800)
    })

    // 8. targetIndex should have advanced, noteOn(62) should fire
    expect(output.noteOn).toHaveBeenCalledWith(62)
  })
})
