import { useState, useEffect, useCallback } from 'react'
import { Score, Note, NoteEvent, MatchResult } from '../types/music'

interface UsePracticeResult {
  currentNoteIndex: number
  isPlaying: boolean
  currentTime: number
  lastResult: MatchResult | null
  correctCount: number
  wrongCount: number
  start: () => void
  stop: () => void
  reset: () => void
  checkNote: (event: NoteEvent) => MatchResult
}

export function usePractice(score: Score): UsePracticeResult {
  const [currentNoteIndex, setCurrentNoteIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [lastResult, setLastResult] = useState<MatchResult | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)

  const notes = score.measures.flatMap((m) => m.notes)

  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval(() => {
      if (startTime) {
        setCurrentTime((Date.now() - startTime) / 1000)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [isPlaying, startTime])

  const start = useCallback(() => {
    setIsPlaying(true)
    setStartTime(Date.now())
    setCurrentTime(0)
  }, [])

  const stop = useCallback(() => {
    setIsPlaying(false)
    setStartTime(null)
  }, [])

  const reset = useCallback(() => {
    setIsPlaying(false)
    setStartTime(null)
    setCurrentTime(0)
    setCurrentNoteIndex(0)
    setLastResult(null)
    setCorrectCount(0)
    setWrongCount(0)
  }, [])

  const checkNote = useCallback(
    (event: NoteEvent): MatchResult => {
      if (currentNoteIndex >= notes.length) {
        return 'extra'
      }

      const targetNote = notes[currentNoteIndex]
      
      if (event.pitch.midiNote === targetNote.pitch.midiNote) {
        setCorrectCount((c) => c + 1)
        setCurrentNoteIndex((i) => i + 1)
        setLastResult('correct')
        return 'correct'
      } else {
        setWrongCount((w) => w + 1)
        setLastResult('wrongPitch')
        return 'wrongPitch'
      }
    },
    [currentNoteIndex, notes]
  )

  return {
    currentNoteIndex,
    isPlaying,
    currentTime,
    lastResult,
    correctCount,
    wrongCount,
    start,
    stop,
    reset,
    checkNote,
  }
}
