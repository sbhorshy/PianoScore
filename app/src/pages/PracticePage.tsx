import { useParams, Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { PracticeMode, PracticeStyle, ScoringTarget } from '@/types/music'
import type { ScoringConfig } from '@/scoring/types'
import type { AudioOutput } from '@/services/audio'
import { WebAudioSynth, ToneJsOutput } from '@/services/audio'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Play, Square, RotateCcw, CheckCircle2, XCircle, Music, AlertCircle, Headphones, Users, Repeat } from 'lucide-react'
import { useScore } from '@/hooks/useScore'
import { useSettings } from '@/hooks/useSettings'
import { usePractice } from '@/hooks/usePractice'
import { usePlayback } from '@/hooks/usePlayback'
import { useMIDI } from '@/hooks/useMIDI'
import { useClock } from '@/hooks/useClock'
import { recordSession } from '@/lib/api'
import { DEFAULT_SCORING_CONFIG } from '@/scoring/engine'
import { buildTargetTimeline, tempoTick, initPositionState, type PositionState, type TargetTimeline } from '@/scoring/position'
import { filterTargetsByRange, type MeasureRange } from '@/scoring/rangeFilter'
import { OsmdScore } from '@/components/OsmdScore'
import type { OsmdService } from '@/services/osmd'
import type { TargetResult } from '@/components/OsmdScore'
import { VirtualKeyboard } from '@/components/VirtualKeyboard'

// ── Animation variants ────────────────────────────────────────────────────

const badgePop = {
  initial: { scale: 1 },
  pulse: { scale: [1, 1.15, 1], transition: { duration: 0.3 } },
}

const feedbackVariants = {
  correct: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, transition: { duration: 0.15 } },
  },
  wrong: {
    initial: { opacity: 0, y: -20 },
    animate: {
      opacity: 1, y: 0,
      x: [0, -8, 8, -4, 4, 0],
      transition: { duration: 0.4, y: { duration: 0.2 }, x: { duration: 0.3, delay: 0.2 } },
    },
    exit: { opacity: 0, transition: { duration: 0.15 } },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function filterTargetsByMode(targets: ScoringTarget[], mode: PracticeMode): ScoringTarget[] {
  if (mode === 'both') return targets
  return targets.filter((t) => t.hands.includes(mode === 'right' ? 'right' : 'left'))
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PracticePage() {
  const { scoreId } = useParams<{ scoreId: string }>()
  const { score, isLoading, error } = useScore(scoreId)
  const { settings } = useSettings()
  const midi = useMIDI()

  // All targets extracted from OSMD after render.
  const [allTargets, setAllTargets] = useState<ScoringTarget[]>([])
  const [osmdReady, setOsmdReady] = useState(false)

  // Practice mode selector (hand mode).
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('both')

  // Practice style selector.
  const [practiceStyle, setPracticeStyle] = useState<PracticeStyle>('free')

  // Measure range selection for looping.
  const [measureRange, setMeasureRange] = useState<MeasureRange | null>(null)
  const [repeatOn, setRepeatOn] = useState(false)
  const [totalMeasures, setTotalMeasures] = useState(0)

  // Base tempo from the score (read-only). Falls back to 120 during loading.
  const scoreTempo = score?.tempo ?? 120

  // Speed multiplier for listen/follow modes (resets per session).
  const [speedMultiplier, setSpeedMultiplier] = useState(0.5)
  const effectiveTempo = Math.round(scoreTempo * speedMultiplier)

  // Audio output for listen mode.
  const synthRef = useRef<WebAudioSynth | null>(null)
  const toneRef = useRef<ToneJsOutput | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioReady, setAudioReady] = useState(false)

  const getAudioOutput = useCallback((): AudioOutput | null => {
    // Prefer ToneJsOutput if loaded
    if (toneRef.current?.isLoaded) {
      return toneRef.current
    }
    // Fall back to WebAudioSynth
    if (!synthRef.current) {
      synthRef.current = new WebAudioSynth()
    }
    return synthRef.current
  }, [])

  /** Load ToneJsOutput for high-quality piano playback. */
  const ensureToneJs = useCallback(async (): Promise<AudioOutput | null> => {
    // If already loaded, return it
    if (toneRef.current?.isLoaded) return toneRef.current

    setAudioLoading(true)
    try {
      if (!toneRef.current) {
        toneRef.current = new ToneJsOutput()
      }
      await toneRef.current.load((loaded) => {
        if (loaded) setAudioReady(true)
      })
      return toneRef.current
    } catch {
      // ToneJs failed — fall back to WebAudioSynth
      toneRef.current?.dispose()
      toneRef.current = null
      if (!synthRef.current) {
        synthRef.current = new WebAudioSynth()
      }
      return synthRef.current
    } finally {
      setAudioLoading(false)
    }
  }, [getAudioOutput])

  // Clean up synth on unmount
  useEffect(() => {
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose()
        synthRef.current = null
      }
      if (toneRef.current) {
        toneRef.current.dispose()
        toneRef.current = null
      }
    }
  }, [])

  // Targets filtered for current practice mode.
  const filteredTargets = useMemo(
    () => filterTargetsByMode(allTargets, practiceMode),
    [allTargets, practiceMode],
  )

  // Targets further filtered by measure range.
  const rangeFilteredTargets = useMemo(
    () => filterTargetsByRange(filteredTargets, measureRange),
    [filteredTargets, measureRange],
  )

  // Build a set of global target indices for the filtered targets,
  // so OsmdScore can gray out the "other hand" notes and out-of-range notes.
  const filteredTargetIndices = useMemo(() => {
    const indices = new Set<number>()
    for (const t of rangeFilteredTargets) {
      indices.add(t.index)
    }
    return indices
  }, [rangeFilteredTargets])

  // Scoring config from settings.
  const cfg = useMemo<ScoringConfig>(
    () => ({
      ...DEFAULT_SCORING_CONFIG,
      chordWindowMs: settings.chordWindowMs,
    }),
    [settings.chordWindowMs],
  )

  // Scoring hook — driven by filtered targets.
  const {
    scoringState,
    positionState,
    handleNoteOn,
    handleNoteOff,
    reset,
    isComplete,
    summary,
    settleTarget: settleTargetCb,
    settlements,
  } = usePractice(rangeFilteredTargets, cfg, practiceStyle)

  // Ref to track repeat flag for playback onComplete (avoids stale closure).
  const repeatOnRef = useRef(repeatOn)
  repeatOnRef.current = repeatOn
  const playbackPlayRef = useRef<(() => void) | null>(null)

  // Playback hook — used in listen mode.
  const playback = usePlayback({
    targets: rangeFilteredTargets,
    tempo: effectiveTempo,
    audioOutput: practiceStyle === 'listen' ? getAudioOutput() : null,
    onComplete: () => {
      // Loop: restart playback if repeat is on
      if (repeatOnRef.current && playbackPlayRef.current) {
        setTimeout(() => playbackPlayRef.current?.(), 50)
      }
    },
  })
  playbackPlayRef.current = playback.play

  // ── Follow mode state ──────────────────────────────────────────────────
  const [followRunning, setFollowRunning] = useState(false)
  const [followPosition, setFollowPosition] = useState<PositionState>(initPositionState)
  const prevFollowIndexRef = useRef(0)
  const settleTargetCbRef = useRef(settleTargetCb)
  settleTargetCbRef.current = settleTargetCb
  const rangeFilteredTargetsRef = useRef(rangeFilteredTargets)
  rangeFilteredTargetsRef.current = rangeFilteredTargets

  // Build timeline for follow mode
  const followTimeline: TargetTimeline = useMemo(
    () => buildTargetTimeline(rangeFilteredTargets),
    [rangeFilteredTargets],
  )

  // Clock tick handler for follow mode
  const onFollowTick = useCallback((elapsedMs: number) => {
    setFollowPosition((prev) => {
      const next = tempoTick(prev, followTimeline, effectiveTempo, elapsedMs)

      // When position advances, settle the previous target
      if (next.targetIndex !== prev.targetIndex) {
        // Settle all targets we passed through
        for (let i = prev.targetIndex; i < next.targetIndex; i++) {
          const target = rangeFilteredTargetsRef.current[i]
          if (target) {
            settleTargetCbRef.current(target)
          }
        }
        prevFollowIndexRef.current = next.targetIndex
      }

      return next
    })
  }, [followTimeline, effectiveTempo])

  // Follow mode clock
  useClock({ tempo: effectiveTempo, running: followRunning, onTick: onFollowTick })

  const isFollowRunning = practiceStyle === 'follow' && followRunning

  // Handle listen button click: load ToneJsOutput, then start playback.
  const handleListenPlay = useCallback(async () => {
    await ensureToneJs()
    playback.play()
  }, [ensureToneJs, playback])

  const isListenPlaying = practiceStyle === 'listen' && playback.isPlaying

  // Determine which position to show based on practice style.
  const activePosition = practiceStyle === 'listen'
    ? playback.currentPosition
    : practiceStyle === 'follow'
      ? followPosition
      : positionState

  const { correct, wrong } = scoringState
  const { targetIndex } = activePosition
  const totalNotes = rangeFilteredTargets.length
  const isFinished = practiceStyle === 'free' && isComplete && totalNotes > 0

  // Map the practice-level targetIndex back to the global index
  // so OsmdScore can color the right note.
  const currentGlobalIndex = rangeFilteredTargets[targetIndex]?.index ?? -1

  // Build completedTargets map.
  // Free mode: all targets before targetIndex are 'correct'.
  // Follow mode: use the settlements map.
  const completedTargets = useMemo(() => {
    const map = new Map<number, TargetResult>()
    if (practiceStyle === 'follow') {
      for (const [globalIdx, settlement] of settlements) {
        map.set(globalIdx, settlement === 'missed' ? 'missed' : settlement === 'correct' ? 'correct' : 'wrong')
      }
      return map
    }
    // Free mode
    for (let i = 0; i < targetIndex; i++) {
      const globalIdx = rangeFilteredTargets[i]?.index
      if (globalIdx !== undefined) {
        map.set(globalIdx, 'correct')
      }
    }
    return map
  }, [rangeFilteredTargets, targetIndex, practiceStyle, settlements])

  // ── OSMD ready callback ──────────────────────────────────────────────
  const handleOsmdReady = useCallback((service: OsmdService) => {
    const targets = service.getTargets()
    setAllTargets(targets)
    setTotalMeasures(service.getMeasureCount())
    setOsmdReady(true)
  }, [])

  // ── Practice mode change ─────────────────────────────────────────────
  const handleModeChange = useCallback((mode: PracticeMode) => {
    reset()
    setPracticeMode(mode)
  }, [reset])

  // ── Practice style change ────────────────────────────────────────────
  const handleStyleChange = useCallback((style: PracticeStyle) => {
    // Stop playback if switching away from listen
    if (practiceStyle === 'listen') {
      playback.stop()
    }
    // Stop follow clock if switching away from follow
    if (practiceStyle === 'follow') {
      setFollowRunning(false)
      setFollowPosition(initPositionState())
    }
    reset()
    setAudioLoading(false)
    setAudioReady(false)
    // Set default speed for the new style
    if (style === 'follow') {
      setSpeedMultiplier(0.5)
    } else if (style === 'listen') {
      setSpeedMultiplier(1.0)
    }
    setPracticeStyle(style)
  }, [reset, practiceStyle, playback])

  // ── Loop behavior: free mode ──────────────────────────────────────────
  useEffect(() => {
    if (practiceStyle === 'free' && isComplete && repeatOn && totalNotes > 0) {
      reset()
    }
  }, [practiceStyle, isComplete, repeatOn, totalNotes, reset])

  // ── Loop behavior: follow mode ────────────────────────────────────────
  useEffect(() => {
    if (practiceStyle === 'follow' && followRunning && repeatOn) {
      const isAtEnd = followPosition.targetIndex >= rangeFilteredTargets.length
      if (isAtEnd && rangeFilteredTargets.length > 0) {
        // Reset position and scoring, keep running
        reset()
        setFollowPosition(initPositionState())
        prevFollowIndexRef.current = 0
      }
    }
  }, [practiceStyle, followRunning, followPosition.targetIndex, repeatOn, rangeFilteredTargets.length, reset])

  // ── Session recording ────────────────────────────────────────────────
  const reportedRef = useRef(false)
  useEffect(() => {
    if (isFinished && scoreId && !reportedRef.current) {
      reportedRef.current = true
      const now = Date.now()
      void recordSession(scoreId, {
        startedAt: now - Math.round(summary.pitchAccuracy * 0),
        endedAt: now,
        pitchAccuracy: summary.pitchAccuracy,
        rhythmAccuracy: 1,
        durationSec: 0,
        practiceMode,
      }).catch(() => {
        // Report failure does not block the UI.
      })
    }
    if (!isFinished) reportedRef.current = false
  }, [isFinished, scoreId, practiceMode, summary])

  // ── MIDI noteOn → scoring engine (free and follow modes) ────────────
  useEffect(() => {
    if (practiceStyle === 'listen') return
    const ev = midi.lastNoteEvent
    if (ev?.type === 'noteOn') {
      handleNoteOn(ev.pitch)
    }
  }, [midi.lastNoteEvent, handleNoteOn, practiceStyle])

  // ── MIDI noteOff → scoring engine (free and follow modes) ───────────
  useEffect(() => {
    if (practiceStyle === 'listen') return
    const ev = midi.lastNoteEvent
    if (ev?.type === 'noteOff') {
      handleNoteOff(ev.pitch)
    }
  }, [midi.lastNoteEvent, handleNoteOff, practiceStyle])

  // ── Keyboard range ───────────────────────────────────────────────────
  const keyboardRange = useMemo(() => {
    const all = rangeFilteredTargets.flatMap((t) => t.midiNotes)
    if (all.length === 0) return { low: 60, high: 72 }
    const low = Math.floor(Math.min(...all) / 12) * 12
    let high = Math.ceil((Math.max(...all) + 1) / 12) * 12 - 1
    if (high - low < 12) high = low + 12
    return { low, high }
  }, [rangeFilteredTargets])

  const highlightNotes = useMemo(
    () => rangeFilteredTargets[targetIndex]?.midiNotes ?? [],
    [rangeFilteredTargets, targetIndex],
  )

  // All MIDI notes across the entire score, for wrong-note detection.
  const allTargetMidiSet = useMemo(() => {
    const s = new Set<number>()
    for (const t of allTargets) {
      for (const n of t.midiNotes) {
        s.add(n)
      }
    }
    return s
  }, [allTargets])

  // ── Loading state ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Loading score...</CardContent>
      </Card>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────
  if (error || !score) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Score Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {error ?? 'The requested score could not be found. It may have been removed or the link is invalid.'}
            </AlertDescription>
          </Alert>
          <Button className="mt-4" asChild>
            <Link to="/library">Back to Library</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Finished state ───────────────────────────────────────────────────
  if (isFinished) {
    const totalAttempted = correct + wrong
    const accuracy = totalAttempted > 0 ? Math.round((correct / totalAttempted) * 100) : 0

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, type: 'spring', damping: 20 }}
      >
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Practice Complete!</CardTitle>
            <CardDescription>{score.title}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-center gap-8 py-4">
              <motion.div
                className="text-center"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 300 }}
              >
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                <p className="text-2xl font-bold mt-1">{correct}</p>
                <p className="text-sm text-muted-foreground">Correct</p>
              </motion.div>
              <motion.div
                className="text-center"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, type: 'spring', stiffness: 300 }}
              >
                <XCircle className="h-8 w-8 text-red-500 mx-auto" />
                <p className="text-2xl font-bold mt-1">{wrong}</p>
                <p className="text-sm text-muted-foreground">Wrong</p>
              </motion.div>
              <motion.div
                className="text-center"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6, type: 'spring', stiffness: 200 }}
              >
                <p className="text-3xl font-bold">{accuracy}%</p>
                <p className="text-sm text-muted-foreground">Accuracy</p>
              </motion.div>
            </div>
            <Progress value={correct > 0 ? 100 : 0} />
          </CardContent>
          <CardFooter className="flex gap-2 justify-center">
            <Button onClick={reset} variant="outline">
              <RotateCcw className="h-4 w-4" />
              Play Again
            </Button>
            <Button asChild variant="ghost">
              <Link to="/library">Back to Library</Link>
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    )
  }

  // ── Playing / ready state ────────────────────────────────────────────
  const isPlaying = osmdReady && targetIndex < totalNotes
  const showPlaybackCursor = (practiceStyle === 'listen' && isListenPlaying) || isFollowRunning

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{score.title}</CardTitle>
              {score.composer && <CardDescription>{score.composer}</CardDescription>}
            </div>
            <Badge variant="secondary">{speedMultiplier.toFixed(1)}x ({effectiveTempo} BPM)</Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Practice style selector */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Style:</span>
            <Button
              size="sm"
              variant={practiceStyle === 'free' ? 'default' : 'outline'}
              disabled={isPlaying && practiceStyle !== 'free'}
              onClick={() => handleStyleChange('free')}
            >
              <Play className="h-3 w-3 mr-1" />
              Free
            </Button>
            <Button
              size="sm"
              variant={practiceStyle === 'listen' ? 'default' : 'outline'}
              disabled={isListenPlaying || isFollowRunning}
              onClick={() => handleStyleChange('listen')}
            >
              <Headphones className="h-3 w-3 mr-1" />
              Listen
            </Button>
            <Button
              size="sm"
              variant={practiceStyle === 'follow' ? 'default' : 'outline'}
              disabled={isListenPlaying || isFollowRunning}
              onClick={() => handleStyleChange('follow')}
            >
              <Users className="h-3 w-3 mr-1" />
              Follow
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Score counters (free mode only) */}
      {practiceStyle === 'free' && (
        <AnimatePresence>
          {isPlaying && (
            <motion.div
              className="flex items-center gap-3"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                key={`correct-${correct}`}
                variants={badgePop}
                initial="initial"
                animate="pulse"
              >
                <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {correct}
                </Badge>
              </motion.div>
              <motion.div
                key={`wrong-${wrong}`}
                variants={badgePop}
                initial="initial"
                animate="pulse"
              >
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  {wrong}
                </Badge>
              </motion.div>
              <Badge variant="secondary">
                {targetIndex + 1} / {totalNotes}
              </Badge>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Audio loading indicator */}
      {practiceStyle === 'listen' && audioLoading && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <Headphones className="h-4 w-4 animate-pulse" />
              <span className="text-sm text-muted-foreground">Loading piano samples...</span>
              <Progress value={audioReady ? 100 : 50} className="flex-1" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Listen mode: position indicator */}
      {practiceStyle === 'listen' && isListenPlaying && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary">
            {targetIndex + 1} / {totalNotes}
          </Badge>
          <Progress value={(targetIndex / totalNotes) * 100} className="flex-1" />
        </div>
      )}

      {/* Follow mode: position indicator + stats */}
      {practiceStyle === 'follow' && isFollowRunning && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {targetIndex + 1} / {totalNotes}
            </Badge>
            <Progress value={(targetIndex / totalNotes) * 100} className="flex-1" />
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="default" className="bg-green-600 hover:bg-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {scoringState.notesHit}
            </Badge>
            <Badge variant="destructive">
              <XCircle className="h-3 w-3 mr-1" />
              {scoringState.missed}
            </Badge>
          </div>
        </div>
      )}

      {/* Practice mode selector (hand mode) */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Practice Mode:</span>
            <Button
              size="sm"
              variant={practiceMode === 'right' ? 'default' : 'outline'}
              disabled={isPlaying || isListenPlaying || isFollowRunning}
              onClick={() => handleModeChange('right')}
            >
              Right Hand
            </Button>
            <Button
              size="sm"
              variant={practiceMode === 'left' ? 'default' : 'outline'}
              disabled={isPlaying || isListenPlaying || isFollowRunning}
              onClick={() => handleModeChange('left')}
            >
              Left Hand
            </Button>
            <Button
              size="sm"
              variant={practiceMode === 'both' ? 'default' : 'outline'}
              disabled={isPlaying || isListenPlaying || isFollowRunning}
              onClick={() => handleModeChange('both')}
            >
              Both Hands
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Measure range selector + repeat toggle */}
      {totalMeasures > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">Measures:</span>
              <div className="flex items-center gap-2">
                <Select
                  value={measureRange ? String(measureRange.start) : 'all'}
                  onValueChange={(val) => {
                    if (val === 'all') {
                      setMeasureRange(null)
                    } else {
                      const start = Number(val)
                      setMeasureRange((prev) =>
                        prev
                          ? { ...prev, start }
                          : { start, end: totalMeasures },
                      )
                    }
                  }}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {Array.from({ length: totalMeasures }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        Measure {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">to</span>
                <Select
                  value={measureRange ? String(measureRange.end) : 'all'}
                  onValueChange={(val) => {
                    if (val === 'all') {
                      setMeasureRange(null)
                    } else {
                      const end = Number(val)
                      setMeasureRange((prev) =>
                        prev
                          ? { ...prev, end }
                          : { start: 1, end },
                      )
                    }
                  }}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {Array.from({ length: totalMeasures }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        Measure {i + 1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {measureRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMeasureRange(null)
                  }}
                >
                  Clear
                </Button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Switch
                  id="repeat-toggle"
                  checked={repeatOn}
                  onCheckedChange={setRepeatOn}
                />
                <Label htmlFor="repeat-toggle" className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1">
                  <Repeat className="h-3 w-3" />
                  Repeat
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Speed control (listen/follow modes) */}
      {practiceStyle !== 'free' && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Speed:</span>
              <Slider
                value={[speedMultiplier]}
                onValueChange={([v]) => setSpeedMultiplier(v)}
                min={0.3}
                max={1.8}
                step={0.1}
                className="flex-1"
                disabled={isListenPlaying || isFollowRunning}
              />
              <span className="text-sm font-mono w-20 text-right">
                {speedMultiplier.toFixed(1)}x ({effectiveTempo} BPM)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* OSMD score rendering */}
      <Card>
        <CardContent className="pt-6">
          <OsmdScore
            xml={score.sourceXml}
            currentTargetIndex={currentGlobalIndex}
            filteredTargetIndices={filteredTargetIndices}
            completedTargets={completedTargets}
            showCursor={showPlaybackCursor}
            onReady={handleOsmdReady}
          />
        </CardContent>
      </Card>

      {/* MIDI status + Virtual Keyboard (free and follow modes) */}
      {(practiceStyle === 'free' || practiceStyle === 'follow') && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Music className="h-4 w-4" />
                {!midi.isSupported
                  ? 'Web MIDI not supported - use the on-screen keyboard below'
                  : midi.isConnected
                    ? `Connected: ${midi.selectedDevice?.name || 'MIDI device'}`
                    : 'No MIDI keyboard connected - use the on-screen keyboard below'}
              </span>
              {midi.isSupported && !midi.isConnected && midi.devices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {midi.devices.map((device) => (
                    <Button key={device.id} onClick={() => midi.connect(device)} size="sm" variant="outline">
                      Connect {device.name || 'device'}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <VirtualKeyboard
              lowMidi={keyboardRange.low}
              highMidi={keyboardRange.high}
              onNoteOn={(midiNote) => handleNoteOn(midiNote)}
              highlight={isPlaying ? highlightNotes : []}
              heldNotes={scoringState.heldNotes}
              targetMidiSet={allTargetMidiSet}
              activeHand={practiceMode}
            />
          </CardContent>
        </Card>
      )}

      {/* Progress bar (free mode) */}
      {practiceStyle === 'free' && (
        <AnimatePresence>
          {isPlaying && totalNotes > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Progress value={(targetIndex / totalNotes) * 100} />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Feedback flash (free mode) */}
      {practiceStyle === 'free' && (
        <AnimatePresence mode="wait">
          {isPlaying && targetIndex > 0 && (
            <motion.div
              key={`fb-${targetIndex}`}
              variants={targetIndex > 0 && rangeFilteredTargets[targetIndex - 1]
                ? (rangeFilteredTargets[targetIndex - 1].midiNotes.length > 0 ? feedbackVariants.correct : feedbackVariants.wrong)
                : feedbackVariants.correct}
              initial="initial"
              animate="animate"
              exit="exit"
              className="text-center py-3 px-4 rounded-lg text-sm font-medium bg-blue-50 text-blue-800"
            >
              Note {targetIndex} of {totalNotes}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <Separator />

      {/* Controls */}
      <div className="flex items-center gap-3">
        {practiceStyle === 'listen' ? (
          // Listen mode: Play/Stop controls
          <AnimatePresence mode="wait">
            {!isListenPlaying && osmdReady ? (
              <motion.div
                key="listen-start"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button size="lg" onClick={handleListenPlay} disabled={audioLoading}>
                  <Headphones className="h-5 w-5" />
                  {audioLoading ? 'Loading Piano...' : 'Listen'}
                </Button>
              </motion.div>
            ) : isListenPlaying ? (
              <motion.div
                key="listen-stop"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button size="lg" variant="destructive" onClick={playback.stop}>
                  <Square className="h-5 w-5" />
                  Stop
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        ) : practiceStyle === 'follow' ? (
          // Follow mode: Play/Stop controls
          <AnimatePresence mode="wait">
            {!isFollowRunning && osmdReady ? (
              <motion.div
                key="follow-start"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button size="lg" onClick={() => {
                  reset()
                  setFollowPosition(initPositionState())
                  prevFollowIndexRef.current = 0
                  setFollowRunning(true)
                }}>
                  <Users className="h-5 w-5" />
                  Start Follow
                </Button>
              </motion.div>
            ) : isFollowRunning ? (
              <motion.div
                key="follow-stop"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button size="lg" variant="destructive" onClick={() => {
                  setFollowRunning(false)
                  // Settle any remaining targets up to current position
                  for (let i = prevFollowIndexRef.current; i < followPosition.targetIndex; i++) {
                    const target = rangeFilteredTargetsRef.current[i]
                    if (target) {
                      settleTargetCbRef.current(target)
                    }
                  }
                  prevFollowIndexRef.current = followPosition.targetIndex
                }}>
                  <Square className="h-5 w-5" />
                  Stop
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        ) : (
          // Free mode: existing controls
          <AnimatePresence mode="wait">
            {!isPlaying && osmdReady ? (
              <motion.div
                key="start"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button size="lg" onClick={() => { /* practice starts on first note */ }}>
                  <Play className="h-5 w-5" />
                  Ready - Play First Note
                </Button>
              </motion.div>
            ) : isPlaying ? (
              <motion.div
                key="stop"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Button onClick={reset} variant="outline" size="lg">
                  <Square className="h-5 w-5" />
                  Reset
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        )}
        <Button onClick={reset} variant="ghost" size="icon" title="Reset">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {practiceStyle === 'free' && !isPlaying && (
        <motion.p
          className="text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {totalNotes} note{totalNotes !== 1 ? 's' : ''} &middot; Press a key to begin practicing
        </motion.p>
      )}
      {practiceStyle === 'follow' && !isFollowRunning && osmdReady && (
        <motion.p
          className="text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {totalNotes} note{totalNotes !== 1 ? 's' : ''} &middot; Press Start to begin follow mode at {effectiveTempo} BPM
        </motion.p>
      )}
    </div>
  )
}
