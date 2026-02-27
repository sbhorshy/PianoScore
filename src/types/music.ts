export interface Pitch {
  midiNote: number
  octave: number
  step: number
}

export interface Note {
  id: string
  pitch: Pitch
  duration: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
  onset: number
  isRest: boolean
}

export interface Measure {
  number: number
  timeSignature: {
    numerator: number
    denominator: number
  }
  keySignature: {
    fifths: number
  }
  startTime: number
  notes: Note[]
}

export interface Score {
  id: string
  title: string
  composer?: string
  tempo: number
  measures: Measure[]
}

export interface NoteEvent {
  id: string
  pitch: Pitch
  velocity: number
  timestamp: number
  type: 'noteOn' | 'noteOff'
}

export type MatchResult = 'correct' | 'wrongPitch' | 'missed' | 'extra'

export interface PerformanceResult {
  totalNotes: number
  correctNotes: number
  wrongNotes: number
  missedNotes: number
  extraNotes: number
  accuracy: number
}
