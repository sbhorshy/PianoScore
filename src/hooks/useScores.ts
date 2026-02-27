import { useState, useEffect } from 'react'
import { Score } from '../types/music'

// Sample score data
const sampleScore: Score = {
  id: '1',
  title: '小星星',
  composer: '传统',
  tempo: 120,
  measures: [
    {
      number: 1,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0 },
      startTime: 0,
      notes: [
        { id: '1', pitch: { midiNote: 60, octave: 4, step: 0 }, duration: 'quarter', onset: 0, isRest: false },
        { id: '2', pitch: { midiNote: 60, octave: 4, step: 0 }, duration: 'quarter', onset: 0.5, isRest: false },
        { id: '3', pitch: { midiNote: 67, octave: 4, step: 7 }, duration: 'quarter', onset: 1.0, isRest: false },
        { id: '4', pitch: { midiNote: 67, octave: 4, step: 7 }, duration: 'quarter', onset: 1.5, isRest: false },
      ],
    },
    {
      number: 2,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0 },
      startTime: 2.0,
      notes: [
        { id: '5', pitch: { midiNote: 69, octave: 4, step: 9 }, duration: 'quarter', onset: 2.0, isRest: false },
        { id: '6', pitch: { midiNote: 69, octave: 4, step: 9 }, duration: 'quarter', onset: 2.5, isRest: false },
        { id: '7', pitch: { midiNote: 67, octave: 4, step: 7 }, duration: 'half', onset: 3.0, isRest: false },
      ],
    },
  ],
}

export function useScores() {
  const [scores, setScores] = useState<Score[]>([sampleScore])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchScores = async () => {
    setIsLoading(true)
    try {
      // TODO: Replace with actual API call
      // const response = await fetch('/api/scores')
      // const data = await response.json()
      // setScores(data)
      setScores([sampleScore])
    } catch (err) {
      setError('Failed to fetch scores')
    } finally {
      setIsLoading(false)
    }
  }

  const getScore = (id: string): Score | undefined => {
    return scores.find((s) => s.id === id)
  }

  useEffect(() => {
    fetchScores()
  }, [])

  return {
    scores,
    isLoading,
    error,
    fetchScores,
    getScore,
  }
}
