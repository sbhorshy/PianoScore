/**
 * Playback schedule — a flat, time-ordered list of note on/off events.
 *
 * Decouples audio scheduling from the visual cursor's `targetIndex`. The cursor
 * advances one target at a time, but audio must let overlapping voices sustain
 * independently: a melody whole note rings for its full length while quarter
 * notes move underneath it. A single "silence-all on index advance" model can't
 * express that — this event table can.
 *
 * Each note contributes a noteOn at its onset and a noteOff at
 * `onset + durationBeats` (its own length, not the gap to the next target).
 * Beats are normalized so the first event is at beat 0, matching the
 * normalization in buildTargetTimeline so cursor and audio share a clock.
 */

import type { ScoringTarget } from '@/types/music'

export type NoteEventType = 'on' | 'off'

export interface NoteEvent {
  beat: number
  type: NoteEventType
  midi: number
}

/**
 * Build a sorted NoteEvent[] from targets.
 *
 * Requires every target to carry `onsetBeat` (real musical onset). If any
 * target lacks it, returns an empty schedule — the caller falls back to the
 * legacy index-driven audio path, preserving behavior for inputs that predate
 * onset extraction.
 *
 * Ordering: by beat ascending, and at equal beats noteOff before noteOn so a
 * repeated pitch retriggers cleanly (release the old voice before the new one).
 */
export function buildNoteEvents(targets: ScoringTarget[]): NoteEvent[] {
  const hasRealOnsets =
    targets.length > 0 && targets.every((t) => typeof t.onsetBeat === 'number')
  if (!hasRealOnsets) return []

  const base = targets[0].onsetBeat as number
  const events: NoteEvent[] = []
  for (const t of targets) {
    if (t.midiNotes.length === 0) continue // rest — contributes a timeline gap only
    const onset = (t.onsetBeat as number) - base
    for (let i = 0; i < t.midiNotes.length; i++) {
      const midi = t.midiNotes[i]
      // Each note rings for its own length. noteDurations is aligned 1:1 with
      // midiNotes; fall back to the target's durationBeats (the max) when it's
      // absent — correct for true monophonic stops, conservative otherwise.
      const dur = t.noteDurations?.[i] ?? t.durationBeats
      events.push({ beat: onset, type: 'on', midi })
      events.push({ beat: onset + dur, type: 'off', midi })
    }
  }

  const typeRank = (e: NoteEvent) => (e.type === 'off' ? 0 : 1)
  events.sort((a, b) => a.beat - b.beat || typeRank(a) - typeRank(b))
  return events
}
