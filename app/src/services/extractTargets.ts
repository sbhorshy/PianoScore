/**
 * Pure extraction logic for ScoringTargets from OSMD cursor data.
 *
 * This module defines minimal interfaces that mirror the OSMD types we need,
 * so the extraction logic is fully decoupled from the opensheetmusicdisplay
 * package and can be unit-tested without any DOM or OSMD imports.
 */

import type { ScoringTarget, Hand } from '@/types/music'

// ── Minimal interfaces (no OSMD import) ──────────────────────────────────

/** Mirrors the OSMD Note properties we read during extraction. */
export interface CursorNote {
  /**
   * OSMD's raw halfTone value: `NoteEnum + 12 * octave` (C4 → 48, C5 → 60).
   * This is **12 less than the standard MIDI note number** (where C4 = 60),
   * because MusicXML/OSMD count octave 0 as the lowest whereas MIDI anchors
   * C-1 = 0. `extractTargetFromCursor` converts it to MIDI on output.
   */
  halfTone: number
  isRest(): boolean
  ParentStaff: { Id: number }
  Length: { RealValue: number }
  /**
   * Tie this note participates in, or null/undefined if untied.
   * A Tie connects ≥2 same-pitch notes played as ONE sustained sound:
   *   - StartNote is the single struck note (Tie.Notes[0]).
   *   - Every note in the tie (start + continuations) points NoteTie at the
   *     same Tie object, so a continuation is `note !== note.NoteTie.StartNote`.
   *   - Duration.RealValue is the merged length of the whole tie chain
   *     (OSMD sums every Tie.Notes member), in whole-note units.
   * Slurs are NOT ties — OSMD models those separately as NoteSlurs and they
   * do not appear here, so slurred notes are never treated as continuations.
   */
  NoteTie?: { StartNote: CursorNote; Duration: { RealValue: number } } | null
}

/** Mirrors the OSMD GraphicalNote properties we read during extraction. */
export interface CursorGNote {
  sourceNote: CursorNote | null
}

/** Returned by extractTargetFromCursor when active notes are found. */
export interface ExtractedEntry {
  target: ScoringTarget
  gNotes: CursorGNote[]
}

// ── Pure function ────────────────────────────────────────────────────────

/**
 * Build one ScoringTarget (and its matching gNotes) from the notes under
 * a single cursor position.
 *
 * @param notes   All notes (including rests) under the cursor.
 * @param gNotes  All graphical notes under the cursor.
 * @param targetIndex  The sequential index to assign to the produced target.
 * @param measureNumber  Optional 1-based measure number this target belongs to.
 * @returns An ExtractedEntry. Rest-only positions return an entry with empty
 *          midiNotes/hands to preserve timeline gaps.
 */
export function extractTargetFromCursor(
  notes: CursorNote[],
  gNotes: CursorGNote[],
  targetIndex: number,
  measureNumber?: number,
  onsetBeat?: number,
): ExtractedEntry | null {
  if (notes.length === 0) {
    return null
  }

  // Filter out rests.
  const activeNotes = notes.filter((n) => !n.isRest())

  // All rests → generate a rest entry to preserve timeline gaps.
  // Duration is taken from rest notes (max of them).
  if (activeNotes.length === 0) {
    let maxDurationBeats = 0
    for (const note of notes) {
      const dur = note.Length.RealValue * 4
      if (dur > maxDurationBeats) maxDurationBeats = dur
    }

    const target: ScoringTarget = {
      index: targetIndex,
      midiNotes: [],
      hands: [],
      durationBeats: maxDurationBeats,
      ...(measureNumber !== undefined ? { measureNumber } : {}),
      ...(onsetBeat !== undefined ? { onsetBeat } : {}),
    }

    return { target, gNotes: [] }
  }

  const midiNotes: number[] = []
  const hands: Hand[] = []
  const noteDurations: number[] = []
  let maxDurationBeats = 0

  for (const note of activeNotes) {
    // Tie handling (符合乐理): a tie continuation note is NOT a fresh attack —
    // it's the same sustained sound carried over. It must not produce its own
    // midiNote (no re-strike, no extra scoring obligation, no second noteOn in
    // the audio schedule). Identify it by NoteTie identity, never by pitch:
    // a repeated note (same pitch, separately struck, no tie) must stay a target.
    const tie = note.NoteTie
    const isContinuation = !!tie && note !== tie.StartNote
    if (isContinuation) {
      continue
    }

    // OSMD halfTone (C4 = 48) → standard MIDI number (C4 = 60). See CursorNote.
    midiNotes.push(note.halfTone + 12)

    const staffId = note.ParentStaff.Id
    hands.push(staffId === 1 ? 'right' : 'left')

    // OSMD RealValue is in whole-note units (quarter = 0.25, half = 0.5).
    // Convert to quarter-note beats for consumption by tempoTick / timeline.
    // A tie START note carries the MERGED duration of the whole tie chain
    // (Tie.Duration sums every member), so it rings for the full tied length
    // in buildNoteEvents — which keys each note's noteOff off noteDurations[i],
    // not the gap to the next target. Without this the sound would cut off at
    // the first note's length and the tied tail would fall silent.
    const wholeNotes = tie ? tie.Duration.RealValue : note.Length.RealValue
    const dur = wholeNotes * 4
    noteDurations.push(dur)
    if (dur > maxDurationBeats) {
      maxDurationBeats = dur
    }
  }

  // A position whose only active notes were tie continuations now has no
  // midiNotes. Emit it as an empty (rest-like) placeholder target so the
  // timeline keeps its gap and free practice auto-skips it (skipRestTargets),
  // exactly as it already does for rests. gNotes are still collected below so
  // the sustained noteheads get colored when the start note is judged.
  if (midiNotes.length === 0) {
    const activeSet = new Set(activeNotes)
    const restGNotes: CursorGNote[] = []
    for (const gn of gNotes) {
      if (gn.sourceNote && activeSet.has(gn.sourceNote)) {
        restGNotes.push(gn)
      }
    }
    let maxRest = 0
    for (const note of activeNotes) {
      const dur = note.Length.RealValue * 4
      if (dur > maxRest) maxRest = dur
    }
    const target: ScoringTarget = {
      index: targetIndex,
      midiNotes: [],
      hands: [],
      durationBeats: maxRest,
      ...(measureNumber !== undefined ? { measureNumber } : {}),
      ...(onsetBeat !== undefined ? { onsetBeat } : {}),
    }
    return { target, gNotes: restGNotes }
  }

  // Deduplicate hands (a chord in one hand only counts once).
  const uniqueHands: Hand[] = [...new Set(hands)]

  // Collect the GraphicalNotes that correspond to active notes.
  const activeSet = new Set(activeNotes)
  const matchedGNotes: CursorGNote[] = []
  for (const gn of gNotes) {
    if (gn.sourceNote && activeSet.has(gn.sourceNote)) {
      matchedGNotes.push(gn)
    }
  }

  const target: ScoringTarget = {
    index: targetIndex,
    midiNotes,
    hands: uniqueHands,
    durationBeats: maxDurationBeats,
    noteDurations,
    ...(measureNumber !== undefined ? { measureNumber } : {}),
    ...(onsetBeat !== undefined ? { onsetBeat } : {}),
  }

  return { target, gNotes: matchedGNotes }
}
