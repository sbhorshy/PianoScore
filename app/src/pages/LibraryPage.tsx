import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Search, Trash2, ArrowUp, ArrowDown, X, Music, Clock, AlertCircle } from 'lucide-react'
import { useScores } from '@/hooks/useScores'
import type { ScoreSummary } from '@/lib/api'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0, 0, 0.2, 1] as const } },
}

export default function LibraryPage() {
  const { scores, isLoading, error, refresh, removeScore } = useScores()
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState('')
  const [composerFilter, setComposerFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'title' | 'createdAt'>('title')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [deleteTarget, setDeleteTarget] = useState<ScoreSummary | null>(null)

  // Extract unique composer options from scores
  const composerOptions = useMemo(() => {
    const composers = new Set<string>()
    for (const s of scores) {
      if (s.composer) {
        composers.add(s.composer)
      }
    }
    return Array.from(composers).sort((a, b) => a.localeCompare(b, 'zh-Hans'))
  }, [scores])

  // Filter and sort scores
  const filteredScores = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    let result = scores.filter((s) => {
      // Search filter: match title or composer (case-insensitive)
      if (q) {
        const titleMatch = s.title.toLowerCase().includes(q)
        const composerMatch = s.composer ? s.composer.toLowerCase().includes(q) : false
        if (!titleMatch && !composerMatch) return false
      }

      // Composer filter
      if (composerFilter === '__unspecified__') {
        if (s.composer) return false
      } else if (composerFilter !== 'all') {
        if (s.composer !== composerFilter) return false
      }

      return true
    })

    // Sort
    result = [...result].sort((a, b) => {
      let cmp: number
      if (sortBy === 'title') {
        cmp = a.title.localeCompare(b.title, 'zh-Hans')
      } else {
        // createdAt: use array index as proxy for insertion order
        const idxA = scores.indexOf(a)
        const idxB = scores.indexOf(b)
        cmp = idxA - idxB
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })

    return result
  }, [scores, searchQuery, composerFilter, sortBy, sortOrder])

  const hasActiveFilters = searchQuery.trim() !== '' || composerFilter !== 'all'

  function clearFilters() {
    setSearchQuery('')
    setComposerFilter('all')
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    await removeScore(deleteTarget.id)
    setDeleteTarget(null)
  }

  // --- Error state ---
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error Loading Scores</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error}</span>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => void refresh()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // --- Empty library state ---
  if (scores.length === 0) {
    return (
      <Card className="py-12">
        <CardContent className="flex flex-col items-center justify-center text-center">
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Music className="h-12 w-12 text-muted-foreground mb-4" />
          </motion.div>
          <CardTitle className="mb-2">No Scores Yet</CardTitle>
          <CardDescription>
            No scores yet. Add your first score to begin practicing.
          </CardDescription>
        </CardContent>
      </Card>
    )
  }

  // --- Main content with toolbar ---
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="搜索曲名或作曲家..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Composer filter */}
        <Select value={composerFilter} onValueChange={setComposerFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="作曲家" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="__unspecified__">未指定</SelectItem>
            {composerOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort select */}
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'title' | 'createdAt')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="title">曲名</SelectItem>
            <SelectItem value="createdAt">导入时间</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort direction toggle */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          title={sortOrder === 'asc' ? '升序' : '降序'}
        >
          {sortOrder === 'asc' ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Card grid */}
      <AnimatePresence mode="popLayout">
        {filteredScores.length > 0 ? (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            variants={container}
            initial="hidden"
            animate="show"
            key="grid"
          >
            {filteredScores.map((score) => (
              <motion.div key={score.id} variants={item} layout>
                <Card
                  className="cursor-pointer transition-shadow hover:shadow-md relative group"
                  onClick={() => navigate(`/practice/${score.id}`)}
                >
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(score)
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded-md opacity-40 hover:opacity-100 hover:text-red-500 transition-opacity z-10"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <CardHeader>
                    <CardTitle>{score.title}</CardTitle>
                    {score.composer && (
                      <CardDescription>{score.composer}</CardDescription>
                    )}
                  </CardHeader>
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
                </Card>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <Search className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">
              没有找到匹配的曲子
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除《{deleteTarget?.title}》吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteConfirm()}
              className="bg-red-600 hover:bg-red-700"
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
