import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Upload, File, CheckCircle2, AlertCircle, ScanLine, FileImage } from 'lucide-react'
import { useScores } from '@/hooks/useScores'
import { OcrTaskCard } from '@/components/OcrTaskCard'
import { createOcrTask, fetchHealth } from '@/lib/api'

type PageState = 'initial' | 'selected' | 'uploading' | 'success' | 'error'

const stateTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0, 0, 0.2, 1] as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } },
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_EXTENSIONS = ['.musicxml', '.xml', '.mxl']

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export default function AIScanPage() {
  const [pageState, setPageState] = useState<PageState>('initial')
  const [file, setFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [scoreTitle, setScoreTitle] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const { refresh } = useScores()

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

  const reset = useCallback(() => {
    setPageState('initial')
    setFile(null)
    setUploadProgress(0)
    setScoreTitle(null)
    setErrorMessage(null)
    if (xhrRef.current) {
      xhrRef.current.abort()
      xhrRef.current = null
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handleFile = useCallback((selectedFile: File | null) => {
    if (!selectedFile) return

    if (!isAcceptedFile(selectedFile)) {
      setErrorMessage('不支持的文件格式。请选择 .musicxml、.xml 或 .mxl 文件。')
      setPageState('error')
      return
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setErrorMessage('文件大小超过 10MB 限制。')
      setPageState('error')
      return
    }

    setFile(selectedFile)
    setPageState('selected')
    setScoreTitle(null)
    setErrorMessage(null)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] ?? null)
  }, [handleFile])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    handleFile(e.dataTransfer.files?.[0] ?? null)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file) return

    setPageState('uploading')
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    const uploadComplete = new Promise<{ title: string }>((resolve, reject) => {
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            resolve(data)
          } catch {
            reject(new Error('服务器返回了无效的响应格式。'))
          }
        } else {
          try {
            const errBody = JSON.parse(xhr.responseText)
            reject(new Error(errBody.detail || errBody.message || `上传失败 (${xhr.status})`))
          } catch {
            reject(new Error(`上传失败 (${xhr.status})`))
          }
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('网络错误，请检查您的连接。'))
      })

      xhr.addEventListener('abort', () => {
        reject(new Error('上传已取消。'))
      })
    })

    xhr.open('POST', '/api/import')
    xhr.send(formData)

    try {
      const result = await uploadComplete
      setScoreTitle(result.title)
      setPageState('success')
      refresh()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '上传时发生未知错误。')
      setPageState('error')
    } finally {
      xhrRef.current = null
    }
  }, [file, refresh])

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>导入乐谱</CardTitle>
          <CardDescription>
            上传 MusicXML 文件，将乐谱导入到您的曲库中。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AnimatePresence mode="wait">
            {pageState === 'initial' && (
              <motion.div
                key="dropzone"
                variants={stateTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? 'border-primary bg-primary/5 shadow-[0_0_20px_rgba(41,151,255,0.15)]'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <motion.div
                  animate={isDragOver ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
                </motion.div>
                <p className="mt-4 text-sm font-medium">
                  {isDragOver ? '松开以上传文件' : '点击上传或拖拽文件到此处'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  MusicXML、XML 或 MXL 文件（最大 10MB）
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".musicxml,.xml,.mxl"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </motion.div>
            )}

            {pageState === 'selected' && file && (
              <motion.div
                key="selected"
                variants={stateTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="flex items-center gap-3 p-4 border rounded-lg">
                  <File className="h-8 w-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={reset}>
                    更换文件
                  </Button>
                </div>
                <Button className="w-full" onClick={handleUpload}>
                  开始导入
                </Button>
              </motion.div>
            )}

            {pageState === 'uploading' && (
              <motion.div
                key="uploading"
                variants={stateTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                {file && (
                  <div className="flex items-center gap-3 p-4 border rounded-lg">
                    <File className="h-8 w-8 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        正在上传...
                      </p>
                    </div>
                  </div>
                )}
                <div className="relative overflow-hidden rounded-md">
                  <Progress value={uploadProgress} />
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                    animate={{ x: ['-200%', '200%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {uploadProgress}% 已上传
                </p>
                <Button className="w-full" disabled>
                  <Upload className="h-4 w-4 mr-2 animate-spin" />
                  正在上传...
                </Button>
              </motion.div>
            )}

            {pageState === 'success' && scoreTitle && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, type: 'spring', damping: 20 }}
                className="space-y-4"
              >
                <Alert variant="default" className="border-green-500">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertTitle>导入成功</AlertTitle>
                  <AlertDescription>
                    乐谱「{scoreTitle}」已成功添加到您的曲库。
                  </AlertDescription>
                </Alert>
                <Button className="w-full" variant="outline" onClick={reset}>
                  继续导入
                </Button>
              </motion.div>
            )}

            {pageState === 'error' && errorMessage && (
              <motion.div
                key="error"
                initial={{ opacity: 0, x: 0 }}
                animate={{
                  opacity: 1,
                  x: [0, -8, 8, -4, 4, 0],
                }}
                transition={{ duration: 0.4 }}
                className="space-y-4"
              >
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>导入失败</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
                <Button className="w-full" variant="outline" onClick={reset}>
                  重试
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

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
    </div>
  )
}
