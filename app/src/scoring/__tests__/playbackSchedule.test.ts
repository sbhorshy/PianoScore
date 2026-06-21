/**
 * Regression: polyphonic timing. The original bug accumulated durationBeats to
 * compute onsets, so a sustained note "ate" the timeline of the notes beneath
 * it. These tests lock the real-onset behavior (and the legacy fallback).
 *
 * Scenario throughout: a whole note (4 beats) over four quarter notes — the
 * classic overlap that monophonic mocks never exercised.
 *   target 0: onset 0, dur 4 (whole note, max with quarter) — voices [whole, q1]
 *   target 1: onset 1, dur 1 (q2)
 *   target 2: onset 2, dur 1 (q3)
 *   target 3: onset 3, dur 1 (q4)
 */
import { describe, it, expect } from 'vitest'
import { buildTargetTimeline } from '@/scoring/position'
import { buildNoteEvents } from '@/scoring/playbackSchedule'
import type { ScoringTarget } from '@/types/music'

const POLY: ScoringTarget[] = [
  { index: 0, midiNotes: [72, 60], hands: ['right', 'left'], durationBeats: 4, noteDurations: [4, 1], onsetBeat: 0 },
  { index: 1, midiNotes: [62], hands: ['left'], durationBeats: 1, noteDurations: [1], onsetBeat: 1 },
  { index: 2, midiNotes: [64], hands: ['left'], durationBeats: 1, noteDurations: [1], onsetBeat: 2 },
  { index: 3, midiNotes: [65], hands: ['left'], durationBeats: 1, noteDurations: [1], onsetBeat: 3 },
]

describe('buildTargetTimeline — real onsets (polyphonic)', () => {
  it('uses musical onsets, NOT accumulated durations', () => {
    const tl = buildTargetTimeline(POLY)
    expect(tl.map((e) => e.onsetBeat)).toEqual([0, 1, 2, 3])
    // The bug would have produced [0, 4, 5, 6] by accumulating maxDur=4 first.
    expect(tl.map((e) => e.onsetBeat)).not.toEqual([0, 4, 5, 6])
  })

  it('stepping duration is the gap to the next onset (last keeps its own)', () => {
    const tl = buildTargetTimeline(POLY)
    expect(tl.map((e) => e.durationBeats)).toEqual([1, 1, 1, 1])
  })

  it('normalizes so the first target starts at beat 0', () => {
    const shifted = POLY.map((t) => ({ ...t, onsetBeat: (t.onsetBeat ?? 0) + 8 }))
    const tl = buildTargetTimeline(shifted)
    expect(tl.map((e) => e.onsetBeat)).toEqual([0, 1, 2, 3])
  })

  it('falls back to accumulation when onsetBeat is absent', () => {
    const mono = POLY.map(({ onsetBeat: _omit, ...rest }) => rest)
    const tl = buildTargetTimeline(mono)
    // maxDur on target 0 is 4 → accumulation gives the (monophonic-only) layout.
    expect(tl.map((e) => e.onsetBeat)).toEqual([0, 4, 5, 6])
  })
})

describe('buildNoteEvents — true sustain (polyphonic)', () => {
  it('whole note rings 4 beats while quarters move underneath', () => {
    const ev = buildNoteEvents(POLY)
    // The sustained whole note (72) turns on at 0 and off at 4 — NOT cut off
    // when the cursor advances to the next quarter at beat 1.
    expect(ev).toContainEqual({ beat: 0, type: 'on', midi: 72 })
    expect(ev).toContainEqual({ beat: 4, type: 'off', midi: 72 })
    // Bass quarters each ring exactly one beat.
    expect(ev).toContainEqual({ beat: 0, type: 'on', midi: 60 })
    expect(ev).toContainEqual({ beat: 1, type: 'off', midi: 60 })
    expect(ev).toContainEqual({ beat: 1, type: 'on', midi: 62 })
    expect(ev).toContainEqual({ beat: 2, type: 'off', midi: 62 })
  })

  it('is sorted by beat, with noteOff before noteOn at equal beats', () => {
    const ev = buildNoteEvents(POLY)
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i].beat).toBeGreaterThanOrEqual(ev[i - 1].beat)
      if (ev[i].beat === ev[i - 1].beat) {
        const rank = (t: string) => (t === 'off' ? 0 : 1)
        expect(rank(ev[i].type)).toBeGreaterThanOrEqual(rank(ev[i - 1].type))
      }
    }
  })

  it('returns empty schedule when onsetBeat is absent (legacy fallback)', () => {
    const mono = POLY.map(({ onsetBeat: _omit, ...rest }) => rest)
    expect(buildNoteEvents(mono)).toEqual([])
  })

  it('skips rests (empty midiNotes) but they still shape the timeline', () => {
    const withRest: ScoringTarget[] = [
      { index: 0, midiNotes: [60], hands: ['left'], durationBeats: 1, onsetBeat: 0 },
      { index: 1, midiNotes: [], hands: [], durationBeats: 1, onsetBeat: 1 },
      { index: 2, midiNotes: [64], hands: ['left'], durationBeats: 1, onsetBeat: 2 },
    ]
    const ev = buildNoteEvents(withRest)
    expect(ev.every((e) => e.midi !== undefined)).toBe(true)
    expect(ev).toContainEqual({ beat: 2, type: 'on', midi: 64 })
    // No event sits in the rest's [1,2) gap as an onset.
    expect(ev.filter((e) => e.type === 'on' && e.beat === 1)).toEqual([])
  })
})

