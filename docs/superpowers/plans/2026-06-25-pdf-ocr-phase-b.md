# PDF/图片乐谱识别（OMR）— 阶段 B：前端接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 React 前端接入阶段 A 的 OCR 后端：ImportPage 分区加 PDF/图片扫描识别，轮询任务状态，done 跳转练习页，失败显示可重试错误，Library 显示扫描来源标签。

**Architecture:** API 客户端扩展 4 个 OCR 方法（+ health）；`useOcrTask` hook 每 1.5s 轮询，区分网络层 error 与任务 failed；`OcrTaskCard` 组件三态渲染（running/done/failed）；AIScanPage 分区改造（MusicXML 区保留 + 扫描区新增，挂载时 ping health 预判降级）；LibraryPage 显示 `sourceFormat='ocr'` 标签。

**Tech Stack:** React 19 / TypeScript / react-router-dom / framer-motion / shadcn-ui / vitest + @testing-library/react + jsdom

**Spec:** `docs/superpowers/specs/2026-06-24-pdf-ocr-design.md` 第 4-5 节、第 11 节"阶段 B"

**所有命令在 `app/` 目录执行：** `cd app && <command>`

---

## 文件结构（阶段 B 涉及）

| 文件 | 操作 | 责任 |
|------|------|------|
| `app/src/lib/api.ts` | 修改 | ScoreSummary/ScoreData 加 sourceFormat（去掉无用的 noteCount/id 类型错误）；加 OCR 类型 + 4 个方法（createOcrTask/fetchOcrTask/cancelOcrTask/fetchHealth） |
| `app/src/hooks/useOcrTask.ts` | 新建 | 轮询 hook（1.5s，区分网络 error 与任务 failed，终态停） |
| `app/src/hooks/__tests__/useOcrTask.test.ts` | 新建 | hook 测试（jsdom） |
| `app/src/components/OcrTaskCard.tsx` | 新建 | 任务卡片三态组件（running/done/failed + 取消/重试/复制详情） |
| `app/src/pages/AIScanPage.tsx` | 修改 | 分区：MusicXML 区（现有逻辑）+ 扫描识别区（新增 OcrTaskCard + health 降级 + 409 处理） |
| `app/src/pages/LibraryPage.tsx` | 修改 | sourceFormat='ocr' 显示「📷 扫描」标签；修 noteCount→去掉（后端不返回） |

---

## Task 1: api.ts 扩展（OCR 类型 + 方法 + ScoreSummary 修正）

API 客户端层。修正现有类型不一致 + 加 OCR 接口。

**Files:**
- Modify: `app/src/lib/api.ts`

- [ ] **Step 1: 修正 ScoreSummary/ScoreData 类型 + 加 OCR 类型与方法**

当前 `ScoreData.id` 是 `number`（后端返回 string）、`ScoreSummary.noteCount` 后端从不返回。修正为与后端契约一致（阶段 A 后端 ScoreSummary = {id, title, composer, tempo, sourceFormat}，FullScore 加 sourceXml）。在 api.ts 末尾追加 OCR 类型与方法。

替换文件顶部两个 interface（line 2-16）：

```typescript
export interface ScoreData {
  id: string
  title: string
  composer: string | null
  tempo: number
  sourceFormat: string
  sourceXml: string
}

export interface ScoreSummary {
  id: string
  title: string
  composer: string | null
  tempo: number
  sourceFormat: string
}
```

在文件末尾追加 OCR 类型与方法（复用现有 `handle` 和 `ApiError`）：

```typescript
// ── OCR (PDF/image recognition) ──────────────────────────────────────────
export type OcrErrorCode = 'no_java' | 'no_audiveris' | 'engine_crash' | 'no_output' | 'low_confidence'

export type OcrTaskStatus =
  | { status: 'pending' | 'running'; inputFileName: string; elapsedMs: number }
  | { status: 'done'; scoreId: string }
  | { status: 'failed'; errorCode: OcrErrorCode; errorDetail: string | null }

export interface OcrHealth {
  ok: boolean
  ocr: { available: boolean; reason?: OcrErrorCode | 'no_audiveris' }
}

export async function createOcrTask(file: File): Promise<{ taskId: string; status: string }> {
  const form = new FormData()
  form.append('file', file)
  return handle<{ taskId: string; status: string }>(await fetch('/api/ocr', { method: 'POST', body: form }))
}

export async function fetchOcrTask(taskId: string): Promise<OcrTaskStatus> {
  return handle<OcrTaskStatus>(await fetch(`/api/ocr/${taskId}`))
}

export async function cancelOcrTask(taskId: string): Promise<void> {
  await handle<{ deleted: boolean }>(await fetch(`/api/ocr/${taskId}`, { method: 'DELETE' }))
}

export async function fetchHealth(): Promise<OcrHealth> {
  return handle<OcrHealth>(await fetch('/api/health'))
}
```

- [ ] **Step 2: typecheck**

Run: `cd app && npm run typecheck` (若 app 无此 script，用 `npx tsc --noEmit`)
Expected: 报错——LibraryPage 用了 `score.noteCount`（已移除）。这是预期的，Task 5 会修。

- [ ] **Step 3: Commit**

```bash
cd app
git add src/lib/api.ts
git commit -m "feat(api): add OCR client (createOcrTask/fetchOcrTask/cancelOcrTask/fetchHealth) + fix ScoreSummary type

ScoreData.id was number (backend returns string); ScoreSummary.noteCount
was never returned by backend. Now matches the real /api/scores contract.
OCR types + 4 methods added for phase B."
```

---

## Task 2: useOcrTask hook

轮询 hook。1.5s 间隔，区分网络层 ApiError（可重试）与任务 failed（终态不重试）。

**Files:**
- Create: `app/src/hooks/useOcrTask.ts`
- Test: `app/src/hooks/__tests__/useOcrTask.test.ts`

- [ ] **Step 1: 写失败测试（jsdom）**

```typescript
// app/src/hooks/__tests__/useOcrTask.test.ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
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

    // 触发首次轮询 + 后续
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(result.current.state?.status).toBe('running')

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
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

    expect(result.current.state?.status).toBe('failed')
    if (result.current.state?.status === 'failed') {
      expect(result.current.state.errorCode).toBe('engine_crash')
    }
  })

  it('network error stored separately from task failed', async () => {
    vi.mocked(api.fetchOcrTask).mockRejectedValueOnce(new Error('connection refused'))

    const { result } = renderHook(() => useOcrTask('task-3'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd app && npx vitest run src/hooks/__tests__/useOcrTask.test.ts`
Expected: FAIL — "Cannot find module '@/hooks/useOcrTask'"

- [ ] **Step 3: 实现 useOcrTask**

```typescript
// app/src/hooks/useOcrTask.ts
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

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function pollOnce() {
      if (stopped || !mountedRef.current) return
      try {
        const status: OcrTaskStatus = await api.fetchOcrTask(taskId)
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd app && npx vitest run src/hooks/__tests__/useOcrTask.test.ts`
Expected: PASS — 4 个测试

- [ ] **Step 5: typecheck + Commit**

```bash
cd app
git add src/hooks/useOcrTask.ts src/hooks/__tests__/useOcrTask.test.ts
git commit -m "feat(hooks): useOcrTask polling hook (1.5s, separates network error from task failed)"
```

---

## Task 3: OcrTaskCard 组件

任务卡片三态渲染。done 跳转，failed 显示 errorCode 文案 + 重试/复制详情/放弃，running 显示旋转动画 + 取消。

**Files:**
- Create: `app/src/components/OcrTaskCard.tsx`

- [ ] **Step 1: 实现 OcrTaskCard（无独立单测，由页面集成测试覆盖）**

errorCode → 文案映射表（spec 第 6.5 节）：

```typescript
// app/src/components/OcrTaskCard.tsx
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, AlertCircle, X, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOcrTask } from '@/hooks/useOcrTask'
import { cancelOcrTask } from '@/lib/api'
import type { OcrErrorCode } from '@/lib/api'

const ERROR_MESSAGES: Record<OcrErrorCode, string> = {
  no_java: '未检测到 Java 运行环境。桌面版已内置 Java，Web 版需本机安装 JDK 17+。',
  no_audiveris: '识别引擎文件缺失，请重新安装应用或放置 audiveris.jar。',
  engine_crash: '识别引擎异常退出，可能是 PDF 损坏或谱面过于复杂。',
  no_output: '未能识别出乐谱，请确认是清晰的五线谱 PDF 或图片。',
  low_confidence: '识别结果为空，可能是扫描质量不足或非乐谱图像。',
}

interface OcrTaskCardProps {
  taskId: string
  fileName: string
  onRetry: () => void
  onDismiss: () => void
}

export function OcrTaskCard({ taskId, fileName, onRetry, onDismiss }: OcrTaskCardProps) {
  const { state, error, cancel } = useOcrTask(taskId)
  const navigate = useNavigate()
  const navigatedRef = useRef(false)

  // done → 跳转练习页（一次性）
  useEffect(() => {
    if (state?.status === 'done' && !navigatedRef.current) {
      navigatedRef.current = true
      navigate(`/practice/${state.scoreId}`)
    }
  }, [state, navigate])

  async function handleDismiss() {
    await cancelOcrTask(taskId).catch(() => {})
    cancel()
    onDismiss()
  }

  function copyDetail() {
    if (state?.status === 'failed') {
      void navigator.clipboard?.writeText(`${state.errorCode}: ${state.errorDetail}`)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="border rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate flex-1">{fileName}</span>
        <button type="button" onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <AnimatePresence mode="wait">
        {(!state || state.status === 'pending' || state.status === 'running') && (
          <motion.div key="running" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>识别中… 已耗时 {state ? Math.round(state.elapsedMs / 1000) : 0}s</span>
            <Button variant="ghost" size="sm" onClick={handleDismiss}>取消</Button>
          </motion.div>
        )}

        {state?.status === 'done' && (
          <motion.div key="done" className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>识别完成，正在跳转练习页…</span>
          </motion.div>
        )}

        {state?.status === 'failed' && (
          <motion.div key="failed" className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{ERROR_MESSAGES[state.errorCode]}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
              <Button variant="ghost" size="sm" onClick={copyDetail}>
                <Copy className="h-3 w-3 mr-1" />复制详情
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>放弃</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 网络层错误（区别于任务 failed） */}
      {error && state?.status !== 'failed' && (
        <div className="text-xs text-amber-600">
          轮询中断：{error.message}，正在重试…
        </div>
      )}
    </motion.div>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: 无错误（OcrTaskCard 仅类型消费 useOcrTask 和 api）

- [ ] **Step 3: Commit**

```bash
cd app
git add src/components/OcrTaskCard.tsx
git commit -m "feat(components): OcrTaskCard three-state (running/done/failed) + retry/copy/dismiss"
```

---

## Task 4: AIScanPage 分区改造

MusicXML 区（现有逻辑）保留，下方加扫描识别区。挂载时 ping health 预判降级；409 处理。

**Files:**
- Modify: `app/src/pages/AIScanPage.tsx`

- [ ] **Step 1: 改造 AIScanPage 加扫描区**

在文件顶部 import 区加（复用现有 useState/useRef/useCallback，额外加 useEffect）：

```typescript
import { useState, useRef, useCallback, useEffect } from 'react'
import { ScanLine, FileImage } from 'lucide-react'
import { OcrTaskCard } from '@/components/OcrTaskCard'
import { createOcrTask, fetchHealth } from '@/lib/api'
```

在组件内（`const { refresh } = useScores()` 之后）加 OCR 状态：

```typescript
  // ── OCR 扫描识别区状态 ──
  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null)  // null=未检测
  const [ocrReason, setOcrReason] = useState<string | null>(null)
  const [ocrTaskId, setOcrTaskId] = useState<string | null>(null)
  const [ocrFileName, setOcrFileName] = useState<string>('')
  const [ocrError, setOcrError] = useState<string | null>(null)
  const ocrFileRef = useRef<HTMLInputElement>(null)
  const pendingOcrFileRef = useRef<File | null>(null)  // 重试用

  // 挂载时 ping health 预判 OCR 可用性
  useEffect(() => {
    let cancelled = false
    fetchHealth()
      .then((h) => {
        if (cancelled) return
        setOcrAvailable(h.ocr.available)
        if (!h.ocr.available && h.ocr.reason) {
          setOcrReason(h.ocr.reason)
        }
      })
      .catch(() => {
        if (cancelled) return
        setOcrAvailable(false)
        setOcrReason('后端不可达')
      })
    return () => { cancelled = true }
  }, [])
```

需在顶部 import 加 `useEffect`（AIScanPage 当前只 import 了 useState/useRef/useCallback）。

加 OCR 上传处理函数：

```typescript
  const handleOcrFile = useCallback(async (file: File | null) => {
    if (!file) return
    const name = file.name.toLowerCase()
    if (!['.pdf', '.png', '.jpg', '.jpeg'].some((ext) => name.endsWith(ext))) {
      setOcrError('不支持的格式。请选择 PDF、PNG 或 JPG。')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setOcrError('文件大小超过 20MB 限制。')
      return
    }
    setOcrError(null)
    pendingOcrFileRef.current = file
    try {
      const { taskId } = await createOcrTask(file)
      setOcrTaskId(taskId)
      setOcrFileName(file.name)
    } catch (err) {
      // 409: 已有任务运行中
      const msg = err instanceof Error ? err.message : '上传失败'
      setOcrError(msg.includes('already running') ? '已有识别任务进行中，请等待完成或取消后再试。' : msg)
    }
  }, [])

  const handleOcrRetry = useCallback(() => {
    setOcrTaskId(null)
    const f = pendingOcrFileRef.current
    if (f) void handleOcrFile(f)
  }, [handleOcrFile])

  const handleOcrDismiss = useCallback(() => {
    setOcrTaskId(null)
    setOcrFileName('')
    refresh()
  }, [refresh])
```

在 `return` 的 JSX 里，现有 `<Card>...</Card>` 之后（外层 `<div className="max-w-2xl mx-auto">` 内）加扫描区 Card：

```tsx
      {/* ── 扫描识别区 ── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            扫描识别（PDF / 图片）
          </CardTitle>
          <CardDescription>
            上传乐谱 PDF 或图片，通过 Audiveris OCR 引擎自动识别为可练习的乐谱。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 降级提示 */}
          {ocrAvailable === false && (
            <Alert variant="default">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>PDF 识别不可用</AlertTitle>
              <AlertDescription>
                {ocrReason === 'no_java'
                  ? '本机后端未检测到 Java 环境。桌面版已内置，Web 版需本机安装 JDK 17+ 并启动后端。'
                  : ocrReason === '后端不可达'
                    ? 'PDF 识别需要本地后端运行。如果这是网页版，请确保 localhost:8000 已启动。'
                    : '识别引擎不可用，请检查环境配置。'}
              </AlertDescription>
            </Alert>
          )}

          {/* 上传区（OCR 可用或未检测时显示） */}
          {ocrAvailable !== false && (
            <>
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-muted-foreground/50 border-muted-foreground/25"
                onClick={() => ocrFileRef.current?.click()}
              >
                <FileImage className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">点击上传或拖拽 PDF / 图片</p>
                <p className="mt-1 text-xs text-muted-foreground">PDF、PNG、JPG（最大 20MB）</p>
                <input
                  ref={ocrFileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => void handleOcrFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {ocrError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{ocrError}</AlertDescription>
                </Alert>
              )}

              {/* 任务卡片 */}
              {ocrTaskId && (
                <OcrTaskCard
                  taskId={ocrTaskId}
                  fileName={ocrFileName}
                  onRetry={handleOcrRetry}
                  onDismiss={handleOcrDismiss}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 2: typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: 无错误，build 成功

- [ ] **Step 3: Commit**

```bash
cd app
git add src/pages/AIScanPage.tsx
git commit -m "feat(pages): AIScanPage split — add OCR scan section with health-gated upload + 409 handling"
```

---

## Task 5: LibraryPage sourceFormat 标签 + 修 noteCount

显示扫描来源标签；去掉 noteCount（后端不返回，显示 undefined）。

**Files:**
- Modify: `app/src/pages/LibraryPage.tsx`

- [ ] **Step 1: 修 noteCount + 加 sourceFormat 标签**

替换卡片内容区（line 276-288 附近，`<CardContent>` 内）：

当前：
```tsx
<CardContent>
  <div className="flex items-center gap-4 text-sm text-muted-foreground">
    <span className="flex items-center gap-1">
      <Music className="h-4 w-4" />
      {score.noteCount} notes
    </span>
    <span className="flex items-center gap-1">
      <Clock className="h-4 w-4" />
      <Badge variant="secondary" className="text-xs">
        {score.tempo} BPM
      </Badge>
    </span>
  </div>
</CardContent>
```

改为（去掉 noteCount，加 sourceFormat 标签）：

```tsx
<CardContent>
  <div className="flex items-center gap-4 text-sm text-muted-foreground">
    <span className="flex items-center gap-1">
      <Clock className="h-4 w-4" />
      <Badge variant="secondary" className="text-xs">
        {score.tempo} BPM
      </Badge>
    </span>
    {score.sourceFormat === 'ocr' && (
      <Badge variant="outline" className="text-xs gap-1">
        <ScanLine className="h-3 w-3" />
        扫描识别
      </Badge>
    )}
  </div>
</CardContent>
```

顶部 import 加 `ScanLine`（lucide-react）。移除未再使用的 `Music` import 若无其他引用（grep 确认 LibraryPage 其他地方是否用 Music——line 162 empty state 用了 `<Music>`，保留 Music import）。

- [ ] **Step 2: typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: 无错误（noteCount 已移除，与 api.ts 一致）

- [ ] **Step 3: Commit**

```bash
cd app
git add src/pages/LibraryPage.tsx
git commit -m "feat(pages): Library shows 扫描识别 badge for sourceFormat=ocr; drop undefined noteCount

Backend never returned noteCount, so the card showed 'undefined notes'.
Removed; sourceFormat=ocr now shows a 扫描识别 badge."
```

---

## Task 6: 全量验收

- [ ] **Step 1: 前端全量测试 + build + typecheck**

Run: `cd app && npx vitest run && npm run build`
Expected: 全部通过（含新 useOcrTask 4 测试），build 成功

- [ ] **Step 2: lint**

Run: `cd app && npm run lint`
Expected: 无错误

- [ ] **Step 3: 手动验收（需前后端都启动）**

```bash
# 终端 1：后端（需 Java + jar 才能真识别；无 jar 时降级提示也应正确）
cd server && npm run dev
# 终端 2：前端
cd app && npm run dev
```

浏览器 http://localhost:5173/import：
- [ ] 看到 MusicXML 区 + 扫描识别区两个 Card
- [ ] 后端无 Java 时，扫描区显示「PDF 识别不可用」降级提示
- [ ] 后端有 Java + jar 时，上传 PDF → 任务卡片显示「识别中…」→ done 跳转 /practice/:id
- [ ] 上传非乐谱 PDF → failed 显示对应 errorCode 文案 + 重试/复制/放弃按钮
- [ ] 双击上传第二个文件 → 409 提示「已有任务进行中」
- [ ] Library 页扫描识别的曲谱显示「📷 扫描识别」标签

- [ ] **Step 4: Commit（如有验收修复）**

```bash
git add -A
git commit -m "chore: phase B verification complete"
```

---

## Self-Review checklist

完成所有 task 后对照检查：

- [ ] spec 第 4 节（API 客户端）→ Task 1 ✓
- [ ] spec 第 5.1-5.3 节（ImportPage 分区、OcrTaskCard、useOcrTask）→ Task 2-4 ✓
- [ ] spec 第 5.4 节（降级策略 health 预判 + 409 兜底）→ Task 4 ✓
- [ ] spec 第 5.5 节（LibraryPage 标签）→ Task 5 ✓
- [ ] api.ts 类型修正（id number→string，去 noteCount）→ Task 1 + 5 ✓
