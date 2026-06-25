/**
 * Audio output abstraction for playback in listen/follow modes.
 *
 * Three implementations:
 *   - ToneJsOutput: sampled piano via @tonejs/piano (Salamander Grand Piano)
 *   - WebAudioSynth: browser-native synthesizer using Web Audio API oscillators
 *   - MidiOutput: sends MIDI messages to a hardware/software MIDI output device
 */

// ── Interface ──────────────────────────────────────────────────────────────

export interface AudioOutput {
  /**
   * Start playing a note.
   * @param midi      MIDI note number.
   * @param velocity  0..127 (default 100).
   * @param timeSec   Absolute time in the adapter's own seconds domain to
   *                  trigger at, for sample-accurate scheduling of dense/fast
   *                  passages. Callers MUST derive this from the same adapter's
   *                  now() — the domain differs per adapter (AudioContext time
   *                  for Tone/WebAudio, performance.now()/1000 for MIDI) and
   *                  mixing them desyncs scheduling. When omitted, the note
   *                  fires immediately. Out-of-date times (already in the past)
   *                  clamp to "now".
   */
  noteOn(midi: number, velocity?: number, timeSec?: number): void
  /**
   * Stop playing a note.
   * @param midi     MIDI note number.
   * @param timeSec  Absolute time in the adapter's own seconds domain to
   *                 release at; omit for immediate release. Must come from the
   *                 same adapter's now(), as in noteOn.
   */
  noteOff(midi: number, timeSec?: number): void
  /** The adapter's current time in its own seconds domain (for scheduling). */
  now(): number
  /** Release any held resources. */
  dispose(): void
}

// ── MIDI → note name conversion ────────────────────────────────────────────

/** Convert a MIDI note number to a note name string (e.g., 60 → 'C4', 61 → 'C#4'). */
export function midiToNoteName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const note = notes[midi % 12]
  return note + octave
}

// ── MIDI → frequency conversion ────────────────────────────────────────────

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ── ToneJsOutput ───────────────────────────────────────────────────────────

/**
 * Sampled piano output using @tonejs/piano (Salamander Grand Piano samples).
 *
 * The Piano instance is lazy-loaded via dynamic import to keep the initial
 * bundle small. Call `load()` before first use; `noteOn` / `noteOff` are
 * no-ops until the samples are ready.
 */
export class ToneJsOutput implements AudioOutput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private piano: any = null
  private loaded: boolean = false
  private loading: boolean = false
  private loadingPromise: Promise<void> | null = null
  private activeNotes: Set<number> = new Set()

  /** Lazy-load @tonejs/piano. Returns a promise that resolves when ready. */
  async load(onProgress?: (loaded: boolean) => void): Promise<void> {
    if (this.loaded) return
    if (this.loading && this.loadingPromise) return this.loadingPromise

    this.loading = true
    this.loadingPromise = (async () => {
      const { Piano } = await import('@tonejs/piano/build/piano/Piano')
      this.piano = new Piano({
        velocities: 5,
        maxPolyphony: 10,
      })
      await this.piano.load()
      this.piano.toDestination()
      this.loaded = true
      this.loading = false
      onProgress?.(true)
    })()

    return this.loadingPromise
  }

  get isLoaded(): boolean { return this.loaded }
  get isLoading(): boolean { return this.loading }

  now(): number {
    // @tonejs/piano builds on Tone, which shares the global AudioContext.
    // Use the piano's context if available, else fall back to 0 (immediate).
    const ctx = this.piano?.context
    return typeof ctx?.currentTime === 'number' ? ctx.currentTime : 0
  }

  noteOn(midi: number, velocity: number = 100, timeSec?: number): void {
    if (!this.piano || !this.loaded) return
    const noteName = midiToNoteName(midi)
    const vel = velocity / 127
    // Forward the scheduled time so dense passages keep their rhythm instead
    // of collapsing onto the rAF frame that dispatched them.
    const opts: { note: string; velocity: number; time?: number } = { note: noteName, velocity: vel }
    if (typeof timeSec === 'number') opts.time = Math.max(timeSec, this.now())
    this.piano.keyDown(opts)
    this.activeNotes.add(midi)
  }

  noteOff(midi: number, timeSec?: number): void {
    if (!this.piano) return
    const noteName = midiToNoteName(midi)
    const opts: { note: string; time?: number } = { note: noteName }
    if (typeof timeSec === 'number') opts.time = Math.max(timeSec, this.now())
    this.piano.keyUp(opts)
    this.activeNotes.delete(midi)
  }

  dispose(): void {
    for (const midi of this.activeNotes) {
      this.noteOff(midi)
    }
    this.activeNotes.clear()
    this.piano = null
    this.loaded = false
    this.loading = false
    this.loadingPromise = null
  }
}

// ── WebAudioSynth ──────────────────────────────────────────────────────────

interface ActiveNote {
  osc: OscillatorNode
  gain: GainNode
}

/**
 * Browser-native synthesizer using Web Audio API.
 *
 * Uses triangle-wave oscillators with a simple ADSR envelope for a
 * passable piano-like tone. Polyphonic — multiple notes can play at once.
 *
 * AudioContext is lazy-created on first noteOn to comply with browser
 * autoplay policies.
 */
export class WebAudioSynth implements AudioOutput {
  private ctx: AudioContext | null = null
  private active: Map<number, ActiveNote> = new Map()

  // ADSR envelope defaults (seconds / 0..1)
  private readonly attack = 0.01
  private readonly decay = 0.1
  private readonly sustain = 0.3
  private readonly release = 0.3

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    return this.ctx
  }

  now(): number {
    return this.ensureContext().currentTime
  }

  noteOn(midi: number, velocity: number = 100, timeSec?: number): void {
    const ctx = this.ensureContext()

    // Stop existing note on same pitch if still playing
    if (this.active.has(midi)) {
      this.noteOff(midi)
    }

    const freq = midiToFrequency(midi)
    const vel = velocity / 127

    // Master gain for velocity
    const masterGain = ctx.createGain()
    masterGain.gain.value = vel * 0.5
    masterGain.connect(ctx.destination)

    // Per-note envelope gain
    const envGain = ctx.createGain()
    envGain.connect(masterGain)

    // Oscillator with triangle wave for warmer tone
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq

    // Add a slight detune second oscillator for richness
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2
    osc2.detune.value = 5

    const osc2Gain = ctx.createGain()
    osc2Gain.gain.value = 0.15
    osc2.connect(osc2Gain)
    osc2Gain.connect(envGain)

    osc.connect(envGain)

    // Schedule at the requested time (clamped to "now" if in the past) so
    // densely-packed notes don't all land on the rAF frame that dispatched them.
    const start = typeof timeSec === 'number' ? Math.max(timeSec, ctx.currentTime) : ctx.currentTime
    envGain.gain.setValueAtTime(0, start)
    envGain.gain.linearRampToValueAtTime(1, start + this.attack)

    // Decay to sustain level
    envGain.gain.linearRampToValueAtTime(this.sustain, start + this.attack + this.decay)

    osc.start(start)
    osc2.start(start)

    this.active.set(midi, { osc, gain: envGain })

    // Also store references for cleanup
    const note = this.active.get(midi)!
    note._masterGain = masterGain
    note._osc2 = osc2
  }

  noteOff(midi: number, timeSec?: number): void {
    const note = this.active.get(midi)
    if (!note) return

    const ctx = this.ctx
    if (!ctx) return

    const releaseAt = typeof timeSec === 'number' ? Math.max(timeSec, ctx.currentTime) : ctx.currentTime
    note.gain.gain.cancelScheduledValues(releaseAt)
    note.gain.gain.setValueAtTime(note.gain.gain.value, releaseAt)
    note.gain.gain.linearRampToValueAtTime(0, releaseAt + this.release)

    // Stop oscillators after release
    note.osc.stop(releaseAt + this.release + 0.05)
    if (note._osc2) {
      note._osc2.stop(releaseAt + this.release + 0.05)
    }

    this.active.delete(midi)
  }

  dispose(): void {
    // Stop all active notes
    for (const midi of this.active.keys()) {
      this.noteOff(midi)
    }
    this.active.clear()

    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }

  /** Check if a note is currently playing. */
  isNoteActive(midi: number): boolean {
    return this.active.has(midi)
  }

  /** Get the number of currently active notes. */
  get activeNoteCount(): number {
    return this.active.size
  }
}

// Extend ActiveNote with optional extra refs (not exposed in interface)
interface ActiveNote {
  osc: OscillatorNode
  gain: GainNode
  _masterGain?: GainNode
  _osc2?: OscillatorNode
}

// ── MidiOutput ─────────────────────────────────────────────────────────────

/**
 * Sends MIDI noteOn/noteOff messages to a hardware or software MIDI output.
 */
export class MidiOutput implements AudioOutput {
  private output: MIDIOutput

  constructor(output: MIDIOutput) {
    this.output = output
  }

  noteOn(midi: number, velocity: number = 127, timeSec?: number): void {
    // MIDI noteOn: status byte 0x90 (channel 1), note, velocity.
    // MIDIOutput.send takes a DOMHighResTimeStamp (performance.now() base).
    this.output.send([0x90, midi & 0x7f, velocity & 0x7f], this.toTimestamp(timeSec))
  }

  noteOff(midi: number, timeSec?: number): void {
    // MIDI noteOff: status byte 0x80 (channel 1), note, velocity 0
    this.output.send([0x80, midi & 0x7f, 0x00], this.toTimestamp(timeSec))
  }

  /** MIDI scheduling uses performance.now() ms, not AudioContext seconds. */
  private toTimestamp(timeSec?: number): number | undefined {
    if (typeof timeSec !== 'number') return undefined
    // timeSec is in the same seconds domain as now() (performance.now()/1000),
    // so convert directly to ms — do NOT add performance.timeOrigin, which
    // would double-count it (send already expects a DOMHighResTimeStamp,
    // i.e. ms relative to timeOrigin, same base as performance.now()).
    return Math.max(timeSec * 1000, performance.now())
  }

  now(): number {
    return performance.now() / 1000
  }

  dispose(): void {
    // No-op: MIDIOutput connection is managed by the MIDI access object.
  }
}
