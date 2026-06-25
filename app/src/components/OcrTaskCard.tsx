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
