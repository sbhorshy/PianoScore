import { useState, useEffect, useCallback } from 'react'
import * as api from '@/lib/api'
import type { ScoreData } from '@/lib/api'

// Fetch a single score by ID. Used by the practice page.
export function useScore(id: string | undefined) {
  const [score, setScore] = useState<ScoreData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) {
      setError('Missing score ID')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      setScore(await api.fetchScore(id))
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : 'Failed to load score')
      setScore(null)
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  return { score, isLoading, error, reload: load }
}
