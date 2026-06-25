/**
 * OsmdService — wraps OpenSheetMusicDisplay for PianoScore.
 *
 * Responsibilities:
 *   1. Load MusicXML and render as SVG
 *   2. Walk the OSMD cursor to extract ScoringTarget[]
 *   3. Color individual note positions (current / past / reference)
 *   4. Handle click events on rendered SVG notes
 *
 * Design notes
 * ────────────
 * - Every public method is synchronous except `load()`.
 * - Coloring uses GraphicalNote.setColor() (no re-render) for speed.
 * - The OSMD cursor is only used during extraction; after that we
 *   address notes by target index through cached references.
 * - `halfTone` on OSMD Note is `NoteEnum + 12*octave` (C4 = 48), which is
 *   12 less than the standard MIDI number (C4 = 60). extractTargetFromCursor
 *   applies the +12 conversion, so ScoringTarget.midiNotes are true MIDI.
 */

import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { IOSMDOptions } from 'opensheetmusicdisplay'
import type { GraphicalNote } from 'opensheetmusicdisplay'

import type { ScoringTarget, PracticeMode } from '@/types/music'
import { extractTargetFromCursor } from './extractTargets'
import type { CursorNote, CursorGNote } from './extractTargets'

// ── Internal bookkeeping per target position ────────────────────────────
interface TargetEntry {
  target: ScoringTarget
  /** GraphicalNotes that belong to this target (for coloring). */
  gNotes: GraphicalNote[]
  /** 1-based measure number this target belongs to. */
  measureNumber: number
}

// ── Public API ──────────────────────────────────────────────────────────
export type NoteClickCallback = (index: number) => void

/** Result status for a completed target, mirrored from the component. */
export type TargetVisualResult = 'correct' | 'wrong' | 'missed'

/**
 * Snapshot of what the practice UI wants drawn on the score.
 * The service owns the color palette and the per-index policy; the React
 * layer just feeds it this state.
 */
export interface PracticeViewState {
  /** Currently-active target index (drawn in the "current" color). */
  currentTargetIndex: number
  /** Per-target completion result; only indices present here are drawn. */
  completedTargets: Map<number, TargetVisualResult>
  /** Active target indices in single-hand mode; the rest are grayed out. */
  filteredTargetIndices: Set<number>
}

export class OsmdService {
  // ── OSMD instance (created in load, nulled in destroy) ──────────────
  private osmd: OpenSheetMusicDisplay | null = null
  private container: HTMLElement | null = null
  private destroyed = false  // guard against async load after destroy

  // ── Extracted data ──────────────────────────────────────────────────
  private entries: TargetEntry[] = []
  private currentIndex = -1

  // ── Event handling ──────────────────────────────────────────────────
  private clickCallback: NoteClickCallback | null = null
  private clickHandler: ((e: MouseEvent) => void) | null = null

  // ── Default coloring options (notehead + stem) ──────────────────────
  private static readonly COLOR_OPTS = {
    applyToNoteheads: true,
    applyToStem: true,
  }

  // ──────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Create an OSMD instance, load the given MusicXML string, render it,
   * and extract all scoring targets from the cursor walk.
   */
  async load(container: HTMLElement, xml: string): Promise<void> {
    // Tear down any previous instance first.
    this.destroy()

    this.destroyed = false
    this.container = container

    const options: IOSMDOptions = {
      backend: 'svg',
      autoResize: true,
      drawCredits: false,
      drawTitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawLyrics: false,
      drawFingerings: false,
      drawMetronomeMarks: false,
      pageFormat: 'Endless',
    }

    const osmd = new OpenSheetMusicDisplay(container, options)
    this.osmd = osmd

    await osmd.load(xml)

    // Abort if destroyed during async load (React strict mode or unmount).
    if (this.destroyed) return

    osmd.render()

    // Enable the cursor so we can walk through every time-step.
    osmd.enableOrDisableCursors(true)
    osmd.cursor?.hide() // we only need data, not the visual cursor

    this.extractTargetsInternal()
    this.attachClickHandlers()
  }

  /**
   * Clean up: remove DOM content created by OSMD and release references.
   */
  destroy(): void {
    this.destroyed = true
    this.detachClickHandlers()

    if (this.osmd) {
      try {
        this.osmd.clear()
      } catch {
        // OSMD may throw if it was never fully loaded; ignore.
      }
      this.osmd = null
    }

    if (this.container) {
      this.container.innerHTML = ''
      this.container = null
    }

    this.entries = []
    this.currentIndex = -1
    this.clickCallback = null
  }

  // ──────────────────────────────────────────────────────────────────────
  // Data access
  // ──────────────────────────────────────────────────────────────────────

  /** Whether the service has completed loading and rendering. */
  isLoaded(): boolean {
    return this.entries.length > 0 || this.destroyed
  }

  getTargets(): ScoringTarget[] {
    return this.entries.map((e) => e.target)
  }

  getTotalTargets(): number {
    return this.entries.length
  }

  /** Get total number of measures in the score. */
  getMeasureCount(): number {
    if (this.entries.length === 0) return 0
    // measureNumber is 1-based, so the max value = total measures
    let max = 0
    for (const e of this.entries) {
      if (e.measureNumber > max) max = e.measureNumber
    }
    return max
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cursor / position
  // ──────────────────────────────────────────────────────────────────────

  getCurrentIndex(): number {
    return this.currentIndex
  }

  setCurrentIndex(index: number): void {
    if (index < -1 || index >= this.entries.length) {
      return
    }
    this.currentIndex = index
  }

  /**
   * Show the OSMD built-in cursor and apply PianoScore styling.
   *
   * The cursor is rendered as a semi-transparent blue band.
   */
  showCursor(): void {
    if (!this.osmd) return
    const cursor = this.osmd.cursor
    if (!cursor) return
    cursor.show()
    this.styleCursor()
  }

  /**
   * Hide the OSMD built-in cursor.
   */
  hideCursor(): void {
    if (!this.osmd) return
    const cursor = this.osmd.cursor
    if (!cursor) return
    cursor.hide()
  }

  /**
   * Move the OSMD cursor to the graphical position corresponding to
   * the given target index.
   *
   * This walks the OSMD cursor to the N-th position that produced a
   * ScoringTarget (skipping rests). Returns the cursor SVG element
   * for auto-scroll purposes, or null if unavailable.
   */
  setCursorPosition(targetIndex: number): SVGElement | null {
    if (!this.osmd || targetIndex < 0 || targetIndex >= this.entries.length) {
      return null
    }

    const cursor = this.osmd.cursor
    if (!cursor) return null
    cursor.reset()

    // Walk to the target position. Each OSMD cursor step may or may not
    // produce a ScoringTarget (rests are skipped), so we count actual
    // targets encountered.
    let targetsSeen = 0
    while (!cursor.iterator.EndReached) {
      // Check if this cursor position produced a target.
      const notesUnderCursor = cursor.NotesUnderCursor() as CursorNote[]
      const hasActiveNotes = notesUnderCursor.some((n) => !n.isRest())

      if (hasActiveNotes) {
        if (targetsSeen === targetIndex) {
          // We've arrived at the right position.
          this.styleCursor()
          return this.getCursorElement()
        }
        targetsSeen++
      }

      cursor.next()
    }

    return null
  }

  /**
   * Get the cursor's SVG element for auto-scroll purposes.
   */
  getCursorElement(): SVGElement | null {
    if (!this.container) return null
    // OSMD renders the cursor as an element with class 'cursor' inside the container.
    const cursorEl = this.container.querySelector('.cursor')
    return cursorEl as SVGElement | null
  }

  // ──────────────────────────────────────────────────────────────────────
  // Coloring
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Color all graphical notes that belong to the target at `index`.
   *
   * Uses GraphicalNote.setColor() so no re-render is needed.
   */
  colorPosition(index: number, color: string): void {
    if (index < 0 || index >= this.entries.length) return

    const entry = this.entries[index]
    if (!entry) return

    for (const gn of entry.gNotes) {
      try {
        gn.setColor(color, OsmdService.COLOR_OPTS)
      } catch {
        // Guard against notes that lost their SVG element (edge case
        // after resize or re-render).
      }
    }
  }

  /**
   * Reset every note back to the default black.
   */
  resetAllColors(): void {
    for (const entry of this.entries) {
      for (const gn of entry.gNotes) {
        try {
          gn.setColor('#000000', OsmdService.COLOR_OPTS)
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Gray out reference notes not in `filteredIndices` (used for
   * single-hand practice mode).
   */
  applyPracticeMode(
    _mode: PracticeMode,
    filteredIndices: Set<number>,
  ): void {
    for (let i = 0; i < this.entries.length; i++) {
      const color = filteredIndices.has(i) ? '#000000' : '#cccccc'
      const entry = this.entries[i]
      if (!entry) continue
      for (const gn of entry.gNotes) {
        try {
          gn.setColor(color, OsmdService.COLOR_OPTS)
        } catch {
          // ignore
        }
      }
    }
  }

  // ── Combined view state ────────────────────────────────────────────────

  /** Palette owned by the service, not the React layer. */
  private static readonly VIEW_COLORS = {
    future: '#000000',
    current: '#3b82f6',
    correct: '#22c55e',
    wrong: '#ef4444',
    missed: '#9ca3af',
    reference: '#d1d5db',
  } as const

  /**
   * Apply the full practice view in one pass: reset, then draw completed /
   * current coloring, then gray out non-active-hand reference notes.
   *
   * Replaces the two separate coloring effects the React wrapper used to
   * run (completed/current + filtered-reference). The palette and the
   * per-index policy live here so callers don't have to learn them.
   */
  applyPracticeViewState(state: PracticeViewState): void {
    const colors = OsmdService.VIEW_COLORS
    const { currentTargetIndex, completedTargets, filteredTargetIndices } = state

    this.resetAllColors()

    for (let i = 0; i < this.entries.length; i++) {
      const completed = completedTargets.get(i)
      if (completed === 'correct') {
        this.colorPosition(i, colors.correct)
      } else if (completed === 'wrong') {
        this.colorPosition(i, colors.wrong)
      } else if (completed === 'missed') {
        this.colorPosition(i, colors.missed)
      } else if (i === currentTargetIndex) {
        this.colorPosition(i, colors.current)
      }
    }

    if (filteredTargetIndices.size > 0) {
      for (let i = 0; i < this.entries.length; i++) {
        if (!filteredTargetIndices.has(i) && !completedTargets.has(i)) {
          this.colorPosition(i, colors.reference)
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Events
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Register a callback invoked when the user clicks a note in the SVG.
   *
   * The callback receives the target index (0-based) of the clicked note.
   */
  onNoteClick(callback: NoteClickCallback): void {
    this.clickCallback = callback
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private — target extraction
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Walk the OSMD cursor through every time-step and build the
   * `entries` array (TargetEntry[]).
   *
   * For each cursor position we collect:
   *   - midiNotes: note.halfTone (+12 → MIDI) for every non-rest note
   *   - hands: derived from the staff id (1 = right, 2 = left for piano)
   *   - durationBeats: the Fraction.RealValue of the longest note duration
   *   - gNotes: the GraphicalNote references (for fast coloring later)
   */
  private extractTargetsInternal(): void {
    if (!this.osmd) return

    const cursor = this.osmd.cursor
    cursor.reset()

    const entries: TargetEntry[] = []
    let targetIndex = 0

    while (!cursor.iterator.EndReached) {
      const notesUnderCursor = cursor.NotesUnderCursor() as CursorNote[]
      const gNotesUnderCursor =
        cursor.GNotesUnderCursor() as CursorGNote[]

      // Get 1-based measure number from OSMD iterator.
      // cursor.iterator.CurrentMeasure.MeasureNumber is 1-based.
      let measureNumber = 1
      // Real musical onset (quarter-note beats) from the iterator's enrolled
      // timestamp. OSMD Fraction.RealValue is in whole-note units, so ×4.
      // This is the true onset even for overlapping/polyphonic voices, unlike
      // accumulating note durations (which over-counts sustained notes).
      let onsetBeat: number | undefined
      try {
        const iter = cursor.iterator
        if (iter && iter.CurrentMeasure) {
          measureNumber = iter.CurrentMeasure.MeasureNumber || 1
        }
        const ts = iter?.CurrentEnrolledTimestamp
        if (ts && typeof ts.RealValue === 'number') {
          onsetBeat = ts.RealValue * 4
        }
      } catch {
        // Fall back to measure 1 / undefined onset if OSMD structure is unexpected
      }

      const extracted = extractTargetFromCursor(
        notesUnderCursor,
        gNotesUnderCursor,
        targetIndex,
        measureNumber,
        onsetBeat,
      )

      if (extracted) {
        // Cast gNotes back to GraphicalNote[] for SVG operations.
        const gNotesForTarget = extracted.gNotes as GraphicalNote[]

        // Store a data attribute on each SVG element so click
        // handling can map back to the target index.
        for (const gn of gNotesForTarget) {
          try {
            const svgEl = this.getGraphicalNoteSvg(gn)
            if (svgEl) {
              svgEl.dataset.pianoscoreTarget = String(targetIndex)
            }
          } catch {
            // SVG element may not be available for all notes
          }
        }

        entries.push({ target: extracted.target, gNotes: gNotesForTarget, measureNumber })
        targetIndex++
      }

      cursor.next()
    }

    cursor.reset()
    this.entries = entries
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private — SVG helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Apply PianoScore cursor styling: semi-transparent blue band.
   */
  private styleCursor(): void {
    if (!this.container) return
    const cursorEl = this.container.querySelector('.cursor')
    if (cursorEl instanceof SVGElement) {
      cursorEl.style.opacity = '0.2'
      cursorEl.style.fill = '#3b82f6'
      cursorEl.style.height = '8px'
    }
  }

  /**
   * Get the SVG group element for a GraphicalNote.
   *
   * VexFlowGraphicalNote exposes getSVGGElement(); for the base
   * GraphicalNote class we fall back to traversing the rendered DOM.
   */
  private getGraphicalNoteSvg(gn: GraphicalNote): SVGGElement | null {
    try {
      // VexFlowGraphicalNote has getSVGGElement
      if ('getSVGGElement' in gn) {
        return (gn as { getSVGGElement(): SVGGElement }).getSVGGElement()
      }
    } catch {
      // fall through
    }
    return null
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private — click handling
  // ──────────────────────────────────────────────────────────────────────

  private attachClickHandlers(): void {
    if (!this.container) return

    this.clickHandler = (e: MouseEvent) => {
      if (!this.clickCallback) return

      // Walk up from the click target to find an element with our
      // data attribute.
      let el: HTMLElement | null = e.target as HTMLElement
      while (el && el !== this.container) {
        const idx = el.dataset?.pianoscoreTarget
        if (idx !== undefined) {
          this.clickCallback(Number(idx))
          return
        }
        el = el.parentElement
      }
    }

    this.container.addEventListener('click', this.clickHandler)
  }

  private detachClickHandlers(): void {
    if (this.clickHandler && this.container) {
      this.container.removeEventListener('click', this.clickHandler)
    }
    this.clickHandler = null
  }
}
