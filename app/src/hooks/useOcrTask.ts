import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '@/lib/api'
import type { OcrTaskStatus, OcrErrorCode } from '@/lib/api'
import { ApiError } from '@/lib/api'

export type OcrPollState =
  | { status: 'pending' | 'running'; inputFileName: string; elapsedMs: number }
  | { status: 'done'; scoreId: string }
  | { status: 'failed'; errorCode: OcrErrorCode; errorDetail: string }

export interface UseOcrTaskResult {
  state: OcrPollState | null
  error: Error | null  // 网络层错误（区别于任务 failed）
  cancel: () => void
}

const POLL_INTERVAL_MS = 1500

export function useOcrTask(taskId: string | null): UseOcrTaskResult {
  const [state, setState] = useState<OcrPollState | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)

  const cancel = useCallback(() => {
    mountedRef.current = false
    if (taskId) void api.cancelOcrTask(taskId).catch(() => {})
  }, [taskId])

  useEffect(() => {
    mountedRef.current = true
    if (!taskId) {
      setState(null)
      setError(null)
      return
    }
    // 局部固化非空 taskId，让闭包内拿到 string（TS 不延续闭包外 narrowing）
    const id = taskId

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function pollOnce() {
      if (stopped || !mountedRef.current) return
      try {
        const status: OcrTaskStatus = await api.fetchOcrTask(id)
        if (stopped) return
        setError(null)
        // 终态转换 + 停轮询
        if (status.status === 'done') {
          setState({ status: 'done', scoreId: status.scoreId })
          return // 不再调度
        }
        if (status.status === 'failed') {
          setState({
            status: 'failed',
            errorCode: status.errorCode,
            errorDetail: status.errorDetail ?? '',
          })
          return
        }
        // pending/running 继续
        setState({
          status: status.status,
          inputFileName: status.inputFileName,
          elapsedMs: status.elapsedMs,
        })
        timer = setTimeout(pollOnce, POLL_INTERVAL_MS)
      } catch (err) {
        if (stopped) return
        // 网络层错误：存 error，不进任务终态
        setError(err instanceof Error ? err : new ApiError(String(err)))
        // 自动重试（不放弃）
        timer = setTimeout(pollOnce, POLL_INTERVAL_MS)
      }
    }

    void pollOnce()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [taskId])

  // 卸载守卫
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  return { state, error, cancel }
}
