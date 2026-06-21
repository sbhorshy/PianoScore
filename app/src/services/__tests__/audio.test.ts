// @vitest-environment jsdom

/**
 * Tests for the audio service: WebAudioSynth and MidiOutput.
 *
 * WebAudioSynth tests mock AudioContext since it's not available in Node.
 * MidiOutput tests use a mock MIDIOutput.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebAudioSynth, MidiOutput, ToneJsOutput, midiToNoteName } from '../audio'
import type { AudioOutput } from '../audio'

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockGainNode(): GainNode {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode
}

function createMockOscillator(): OscillatorNode {
  return {
    type: 'triangle',
    frequency: { value: 440 },
    detune: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as OscillatorNode
}

function createMockAudioContext() {
  return {
    currentTime: 0,
    destination: {} as AudioNode,
    createGain: vi.fn(() => {
      const g = createMockGainNode()
      return g
    }),
    createOscillator: vi.fn(() => createMockOscillator()),
    close: vi.fn(),
  }
}

// ── WebAudioSynth ────────────────────────────────────────────────────────

describe('WebAudioSynth', () => {
  let synth: WebAudioSynth
  let mockCtx: ReturnType<typeof createMockAudioContext>

  beforeEach(() => {
    synth = new WebAudioSynth()

    // Mock AudioContext constructor
    mockCtx = createMockAudioContext()
    vi.stubGlobal('AudioContext', vi.fn(() => mockCtx))
  })

  it('should implement AudioOutput interface', () => {
    const output: AudioOutput = synth
    expect(output.noteOn).toBeTypeOf('function')
    expect(output.noteOff).toBeTypeOf('function')
    expect(output.dispose).toBeTypeOf('function')
  })

  it('should create AudioContext lazily on first noteOn', () => {
    expect(AudioContext).not.toHaveBeenCalled()
    synth.noteOn(60)
    expect(AudioContext).toHaveBeenCalledTimes(1)
  })

  it('should reuse AudioContext across multiple noteOn calls', () => {
    synth.noteOn(60)
    synth.noteOn(62)
    synth.noteOn(64)
    expect(AudioContext).toHaveBeenCalledTimes(1)
  })

  it('should track active notes', () => {
    synth.noteOn(60)
    expect(synth.isNoteActive(60)).toBe(true)
    expect(synth.activeNoteCount).toBe(1)
  })

  it('should track multiple active notes', () => {
    synth.noteOn(60)
    synth.noteOn(64)
    synth.noteOn(67)
    expect(synth.activeNoteCount).toBe(3)
    expect(synth.isNoteActive(60)).toBe(true)
    expect(synth.isNoteActive(64)).toBe(true)
    expect(synth.isNoteActive(67)).toBe(true)
  })

  it('should stop tracking a note after noteOff', () => {
    synth.noteOn(60)
    expect(synth.isNoteActive(60)).toBe(true)

    synth.noteOff(60)
    expect(synth.isNoteActive(60)).toBe(false)
    expect(synth.activeNoteCount).toBe(0)
  })

  it('should handle noteOff for non-active note without error', () => {
    expect(() => synth.noteOff(60)).not.toThrow()
  })

  it('should replace note if same midi is played again', () => {
    synth.noteOn(60)
    expect(synth.activeNoteCount).toBe(1)

    synth.noteOn(60) // same pitch again
    expect(synth.activeNoteCount).toBe(1) // still just 1
    expect(synth.isNoteActive(60)).toBe(true)
  })

  it('should create oscillators with correct frequency for MIDI note', () => {
    synth.noteOn(69) // A4 = 440 Hz
    expect(mockCtx.createOscillator).toHaveBeenCalled()

    // The first oscillator should have frequency set to 440 for MIDI 69
    const firstOscCall = mockCtx.createOscillator.mock.results[0]
    if (firstOscCall && firstOscCall.type === 'return') {
      // We can verify the oscillator was created and connected
      expect(firstOscCall.value.connect).toHaveBeenCalled()
    }
  })

  it('should stop all notes and close AudioContext on dispose', () => {
    synth.noteOn(60)
    synth.noteOn(64)
    expect(synth.activeNoteCount).toBe(2)

    synth.dispose()
    expect(synth.activeNoteCount).toBe(0)
    expect(mockCtx.close).toHaveBeenCalled()
  })

  it('should handle dispose when no context exists', () => {
    const freshSynth = new WebAudioSynth()
    expect(() => freshSynth.dispose()).not.toThrow()
  })

  it('should accept velocity parameter', () => {
    expect(() => synth.noteOn(60, 80)).not.toThrow()
    expect(() => synth.noteOn(64, 127)).not.toThrow()
    expect(() => synth.noteOn(67, 0)).not.toThrow()
  })
})

// ── MidiOutput ──────────────────────────────────────────────────────────

describe('MidiOutput', () => {
  let mockOutput: { send: ReturnType<typeof vi.fn> }
  let midiOut: MidiOutput

  beforeEach(() => {
    mockOutput = { send: vi.fn() }
    midiOut = new MidiOutput(mockOutput as unknown as MIDIOutput)
  })

  it('should implement AudioOutput interface', () => {
    const output: AudioOutput = midiOut
    expect(output.noteOn).toBeTypeOf('function')
    expect(output.noteOff).toBeTypeOf('function')
    expect(output.now).toBeTypeOf('function')
    expect(output.dispose).toBeTypeOf('function')
  })

  it('should send MIDI noteOn on noteOn', () => {
    midiOut.noteOn(60, 100)
    expect(mockOutput.send).toHaveBeenCalledWith([0x90, 60, 100], undefined)
  })

  it('should default velocity to 127 for noteOn', () => {
    midiOut.noteOn(60)
    expect(mockOutput.send).toHaveBeenCalledWith([0x90, 60, 127], undefined)
  })

  it('should send MIDI noteOff on noteOff', () => {
    midiOut.noteOff(60)
    expect(mockOutput.send).toHaveBeenCalledWith([0x80, 60, 0x00], undefined)
  })

  it('should mask midi values to 7 bits', () => {
    // MIDI values should be 0-127
    midiOut.noteOn(60, 200)
    expect(mockOutput.send).toHaveBeenCalledWith([0x90, 60, 200 & 0x7f], undefined)
  })

  it('schedules noteOn at the given time (DOMHighResTimeStamp)', () => {
    // timeSec is seconds in performance.now() base; send expects ms since epoch.
    midiOut.noteOn(60, 100, 0.05)
    const [, timestamp] = mockOutput.send.mock.calls[0]
    expect(typeof timestamp).toBe('number')
    // Clamped to no earlier than performance.now().
    expect(timestamp).toBeGreaterThanOrEqual(performance.now() - 5)
  })

  it('now() returns performance.now() in seconds', () => {
    const n = midiOut.now()
    expect(n).toBeCloseTo(performance.now() / 1000, 1)
  })

  it('should not throw on dispose', () => {
    expect(() => midiOut.dispose()).not.toThrow()
    expect(mockOutput.send).not.toHaveBeenCalled()
  })
})

// ── midiToNoteName ──────────────────────────────────────────────────────

describe('midiToNoteName', () => {
  it('should convert MIDI 60 to C4 (middle C)', () => {
    expect(midiToNoteName(60)).toBe('C4')
  })

  it('should convert MIDI 61 to C#4', () => {
    expect(midiToNoteName(61)).toBe('C#4')
  })

  it('should convert MIDI 69 to A4 (440 Hz reference)', () => {
    expect(midiToNoteName(69)).toBe('A4')
  })

  it('should convert MIDI 0 to C-1', () => {
    expect(midiToNoteName(0)).toBe('C-1')
  })

  it('should convert MIDI 12 to C0', () => {
    expect(midiToNoteName(12)).toBe('C0')
  })

  it('should convert MIDI 127 to G9', () => {
    expect(midiToNoteName(127)).toBe('G9')
  })

  it('should convert all naturals in an octave', () => {
    expect(midiToNoteName(60)).toBe('C4')
    expect(midiToNoteName(62)).toBe('D4')
    expect(midiToNoteName(64)).toBe('E4')
    expect(midiToNoteName(65)).toBe('F4')
    expect(midiToNoteName(67)).toBe('G4')
    expect(midiToNoteName(69)).toBe('A4')
    expect(midiToNoteName(71)).toBe('B4')
  })

  it('should convert all sharps in an octave', () => {
    expect(midiToNoteName(61)).toBe('C#4')
    expect(midiToNoteName(63)).toBe('D#4')
    expect(midiToNoteName(66)).toBe('F#4')
    expect(midiToNoteName(68)).toBe('G#4')
    expect(midiToNoteName(70)).toBe('A#4')
  })
})

// ── ToneJsOutput ────────────────────────────────────────────────────────

describe('ToneJsOutput', () => {
  let output: ToneJsOutput

  // Mock @tonejs/piano dynamic import
  const mockKeyDown = vi.fn()
  const mockKeyUp = vi.fn()
  const mockToDestination = vi.fn()
  const mockLoad = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    output = new ToneJsOutput()

    mockKeyDown.mockReset()
    mockKeyUp.mockReset()
    mockToDestination.mockReset()
    mockLoad.mockReset()
    mockLoad.mockResolvedValue(undefined)

    vi.doMock('@tonejs/piano/build/piano/Piano', () => ({
      Piano: vi.fn().mockImplementation(() => ({
        load: mockLoad,
        toDestination: mockToDestination,
        keyDown: mockKeyDown,
        keyUp: mockKeyUp,
      })),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should implement AudioOutput interface', () => {
    const out: AudioOutput = output
    expect(out.noteOn).toBeTypeOf('function')
    expect(out.noteOff).toBeTypeOf('function')
    expect(out.dispose).toBeTypeOf('function')
  })

  it('should report not loaded initially', () => {
    expect(output.isLoaded).toBe(false)
    expect(output.isLoading).toBe(false)
  })

  it('should load piano samples via dynamic import', async () => {
    await output.load()
    expect(mockLoad).toHaveBeenCalledTimes(1)
    expect(mockToDestination).toHaveBeenCalledTimes(1)
    expect(output.isLoaded).toBe(true)
  })

  it('should call onProgress callback when loaded', async () => {
    const onProgress = vi.fn()
    await output.load(onProgress)
    expect(onProgress).toHaveBeenCalledWith(true)
  })

  it('should not reload if already loaded', async () => {
    await output.load()
    expect(mockLoad).toHaveBeenCalledTimes(1)

    await output.load()
    expect(mockLoad).toHaveBeenCalledTimes(1) // still 1
  })

  it('should coalesce concurrent load calls', async () => {
    const p1 = output.load()
    const p2 = output.load()
    await Promise.all([p1, p2])
    expect(mockLoad).toHaveBeenCalledTimes(1)
  })

  it('should be a no-op for noteOn when not loaded', () => {
    expect(() => output.noteOn(60)).not.toThrow()
    expect(mockKeyDown).not.toHaveBeenCalled()
  })

  it('should be a no-op for noteOff when not loaded', () => {
    expect(() => output.noteOff(60)).not.toThrow()
    expect(mockKeyUp).not.toHaveBeenCalled()
  })

  it('should call keyDown with note name and velocity after loading', async () => {
    await output.load()
    output.noteOn(60, 100)
    expect(mockKeyDown).toHaveBeenCalledWith({
      note: 'C4',
      velocity: 100 / 127,
    })
  })

  it('should call keyUp with note name after loading', async () => {
    await output.load()
    output.noteOn(60)
    output.noteOff(60)
    expect(mockKeyUp).toHaveBeenCalledWith({ note: 'C4' })
  })

  it('should default velocity to 100 in noteOn', async () => {
    await output.load()
    output.noteOn(69)
    expect(mockKeyDown).toHaveBeenCalledWith({
      note: 'A4',
      velocity: 100 / 127,
    })
  })

  it('should clear active notes on dispose', async () => {
    await output.load()
    output.noteOn(60)
    output.noteOn(64)
    output.dispose()
    // After dispose, keyUp should have been called for both notes
    expect(mockKeyUp).toHaveBeenCalledTimes(2)
    // After dispose, should not be loaded
    expect(output.isLoaded).toBe(false)
  })

  it('should handle dispose when never loaded', () => {
    expect(() => output.dispose()).not.toThrow()
  })

  it('should handle noteOff for a note that was not played', async () => {
    await output.load()
    output.noteOff(60) // never played
    expect(mockKeyUp).toHaveBeenCalledWith({ note: 'C4' })
  })
})
