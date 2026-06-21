/**
 * @vitest-environment jsdom
 *
 * Fast-tempo regression: dense note schedules (16th/32nd notes) must not lose
 * events. The schedule-driven path fires every event whose beat has arrived
 * within a rAF frame; even when many events fall inside one 16.7ms frame, each
 * must be dispatched exactly once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayback } from '@/hooks/usePlayback'
import type { ScoringTarget } from '@/types/music'
import type { AudioOutput } from '@/services/audio'

// ── rAF mock driven manually with realistic monotonic timestamps ───────────
let rafCallbacks: FrameRequestCallback[]
let origRaf: typeof requestAnimationFrame
let origCaf: typeof cancelAnimationFrame

beforeEach(() => {
  rafCallbacks = []
  origRaf = window.requestAnimationFrame
  origCaf = window.cancelAnimationFrame
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return rafCallbacks.length
  }) as typeof requestAnimationFrame
  window.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})
afterEach(() => {
  window.requestAnimationFrame = origRaf
  window.cancelAnimationFrame = origCaf
})

/** Fire frames at 60Hz cadence over [startMs, endMs]. */
function runFrames(startMs: number, endMs: number, frameMs = 16.67): void {
  for (let t = startMs; t <= endMs; t += frameMs) {
    const cbs = [...rafCallbacks]
    rafCallbacks = []
    for (const cb of cbs) cb(t)
  }
}

/** Fire a single frame at a precise timestamp (for catch-up tests). */
function fireAt(t: number): void {
  const cbs = [...rafCallbacks]
  rafCallbacks = []
  for (const cb of cbs) cb(t)
}

interface Recording extends AudioOutput {
  ons: { midi: number; time: number | undefined }[]
  offs: { midi: number; time: number | undefined }[]
}
function recordingOutput(): Recording {
  const ons: { midi: number; time: number | undefined }[] = []
  const offs: { midi: number; time: number | undefined }[] = []
  return {
    ons,
    offs,
    noteOn: (midi: number, _velocity?: number, time?: number) => ons.push({ midi, time }),
    noteOff: (midi: number, time?: number) => offs.push({ midi, time }),
    now: () => 0,
    dispose: () => {},
  }
}

function buildTargets(onsetBeats: number[], durBeats = 0.05): ScoringTarget[] {
  return onsetBeats.map((onset, i) => ({
    index: i,
    midiNotes: [60 + (i % 24)],
    hands: ['right'] as const,
    durationBeats: durBeats,
    noteDurations: [durBeats],
    onsetBeat: onset,
  }))
}

describe('usePlayback — dense / fast-tempo schedules', () => {
  it('does NOT lose events when several fall within one rAF frame (60Hz)', () => {
    // 120 BPM → 500ms/beat. Beats 0, 0.033, 0.067, 0.1 = onsets at 0/17/33/50ms.
    // The 0 & 0.033 events both fall inside the first 16.7ms frame.
    const out = recordingOutput()
    const onsets = [0, 0.033, 0.067, 0.1]
    const targets = buildTargets(onsets)
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 120, audioOutput: out }),
    )

    act(() => result.current.play())
    act(() => runFrames(0, 150))

    // Every onset dispatched exactly once, in beat order.
    expect(out.ons).toHaveLength(onsets.length)
    expect(out.ons.map((o) => o.midi)).toEqual([60, 61, 62, 63])
  })

  it('dispatches 0.033-beat-spaced (17ms) events as distinct noteOns', () => {
    const out = recordingOutput()
    const targets = buildTargets([0, 0.033, 0.066, 0.099, 0.132], 0.02)
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 120, audioOutput: out }),
    )

    act(() => result.current.play())
    act(() => runFrames(0, 200))

    expect(out.ons).toHaveLength(5)
    expect(out.ons.map((o) => o.midi)).toEqual([60, 61, 62, 63, 64])
  })

  it('passes a numeric scheduled time so dense events keep their rhythm', () => {
    // Regression for the "fast passages collapse" bug. Previously noteOn was
    // called with no time argument, so every event a frame caught up fired at
    // the same instant — dense passages collapsed into a chord. Now each event
    // carries timeSec = audioNow + (beat - currentBeat) * secPerBeat, a finite
    // number the audio engine schedules at the precise moment. The invariant
    // locked here: noteOn/noteOff receive a numeric time, and two events at
    // different beats receive different times (no collapse to a single instant).
    const out = recordingOutput()
    const onsets = [0, 0.25, 0.5, 0.75] // 125ms apart at 120bpm, one per frame
    const targets = buildTargets(onsets, 0.2)
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 120, audioOutput: out }),
    )

    act(() => result.current.play())
    act(() => runFrames(0, 500))

    expect(out.ons).toHaveLength(4)
    // Every noteOn received a finite numeric time (old code passed undefined).
    for (const o of out.ons) {
      expect(typeof o.time).toBe('number')
      expect(Number.isFinite(o.time)).toBe(true)
    }
    // Different beats ⇒ different scheduled times (not collapsed together).
    const times = out.ons.map((o) => o.time)
    expect(new Set(times).size).toBe(4)
  })

  it('catch-up burst after a long frame gap fires every skipped event', () => {
    // Simulate a backgrounded tab: frame at t=0, then a jump to t=500ms.
    const out = recordingOutput()
    const beats: number[] = []
    for (let b = 0; b < 1; b += 0.033) beats.push(Math.round(b * 1000) / 1000)
    const targets = buildTargets(beats, 0.02)
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 120, audioOutput: out }),
    )

    act(() => result.current.play())
    act(() => fireAt(0))
    act(() => fireAt(500))

    expect(out.ons).toHaveLength(beats.length)
  })

  it('a 200 BPM run of 16th notes (75ms apart) stays fully resolved', () => {
    // 200 BPM → 300ms/beat; 16th notes = 0.25 beat = 75ms apart. Well above
    // frame cadence, so each lands in its own frame. Sanity check no drops.
    const out = recordingOutput()
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.25)
    const targets = buildTargets(beats, 0.2)
    const { result } = renderHook(() =>
      usePlayback({ targets, tempo: 200, audioOutput: out }),
    )

    act(() => result.current.play())
    act(() => runFrames(0, 1500))

    expect(out.ons).toHaveLength(20)
  })
})
