# Architecture Review Action Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the architecture review from `D:\tmp\architecture-review-20260625-140542.html` into scoped, testable changes that reduce duplicate ownership, stale modules, leaky interfaces, and contract drift in PianoScore.

**Architecture:** Apply the review selectively. Prefer small, locally testable deepening steps before large module rewrites: delete dead code first, fix wire-contract drift, then move duplicated behaviour behind narrower interfaces. Keep React lifecycle in hooks/components and keep pure timing/scoring logic in `app/src/scoring/`.

**Tech Stack:** React 19, Vite 7, TypeScript with `verbatimModuleSyntax`, Vitest, Hono, Drizzle ORM, SQLite, OSMD, Web MIDI, Web Audio.

## Global Constraints

- `app/` is the active frontend; `src/` is legacy reference only.
- Type-only imports must use `import type { ... }`.
- `app/` has `erasableSyntaxOnly`; do not use constructor parameter properties.
- Frontend API calls stay in `app/src/lib/api.ts`.
- Server persistence logic stays behind `server/src/db/repo.ts` or a focused repo module.
- Targets are runtime-derived from MusicXML via OSMD; do not add a `score_notes` table.
- Use existing tests as the safety net; add tests at the module interface for every behaviour change.

---

## Review Verdict

The HTML review is credible. The claims for candidates 1-6 were checked against the codebase and mostly hold. The implementation should be narrower than the report suggests in a few places:

- Candidate 1, Position ownership: accept the direction, but start with a small tempo-position hook/helper instead of a broad `PositionDriver` abstraction.
- Candidate 2, dead `timeline.ts`: accept directly. It is production-dead and documented as live code in `CODEBASE_SUMMARY.md`.
- Candidate 3, `OsmdService` deepening: accept, but keep React lifecycle outside the service. Move score-view coloring policy into a single service method.
- Candidate 4, `AudioOutput` clock contract: accept as a contract-risk fix first. Add tests and clarify the scheduling interface before redesigning around beats.
- Candidate 5, repo and wire contract: accept in small steps. Add `getScoreSummary(id)` and align `practiceMode` types before creating a shared package.
- Candidate 6, `useMIDI` split: accept after deciding whether MIDI output is a real feature. Current output selection is effectively unreachable because no UI calls `connectOutput`.

## File Structure

- Delete: `app/src/scoring/timeline.ts`
- Delete: `app/src/scoring/timeline.test.ts`
- Modify: `CODEBASE_SUMMARY.md`
- Modify: `server/src/db/repo.ts`
- Modify: `server/src/routes/import.ts`
- Modify: `app/src/lib/api.ts`
- Modify: `app/src/services/audio.ts`
- Modify: `app/src/services/__tests__/audio.test.ts`
- Create: `app/src/hooks/useTempoPosition.ts`
- Create: `app/src/hooks/__tests__/useTempoPosition.test.ts`
- Modify: `app/src/pages/PracticePage.tsx`
- Modify: `app/src/hooks/usePlayback.ts`
- Modify: `app/src/services/osmd.ts`
- Modify: `app/src/components/OsmdScore.tsx`
- Modify: `app/src/hooks/useMIDI.ts`
- Optional create: `app/src/hooks/useMidiInput.ts`
- Optional create: `app/src/hooks/useMidiOutput.ts`

## Priority Order

1. Remove dead timeline module and stale docs.
2. Fix repo/API contract drift.
3. Clarify audio scheduling contract with tests.
4. Extract follow/listen tempo-position behaviour out of `PracticePage`.
5. Move OSMD coloring policy into `OsmdService`.
6. Resolve the `useMIDI` input/output split.

### Task 1: Remove Dead Timeline Module

**Files:**
- Delete: `app/src/scoring/timeline.ts`
- Delete: `app/src/scoring/timeline.test.ts`
- Modify: `CODEBASE_SUMMARY.md`

**Interfaces:**
- Consumes: `buildTargetTimeline(targets: ScoringTarget[]): TargetTimeline` from `app/src/scoring/position.ts`
- Produces: one live timeline concept, owned by `position.ts`

- [ ] **Step 1: Verify the module is production-dead**

Run:

```bash
cd app && rg "buildTimeline|scoring/timeline|from './timeline'|from '@/scoring/timeline'" src
```

Expected: only `src/scoring/timeline.ts`, `src/scoring/timeline.test.ts`, and documentation references appear.

- [ ] **Step 2: Delete the dead files**

Remove:

```text
app/src/scoring/timeline.ts
app/src/scoring/timeline.test.ts
```

- [ ] **Step 3: Update documentation**

In `CODEBASE_SUMMARY.md`, remove the `timeline.ts` file entry and `timeline.test.ts` count. Replace the "时间线预计算 (timeline.ts)" section with a short note that timeline construction now lives in `app/src/scoring/position.ts` as `buildTargetTimeline`.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
cd app && npx vitest run src/scoring/position.test.ts src/scoring/__tests__/playbackSchedule.test.ts src/services/__tests__/realvalue-units.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: TypeScript and Vite build complete without references to `timeline.ts`.

### Task 2: Fix Repo and API Contract Drift

**Files:**
- Modify: `server/src/db/repo.ts`
- Modify: `server/src/routes/import.ts`
- Modify: `app/src/lib/api.ts`
- Test: `server/src/routes/__tests__/scores.test.ts`
- Test: `server/src/routes/__tests__/sessions.test.ts`

**Interfaces:**
- Produces: `getScoreSummary(db: Db, id: string): ScoreSummary | null`
- Produces: `type PracticeMode = 'right' | 'left' | 'both'` in `app/src/lib/api.ts`
- Produces: `SessionRecord.practiceMode: PracticeMode`

- [ ] **Step 1: Add a server test for import summary lookup**

In `server/src/routes/__tests__/scores.test.ts`, add:

```ts
it('import returns the created score summary without sourceXml', async () => {
  const formData = new FormData()
  formData.append('file', new File([TEST_MUSICXML], 'test.xml', { type: 'application/xml' }))

  const res = await test.app.request('/api/import', {
    method: 'POST',
    body: formData,
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as Record<string, unknown>
  expect(body.id).toEqual(expect.any(String))
  expect(body.title).toBe('Integration Test')
  expect(body.sourceFormat).toBe('musicxml')
  expect(body).not.toHaveProperty('sourceXml')
})
```

- [ ] **Step 2: Run the focused server route tests**

Run:

```bash
cd server && npm test -- src/routes/__tests__/scores.test.ts
```

Expected: test passes before implementation, confirming current behaviour while leaving room to change the repo path.

- [ ] **Step 3: Add `getScoreSummary` to `server/src/db/repo.ts`**

Add:

```ts
export function getScoreSummary(db: Db, id: string): ScoreSummary | null {
  const s = db.select().from(scores).where(eq(scores.id, id)).get()
  if (!s) return null
  return {
    id: s.id,
    title: s.title,
    composer: s.composer,
    tempo: s.tempo,
    sourceFormat: s.sourceFormat,
  }
}
```

- [ ] **Step 4: Replace the import route full-list lookup**

In `server/src/routes/import.ts`, change the repo import to:

```ts
import { getScoreSummary, insertScore } from '../db/repo.js'
```

Replace:

```ts
const summary = listScores(db).find((s) => s.id === id)
return c.json(summary, 201)
```

with:

```ts
const summary = getScoreSummary(db, id)
return c.json(summary, 201)
```

- [ ] **Step 5: Align frontend session types**

In `app/src/lib/api.ts`, add:

```ts
export type PracticeMode = 'right' | 'left' | 'both'
```

Add to `SessionRecord`:

```ts
practiceMode: PracticeMode
```

Change `NewSession.practiceMode` to:

```ts
practiceMode: PracticeMode
```

- [ ] **Step 6: Run server and frontend type checks**

Run:

```bash
cd server && npm run typecheck && npm test -- src/routes/__tests__/scores.test.ts src/routes/__tests__/sessions.test.ts
cd ../app && npm run build
```

Expected: server typecheck passes, selected server tests pass, app build passes.

### Task 3: Clarify AudioOutput Scheduling Contract

**Files:**
- Modify: `app/src/services/audio.ts`
- Modify: `app/src/services/__tests__/audio.test.ts`
- Optional modify: `app/src/hooks/usePlayback.ts`

**Interfaces:**
- Consumes: `AudioOutput.noteOn(midi, velocity, timeSec)` and `AudioOutput.noteOff(midi, timeSec)`
- Produces: a documented contract where `timeSec` is in the same seconds domain returned by the same adapter's `now()`

- [ ] **Step 1: Add contract tests for adapter time domains**

In `app/src/services/__tests__/audio.test.ts`, add tests under the `MidiOutput` block:

```ts
it('schedules MIDI timestamps from the same seconds domain as now()', () => {
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  midiOut.noteOn(60, 127, midiOut.now() + 0.5)

  const [, timestamp] = mockOutput.send.mock.calls.at(-1)!
  expect(timestamp).toBeCloseTo(1500, 0)
})

it('clamps stale MIDI scheduled times to current performance time', () => {
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  midiOut.noteOff(60, midiOut.now() - 0.5)

  const [, timestamp] = mockOutput.send.mock.calls.at(-1)!
  expect(timestamp).toBe(1000)
})
```

- [ ] **Step 2: Run the audio tests and confirm the time-origin bug**

Run:

```bash
cd app && npx vitest run src/services/__tests__/audio.test.ts
```

Expected before fix: the new MIDI timestamp test fails because `toTimestamp()` adds `performance.timeOrigin`.

- [ ] **Step 3: Fix `MidiOutput.toTimestamp`**

In `app/src/services/audio.ts`, replace:

```ts
return Math.max(timeSec * 1000 + performance.timeOrigin, performance.now())
```

with:

```ts
return Math.max(timeSec * 1000, performance.now())
```

- [ ] **Step 4: Update AudioOutput documentation**

In `app/src/services/audio.ts`, update the interface comments so `timeSec` is described as:

```text
Absolute time in the adapter's own seconds domain. Callers must derive this
from the same adapter's now() method.
```

- [ ] **Step 5: Run audio and playback tests**

Run:

```bash
cd app && npx vitest run src/services/__tests__/audio.test.ts src/hooks/__tests__/usePlayback.test.ts src/hooks/__tests__/listen-mode.test.ts
```

Expected: all selected tests pass.

### Task 4: Extract Tempo Position Handling from PracticePage

**Files:**
- Create: `app/src/hooks/useTempoPosition.ts`
- Create: `app/src/hooks/__tests__/useTempoPosition.test.ts`
- Modify: `app/src/pages/PracticePage.tsx`
- Modify: `app/src/hooks/usePlayback.ts`

**Interfaces:**
- Produces: `useTempoPosition(options): UseTempoPositionResult`
- Consumes: `buildTargetTimeline`, `tempoTick`, `useClock`
- Keeps: free-mode advancement inside `usePractice`

- [ ] **Step 1: Write a failing hook test for passed-target settlement**

Create `app/src/hooks/__tests__/useTempoPosition.test.ts` with:

```ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTempoPosition } from '../useTempoPosition'
import type { ScoringTarget } from '@/types/music'

const targets: ScoringTarget[] = [
  { index: 0, midiNotes: [60], hands: ['right'], durationBeats: 1 },
  { index: 1, midiNotes: [62], hands: ['right'], durationBeats: 1 },
  { index: 2, midiNotes: [64], hands: ['right'], durationBeats: 1 },
]

describe('useTempoPosition', () => {
  it('settles every target crossed by a tempo tick', () => {
    const onSettleTarget = vi.fn()
    const { result } = renderHook(() =>
      useTempoPosition({
        targets,
        tempo: 120,
        running: true,
        onSettleTarget,
      }),
    )

    act(() => {
      result.current.tick(1100)
    })

    expect(result.current.position.targetIndex).toBe(2)
    expect(onSettleTarget).toHaveBeenCalledWith(targets[0])
    expect(onSettleTarget).toHaveBeenCalledWith(targets[1])
  })
})
```

- [ ] **Step 2: Run the new hook test and confirm it fails**

Run:

```bash
cd app && npx vitest run src/hooks/__tests__/useTempoPosition.test.ts
```

Expected: fail because `useTempoPosition` does not exist.

- [ ] **Step 3: Implement `useTempoPosition`**

Create `app/src/hooks/useTempoPosition.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ScoringTarget } from '@/types/music'
import { buildTargetTimeline, initPositionState, tempoTick, type PositionState } from '@/scoring/position'
import { useClock } from './useClock'

interface UseTempoPositionOptions {
  targets: ScoringTarget[]
  tempo: number
  running: boolean
  onSettleTarget?: (target: ScoringTarget) => void
  onComplete?: () => void
}

interface UseTempoPositionResult {
  position: PositionState
  reset: () => void
  tick: (elapsedMs: number) => void
}

export function useTempoPosition(options: UseTempoPositionOptions): UseTempoPositionResult {
  const { targets, tempo, running, onSettleTarget, onComplete } = options
  const [position, setPosition] = useState<PositionState>(initPositionState)
  const timeline = useMemo(() => buildTargetTimeline(targets), [targets])
  const targetsRef = useRef(targets)
  const onSettleTargetRef = useRef(onSettleTarget)
  const onCompleteRef = useRef(onComplete)
  const completedRef = useRef(false)

  targetsRef.current = targets
  onSettleTargetRef.current = onSettleTarget
  onCompleteRef.current = onComplete

  const tick = useCallback((elapsedMs: number) => {
    setPosition((prev) => {
      const next = tempoTick(prev, timeline, tempo, elapsedMs)
      if (next.targetIndex !== prev.targetIndex) {
        for (let i = prev.targetIndex; i < next.targetIndex; i++) {
          const target = targetsRef.current[i]
          if (target) onSettleTargetRef.current?.(target)
        }
      }
      if (next.targetIndex >= targetsRef.current.length && !completedRef.current) {
        completedRef.current = true
        onCompleteRef.current?.()
      }
      return next
    })
  }, [timeline, tempo])

  useClock({ tempo, running, onTick: tick })

  const reset = useCallback(() => {
    completedRef.current = false
    setPosition(initPositionState())
  }, [])

  return { position, reset, tick }
}
```

- [ ] **Step 4: Replace follow-mode position code in `PracticePage.tsx`**

Remove page-owned `followTimeline`, `onFollowTick`, `useClock`, `prevFollowIndexRef`, and manual stop settlement. Use:

```ts
const follow = useTempoPosition({
  targets: rangeFilteredTargets,
  tempo: effectiveTempo,
  running: practiceStyle === 'follow' && followRunning,
  onSettleTarget: settleTargetCb,
})
```

Use `follow.position` where the page currently uses `followPosition`, and call `follow.reset()` where the page resets follow state.

- [ ] **Step 5: Keep listen mode unchanged until follow extraction passes**

Do not change `usePlayback` in this task beyond import cleanup. Listen mode has additional audio scheduling and should be deepened after follow mode is stable.

- [ ] **Step 6: Run hook tests and build**

Run:

```bash
cd app && npx vitest run src/hooks/__tests__/useTempoPosition.test.ts src/hooks/__tests__/usePractice.test.ts src/hooks/__tests__/usePlayback.test.ts src/hooks/__tests__/listen-mode.test.ts
cd app && npm run build
```

Expected: selected tests pass and the app builds.

### Task 5: Move OSMD Practice View Coloring Into OsmdService

**Files:**
- Modify: `app/src/services/osmd.ts`
- Modify: `app/src/components/OsmdScore.tsx`

**Interfaces:**
- Produces: `OsmdService.applyPracticeViewState(state: PracticeViewState): void`
- Keeps: React effects and lifecycle in `OsmdScore`
- Removes: caller loops over every target for color policy

- [ ] **Step 1: Add the service-facing state type**

In `app/src/services/osmd.ts`, add:

```ts
type TargetVisualResult = 'correct' | 'wrong' | 'missed'

interface PracticeViewState {
  currentTargetIndex: number
  completedTargets: Map<number, TargetVisualResult>
  filteredTargetIndices: Set<number>
}
```

- [ ] **Step 2: Add the policy method**

In `OsmdService`, add:

```ts
applyPracticeViewState(state: PracticeViewState): void {
  const colors = {
    future: '#000000',
    current: '#3b82f6',
    correct: '#22c55e',
    wrong: '#ef4444',
    missed: '#9ca3af',
    reference: '#cccccc',
  } as const

  this.resetAllColors()

  for (let i = 0; i < this.entries.length; i++) {
    const completed = state.completedTargets.get(i)
    if (completed) {
      this.colorPosition(i, colors[completed])
    } else if (i === state.currentTargetIndex) {
      this.colorPosition(i, colors.current)
    }
  }

  if (state.filteredTargetIndices.size > 0) {
    for (let i = 0; i < this.entries.length; i++) {
      if (!state.filteredTargetIndices.has(i)) {
        this.colorPosition(i, colors.reference)
      }
    }
  }
}
```

- [ ] **Step 3: Replace `OsmdScore` coloring effects**

In `app/src/components/OsmdScore.tsx`, replace the separate completed/current and filtered-target effects with:

```ts
useEffect(() => {
  const svc = serviceRef.current
  if (!svc || svc.getTotalTargets() === 0) return

  svc.applyPracticeViewState({
    currentTargetIndex,
    completedTargets,
    filteredTargetIndices,
  })
}, [currentTargetIndex, completedTargets, filteredTargetIndices])
```

Remove the local `COLORS` constant once no longer used.

- [ ] **Step 4: Keep cursor control separate**

Leave `showCursor`, `hideCursor`, `setCursorPosition`, and scroll behaviour in the existing cursor effects. The service should own DOM mechanics, while the component owns React effect timing.

- [ ] **Step 5: Run frontend tests and build**

Run:

```bash
cd app && npx vitest run src/services/extractTargets.test.ts src/services/__tests__/extractTargets.test.ts
cd app && npm run build
```

Expected: tests and build pass.

### Task 6: Resolve `useMIDI` Input and Output Ownership

**Files:**
- Modify: `app/src/hooks/useMIDI.ts`
- Modify: `app/src/pages/PracticePage.tsx`
- Modify: `app/src/pages/SettingsPage.tsx`
- Optional create: `app/src/hooks/useMidiInput.ts`
- Optional create: `app/src/hooks/useMidiOutput.ts`

**Interfaces:**
- Produces one of two outcomes:
  - output removed from `useMIDI` until there is UI to select it, or
  - split hooks: `useMidiInput()` and `useMidiOutput()`

- [ ] **Step 1: Confirm output is unreachable**

Run:

```bash
cd app && rg "connectOutput|sendNoteOn|sendNoteOff|selectedOutput|outputs" src
```

Expected: `connectOutput`, `sendNoteOn`, and `sendNoteOff` appear only in `useMIDI.ts`; `selectedOutput` is read by `PracticePage.tsx` but no page connects an output.

- [ ] **Step 2: Choose the MVP-preserving path**

Use the conservative path for now: remove output sending methods from `useMIDI`, but keep `MidiOutput` in `app/src/services/audio.ts` for later direct use.

- [ ] **Step 3: Narrow `UseMIDIResult`**

In `app/src/hooks/useMIDI.ts`, remove these fields:

```ts
outputs: MIDIOutput[]
selectedOutput: MIDIOutput | null
connectOutput: (output: MIDIOutput) => void
sendNoteOn: (midi: number, velocity?: number) => void
sendNoteOff: (midi: number) => void
```

Remove output state, output enumeration, `connectOutput`, `sendNoteOn`, and `sendNoteOff`.

- [ ] **Step 4: Remove unreachable output branch from `PracticePage.tsx`**

Remove the `MidiOutput` import and replace `getAudioOutput` with a Tone/WebAudio-only selector:

```ts
const getAudioOutput = useCallback((): AudioOutput | null => {
  if (toneRef.current?.isLoaded) {
    return toneRef.current
  }
  if (!synthRef.current) {
    synthRef.current = new WebAudioSynth()
  }
  return synthRef.current
}, [])
```

Change `ensureToneJs` dependencies to:

```ts
}, [getAudioOutput])
```

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd app && npm run build
```

Expected: no TypeScript references remain to removed `useMIDI` output fields.

## Verification Bundle

After all tasks are complete, run:

```bash
cd app && npm run build && npx vitest run
cd ../server && npm run typecheck && npm test
```

Expected: frontend build passes, all frontend Vitest tests pass, server typecheck passes, and all server tests pass.

## Deferred Decisions

- A full `PositionDriver` with event-driven, cursor-only, and audio adapters should wait until `useTempoPosition` has absorbed follow-mode duplication and tests show the remaining listen-mode duplication clearly.
- A shared frontend/server type package should wait until there is a second wire-contract drift beyond `practiceMode`; for now, keep `app/src/lib/api.ts` and `server/src/db/repo.ts` aligned with tests.
- MIDI output UI can be reintroduced as `useMidiOutput()` when the product has a visible output-device selector and tests for selected output playback.

## Self-Review

- Spec coverage: all six review candidates have a task or an explicit deferred decision.
- Placeholder scan: the plan contains no `TBD`, `TODO`, "implement later", or unspecified test steps.
- Type consistency: `PracticeMode`, `SessionRecord.practiceMode`, `getScoreSummary`, and `useTempoPosition` signatures are used consistently across tasks.
