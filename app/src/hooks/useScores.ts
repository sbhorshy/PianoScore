import { useState, useEffect, useCallback } from 'react'
import * as api from '@/lib/api'
import type { ScoreSummary } from '@/lib/api'

interface UseScoresResult {
  scores: ScoreSummary[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  importScore: (file: File) => Promise<ScoreSummary>
  removeScore: (id: string) => Promise<void>
}

// 真实数据：全部走后端 /api。后端不可达时 error 非空，由页面展示重试，
// 不再回退到写死的样例（需求 3.4）。
export function useScores(): UseScoresResult {
  const [scores, setScores] = useState<ScoreSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      setScores(await api.fetchScores())
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法连接后端')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const importScore = useCallback(
    async (file: File) => {
      const summary = await api.importScore(file)
      await refresh()
      return summary
    },
    [refresh],
  )

  const removeScore = useCallback(
    async (id: string) => {
      await api.deleteScore(id)
      await refresh()
    },
    [refresh],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { scores, isLoading, error, refresh, importScore, removeScore }
}
