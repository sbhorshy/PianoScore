/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOcrTask } from '@/hooks/useOcrTask'
import * as api from '@/lib/api'

vi.mock('@/lib/api', () => ({
  fetchOcrTask: vi.fn(),
  cancelOcrTask: vi.fn().mockResolvedValue(undefined),
}))

describe('useOcrTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api.fetchOcrTask).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls until done, then stops', async () => {
    vi.mocked(api.fetchOcrTask)
      .mockResolvedValueOnce({ status: 'running', inputFileName: 'a.pdf', elapsedMs: 1000 })
      .mockResolvedValueOnce({ status: 'done', scoreId: 'score-1' })

    const { result } = renderHook(() => useOcrTask('task-1'))
    expect(result.current.state).toBeNull()

    // 首次轮询：useEffect 立即 pollOnce，advance(0) flush microtask 拿到 running
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.state?.status).toBe('running')

    // 推进 1500ms 触发第二轮（done）
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.state?.status).toBe('done')
    if (result.current.state?.status === 'done') {
      expect(result.current.state.scoreId).toBe('score-1')
    }

    // done 后不再轮询
    const callsAfterDone = vi.mocked(api.fetchOcrTask).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(vi.mocked(api.fetchOcrTask).mock.calls.length).toBe(callsAfterDone)
  })

  it('stops on failed, surfaces errorCode', async () => {
    vi.mocked(api.fetchOcrTask).mockResolvedValueOnce({
      status: 'failed', errorCode: 'engine_crash', errorDetail: 'boom',
    })

    const { result } = renderHook(() => useOcrTask('task-2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.state?.status).toBe('failed')
    if (result.current.state?.status === 'failed') {
      expect(result.current.state.errorCode).toBe('engine_crash')
    }
  })

  it('network error stored separately from task failed', async () => {
    vi.mocked(api.fetchOcrTask).mockRejectedValueOnce(new Error('connection refused'))

    const { result } = renderHook(() => useOcrTask('task-3'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.state).toBeNull() // 任务未进入终态
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('null taskId does not poll', async () => {
    const { result } = renderHook(() => useOcrTask(null))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(api.fetchOcrTask).not.toHaveBeenCalled()
    expect(result.current.state).toBeNull()
  })
})
