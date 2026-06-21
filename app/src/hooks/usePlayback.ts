import { useState, useCallback, useRef, useMemo } from 'react'
import type { ScoringTarget } from '@/types/music'
import type { PositionState, TargetTimeline } from '@/scoring/position'
import type { AudioOutput } from '@/services/audio'
import {
  buildTargetTimeline,
  tempoTick,
} from '@/scoring/position'
import { buildNoteEvents, type NoteEvent } from '@/scoring/playbackSchedule'
import { useClock } from '@/hooks/useClock'

// ── Options & Result ──────────────────────────────────────────────────────

export interface UsePlaybackOptions {
  targets: ScoringTarget[]
  tempo: number
  audioOutput: AudioOutput | null
  /** Called when playback reaches past the last target. */
  onComplete?: () => void
}

export interface UsePlaybackResult {
  play: () => void
  stop: () => void
  isPlaying: boolean
  currentPosition: PositionState
}

// ── Sentinel position ────────────────────────────────────────────────────

/** Position before playback starts — triggers noteOn on first clock tick. */
const BEFORE_START: PositionState = { targetIndex: -1 }

/** Position after playback stops or hasn't started. */
const RESET: PositionState = { targetIndex: 0 }

// ── Hook ──────────────────────────────────────────────────────────────────

/**
 * Drives automated playback of ScoringTargets at a given tempo.
 *
 * Uses `useClock` for timing and `tempoTick` for position advancement.
 * When position advances to a new target, sends noteOn for that target's
 * midiNotes to the audioOutput. Sends noteOff based on each note's
 * durationBeats, independent of when the next target starts.
 *
 * The hook does not manage AudioOutput lifecycle — the caller owns it.
 */
export function usePlayback(
  options: UsePlaybackOptions,
): UsePlaybackResult {
  const { targets, tempo, audioOutput, onComplete } = options

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentPosition, setCurrentPosition] = useState<PositionState>(RESET)

  // Build timeline from targets (memoized)
  const timeline: TargetTimeline = useMemo(
    () => buildTargetTimeline(targets),
    [targets],
  )

  // Note-event schedule for real-onset (polyphonic) playback. Empty when
  // targets lack onsetBeat → audio falls back to the index-driven path below.
  const noteEvents: NoteEvent[] = useMemo(
    () => buildNoteEvents(targets),
    [targets],
  )

  // Refs to track currently playing MIDI notes for noteOff on advance/stop
  const playingNotesRef = useRef<Set<number>>(new Set())
  const audioOutputRef = useRef(audioOutput)
  audioOutputRef.current = audioOutput
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  // Flag to prevent rAF ticks from playing notes after stop() is called.
  // Fixes race condition: stop() sets state async, but rAF may fire one more
  // tick before React cleanup runs, which would play new notes that never
  // get turned off.
  const stoppedRef = useRef(false)

  // Tracks the last targetIndex we actually sent audio for. Prevents
  // React StrictMode double-invoke of the state updater from causing
  // double noteOn/noteOff on each advance.
  const lastPlayedIndexRef = useRef(-2)

  // Pointer into noteEvents: index of the next event not yet fired. Reset on
  // each play(). Drives the real-onset (polyphonic) audio path.
  const nextEventIndexRef = useRef(0)

  // Fires onComplete exactly once per playback session when position passes
  // the end (used by the schedule-driven path; the legacy path self-guards).
  const completedRef = useRef(false)

  // Send noteOff for all currently playing notes
  const silenceAll = useCallback(() => {
    const out = audioOutputRef.current
    if (!out) return
    for (const midi of playingNotesRef.current) {
      out.noteOff(midi)
    }
    playingNotesRef.current.clear()
  }, [])

  // Clock tick handler: advance position and trigger noteOn/noteOff
  const onTick = useCallback(
    (elapsedMs: number) => {
      // Guard: don't play new notes after stop() was called
      if (stoppedRef.current) return

      setCurrentPosition((prev) => {
        const next = tempoTick(prev, timeline, tempo, elapsedMs)
        const out = audioOutputRef.current

        // ── Schedule-driven audio path (real onsets, true polyphony) ──
        // When a note-event schedule exists (targets carry onsetBeat), fire
        // every event whose beat has arrived. noteOn/noteOff are independent,
        // so overlapping voices sustain for their own durations instead of
        // being cut off when the cursor advances. Naturally idempotent under
        // React StrictMode: the pointer is monotonic and gated by currentBeat,
        // so a re-invoked updater with the same elapsedMs fires nothing new.
        if (noteEvents.length > 0) {
          if (out) {
            const msPerBeat = 60000 / tempo
            const currentBeat = elapsedMs / msPerBeat
            const secPerBeat = 60 / tempo
            // Audio clock basis. Each event fires at the AudioContext time
            // corresponding to its own beat — so a frame that catches up
            // several dense events still schedules them at distinct moments
            // instead of collapsing them onto "now". Events already in the
            // past (currentBeat overshot them) clamp to "now" via the output.
            const audioNow = out.now()
            while (
              nextEventIndexRef.current < noteEvents.length &&
              noteEvents[nextEventIndexRef.current].beat <= currentBeat
            ) {
              const ev = noteEvents[nextEventIndexRef.current]
              const timeSec = audioNow + (ev.beat - currentBeat) * secPerBeat
              if (ev.type === 'on') {
                out.noteOn(ev.midi, undefined, timeSec)
                playingNotesRef.current.add(ev.midi)
              } else {
                out.noteOff(ev.midi, timeSec)
                playingNotesRef.current.delete(ev.midi)
              }
              nextEventIndexRef.current++
            }
          }
          // Notify once when the cursor passes the final target.
          if (next.targetIndex >= targets.length && !completedRef.current) {
            completedRef.current = true
            onCompleteRef.current?.()
          }
          return next
        }

        // ── NoteOff based on durationBeats ───────────────────────
        // Send noteOff when the current note's own duration has elapsed,
        // independent of when the next target starts. This correctly handles
        // rests and staccato notes.
        if (out && playingNotesRef.current.size > 0) {
          const msPerBeat = 60000 / tempo
          const currentBeat = elapsedMs / msPerBeat
          const currentEntry = timeline[prev.targetIndex]
          if (currentEntry) {
            const noteEndBeat = currentEntry.onsetBeat + currentEntry.durationBeats
            if (currentBeat >= noteEndBeat) {
              for (const midi of playingNotesRef.current) {
                out.noteOff(midi)
              }
              playingNotesRef.current.clear()
            }
          }
        }

        // ── NoteOn when position advances ────────────────────────
        if (next.targetIndex !== prev.targetIndex) {
          // Guard against React StrictMode double-invoke: only send audio
          // for each targetIndex once per playback session.
          if (next.targetIndex !== lastPlayedIndexRef.current) {
            lastPlayedIndexRef.current = next.targetIndex

            if (out) {
              // Ensure any remaining notes are silenced (safety net)
              for (const midi of playingNotesRef.current) {
                out.noteOff(midi)
              }
              playingNotesRef.current.clear()

              // Send noteOn for new target's notes (if not past the end)
              if (
                next.targetIndex < targets.length &&
                targets[next.targetIndex]
              ) {
                for (const midi of targets[next.targetIndex].midiNotes) {
                  out.noteOn(midi)
                  playingNotesRef.current.add(midi)
                }
              }
            }

            // Playback reached past the end — notify caller
            if (next.targetIndex >= targets.length) {
              onCompleteRef.current?.()
            }
          }
        }

        return next
      })
    },
    [timeline, tempo, targets, noteEvents],
  )

  // Clock hook
  useClock({ tempo, running: isPlaying, onTick })

  const play = useCallback(() => {
    stoppedRef.current = false
    lastPlayedIndexRef.current = -2
    nextEventIndexRef.current = 0
    completedRef.current = false

    // Set position to BEFORE_START sentinel so the first clock tick
    // triggers the -1→0 advance and sends noteOn for target 0.
    // This ensures noteOn and noteOff always go through the same
    // audioOutput (the one in audioOutputRef at tick time), avoiding
    // the race where play() used WebAudioSynth but onTick used
    // ToneJsOutput after Tone.js finished loading.
    setCurrentPosition(BEFORE_START)
    playingNotesRef.current.clear()

    setIsPlaying(true)
  }, [])

  const stop = useCallback(() => {
    // Set flag BEFORE state update to prevent rAF race condition
    stoppedRef.current = true
    setIsPlaying(false)
    silenceAll()
    setCurrentPosition(RESET)
  }, [silenceAll])

  return {
    play,
    stop,
    isPlaying,
    currentPosition,
  }
}
