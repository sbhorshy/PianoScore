// ── Hand ────────────────────────────────────────────────────────────────
export type Hand = 'left' | 'right'

// ── Practice Mode ───────────────────────────────────────────────────────
export type PracticeMode = 'right' | 'left' | 'both'

// ── Practice Style ─────────────────────────────────────────────────────
/** How the practice session is driven. */
export type PracticeStyle = 'free' | 'listen' | 'follow'

// ── MIDI event from the keyboard ────────────────────────────────────────
export interface NoteEvent {
  id: string
  pitch: number
  velocity: number
  timestamp: number
  type: 'noteOn' | 'noteOff'
}

// ── Scoring target (OSMD-derived, pitch-only for MVP) ───────────────────
// One practice target = a set of pitches that must be played simultaneously
// (single note = array of length 1).
export interface ScoringTarget {
  index: number
  midiNotes: number[]
  hands: Hand[]
  durationBeats: number
  measureNumber?: number // 1-based measure this target belongs to
  onsetBeat?: number // real musical onset in quarter-note beats (OSMD enrolled
  // timestamp). When present, the playback timeline uses this instead of
  // accumulating durationBeats — correct for overlapping/polyphonic voices.
  noteDurations?: number[] // per-note length in beats, aligned 1:1 with
  // midiNotes. durationBeats is their max (one stepping value for the cursor);
  // noteDurations lets audio sustain each voice independently (a melody whole
  // note rings full-length while a bass quarter sharing its onset does not).
}
