import { useMemo, useCallback } from 'react'
import type { Hand, PracticeMode } from '@/types/music'

// Screen piano: visual keyboard with 6 key states for practice feedback.

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function isWhite(midi: number): boolean {
  return WHITE_PCS.includes(((midi % 12) + 12) % 12)
}

function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

// ── Visual states ────────────────────────────────────────────────────────
// 1. default         — normal key
// 2. required        — current target's notes (should press next)
// 3. pressed         — actively held, matches current target
// 4. holdingPrevious — held from a previous target
// 5. wrong           — held note that doesn't belong to any target
// 6. otherHand       — inactive hand's notes in single-hand mode (faint)

type KeyVisualState = 'default' | 'required' | 'pressed' | 'holdingPrevious' | 'wrong' | 'otherHand'

function getKeyVisualState(
  midi: number,
  requiredNotes: Set<number>,
  heldNotes: Map<number, Hand | null>,
  targetMidiSet: Set<number>,
  activeHand: PracticeMode,
): KeyVisualState {
  const held = heldNotes.get(midi)

  // If the key is currently held down
  if (held !== undefined) {
    // Is it a wrong note? (not in any target set)
    if (!targetMidiSet.has(midi)) {
      return 'wrong'
    }
    // Is it required for the current target?
    if (requiredNotes.has(midi)) {
      return 'pressed'
    }
    // It's a held note from a previous target
    return 'holdingPrevious'
  }

  // Not held — check if it's a required note to press
  if (requiredNotes.has(midi)) {
    return 'required'
  }

  // In single-hand mode, check if this note belongs to the other hand
  if (activeHand !== 'both' && targetMidiSet.has(midi)) {
    // It's a target note but not required for the current active hand.
    // We show it faintly. But we need to know if it belongs to the other hand.
    // Since we don't have per-note hand info here, we show all non-active
    // target notes faintly. The caller passes targetMidiSet which should
    // include all notes (both hands), and requiredNotes is only the current target.
    // So notes in targetMidiSet but not in requiredNotes are "other hand reference"
    // only in single-hand mode.
    return 'otherHand'
  }

  return 'default'
}

// ── Colors ───────────────────────────────────────────────────────────────

const COLORS = {
  // White keys
  whiteDefault: '#fff',
  whiteRequired: '#bfdbfe',      // light blue tint
  whitePressed: '#3b82f6',       // blue (right hand)
  whitePressedLeft: '#22c55e',   // green (left hand)
  whiteHoldingPrevious: '#dbeafe', // faint blue
  whiteHoldingPreviousLeft: '#dcfce7', // faint green
  whiteWrong: '#fca5a5',         // light red
  whiteOtherHand: '#f1f5f9',     // very faint gray

  // Black keys
  blackDefault: '#1a1a1a',
  blackRequired: '#2b6cb0',
  blackPressed: '#3b82f6',
  blackPressedLeft: '#22c55e',
  blackHoldingPrevious: '#374151',
  blackHoldingPreviousLeft: '#374151',
  blackWrong: '#ef4444',
  blackOtherHand: '#334155',

  // Active press flash (on-screen keyboard click feedback)
  activeWhite: '#007ACC',
  activeBlack: '#007ACC',
} as const

interface VirtualKeyboardProps {
  lowMidi: number
  highMidi: number
  onNoteOn: (midi: number) => void
  /** Notes the user should press next (current target) */
  highlight?: number[]
  /** Currently held-down MIDI notes and which hand they belong to */
  heldNotes?: Map<number, Hand | null>
  /** All target MIDI notes across the entire score (for wrong-note detection) */
  targetMidiSet?: Set<number>
  /** Which hand is active (for color tinting) */
  activeHand?: PracticeMode
}

const WHITE_W = 34
const WHITE_H = 150
const BLACK_W = 20
const BLACK_H = 94

export function VirtualKeyboard({
  lowMidi,
  highMidi,
  onNoteOn,
  highlight = [],
  heldNotes = new Map(),
  targetMidiSet = new Set(),
  activeHand = 'both',
}: VirtualKeyboardProps) {
  const requiredSet = useMemo(() => new Set(highlight), [highlight])

  const { whites, blacks, width } = useMemo(() => {
    const whites: { midi: number; index: number }[] = []
    const blacks: { midi: number; left: number }[] = []
    const whiteIndexByMidi = new Map<number, number>()
    let wi = 0
    for (let m = lowMidi; m <= highMidi; m++) {
      if (isWhite(m)) {
        whiteIndexByMidi.set(m, wi)
        whites.push({ midi: m, index: wi })
        wi++
      }
    }
    for (let m = lowMidi; m <= highMidi; m++) {
      if (isWhite(m)) continue
      const below = whiteIndexByMidi.get(m - 1)
      if (below === undefined) continue
      blacks.push({ midi: m, left: (below + 1) * WHITE_W - BLACK_W / 2 })
    }
    return { whites, blacks, width: wi * WHITE_W }
  }, [lowMidi, highMidi])

  const press = useCallback(
    (midi: number) => {
      onNoteOn(midi)
    },
    [onNoteOn],
  )

  function whiteColor(midi: number): string {
    const state = getKeyVisualState(midi, requiredSet, heldNotes, targetMidiSet, activeHand)
    switch (state) {
      case 'required': return COLORS.whiteRequired
      case 'pressed': {
        const hand = heldNotes.get(midi)
        return hand === 'left' ? COLORS.whitePressedLeft : COLORS.whitePressed
      }
      case 'holdingPrevious': {
        const hand = heldNotes.get(midi)
        return hand === 'left' ? COLORS.whiteHoldingPreviousLeft : COLORS.whiteHoldingPrevious
      }
      case 'wrong': return COLORS.whiteWrong
      case 'otherHand': return COLORS.whiteOtherHand
      default: return COLORS.whiteDefault
    }
  }

  function blackColor(midi: number): string {
    const state = getKeyVisualState(midi, requiredSet, heldNotes, targetMidiSet, activeHand)
    switch (state) {
      case 'required': return COLORS.blackRequired
      case 'pressed': {
        const hand = heldNotes.get(midi)
        return hand === 'left' ? COLORS.blackPressedLeft : COLORS.blackPressed
      }
      case 'holdingPrevious': {
        const hand = heldNotes.get(midi)
        return hand === 'left' ? COLORS.blackHoldingPreviousLeft : COLORS.blackHoldingPrevious
      }
      case 'wrong': return COLORS.blackWrong
      case 'otherHand': return COLORS.blackOtherHand
      default: return COLORS.blackDefault
    }
  }

  return (
    <div className="overflow-x-auto py-2">
      <div className="relative mx-auto" style={{ width: width, height: WHITE_H }}>
        {whites.map(({ midi, index }) => (
          <button
            key={midi}
            type="button"
            aria-label={noteName(midi)}
            onPointerDown={() => press(midi)}
            className="absolute top-0 rounded-b-md border border-neutral-300 transition-colors"
            style={{
              left: index * WHITE_W,
              width: WHITE_W - 1,
              height: WHITE_H,
              background: whiteColor(midi),
            }}
          />
        ))}
        {blacks.map(({ midi, left }) => (
          <button
            key={midi}
            type="button"
            aria-label={noteName(midi)}
            onPointerDown={(e) => {
              e.stopPropagation()
              press(midi)
            }}
            className="absolute top-0 rounded-b-md border border-neutral-700"
            style={{
              left,
              width: BLACK_W,
              height: BLACK_H,
              background: blackColor(midi),
              zIndex: 2,
            }}
          />
        ))}
      </div>
    </div>
  )
}
