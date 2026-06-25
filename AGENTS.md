# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

> **📖 完整代码库文档**: 参见 [CODEBASE_SUMMARY.md](./CODEBASE_SUMMARY.md) — 包含架构图解、数据流、API 端点、组件层次、数据库 Schema、测试覆盖等完整信息。

## Commands

```bash
# Frontend (app/)
cd app && npm run dev          # Vite dev server on :5173
cd app && npm run build        # tsc -b + Vite production build
cd app && npm run lint         # ESLint
cd app && npx vitest run       # All frontend tests (unit + hook + service)
cd app && npx vitest           # Watch mode
cd app && npx vitest run src/scoring/engine.test.ts  # Single test file

# Backend (server/)
cd server && npm run dev       # tsx watch on :8000
cd server && npm run typecheck # tsc --noEmit
cd server && npm test          # vitest run (parser + integration tests)
cd server && npm run test:watch

# E2E (Playwright) — start servers first
cd server && npm run dev &
cd app && npm run dev &
npx playwright test            # Requires both servers running on :8000 and :5173

# Desktop (Tauri v1) — requires Rust + system deps
npm run tauri-dev              # Tauri dev (uses app/ directory)
npm run tauri-build            # Production build

# Full verification
cd app && npm run build && npx vitest run && cd ../server && npm run typecheck && npm test
```

Frontend proxies `/api` → `http://localhost:8000` (Vite dev server config).

## Quick Start

```bash
cd app && npm install      # Frontend deps (includes OSMD, @testing-library/react, jsdom)
cd server && npm install   # Backend deps (includes better-sqlite3 native addon)
# Start both: cd server && npm run dev & cd app && npm run dev
```

## Architecture Overview

### Two frontends

| Directory | Status | Stack |
|-----------|--------|-------|
| `app/` | **Active** | React 19, Vite 7, OSMD, shadcn/ui, Radix UI, Tailwind CSS, framer-motion |
| `src/` | Legacy (reference only) | React 18, Zustand, React Query |

### Backend: TypeScript

`server/` — Node + Hono + Drizzle ORM + SQLite (better-sqlite3).

Key modules:
- `server/src/routes/` — `scores.ts` (CRUD), `sessions.ts` (practice history), `import.ts` (upload + parse)
- `server/src/parsing/` — `ScoreParser` interface + `ParserRegistry` (open-closed: new formats just `register()`); `MusicXmlParser` is the MVP implementation
- `server/src/db/` — Drizzle schema (`scores`, `sessions`) with cascade delete; `repo.ts` for persistence logic

### Data flow (practice)

```
MusicXML upload → POST /api/import → MusicXmlParser → SQLite (sourceXml stored)
                                                              ↓
PracticePage loads → fetch /api/scores/:id → OsmdService.load(xml)
    → OSMD cursor walk → extractTargets() → ScoringTarget[]
                                                              ↓
MIDI/VirtualKeyboard → NoteEvent → usePractice (useReducer)
    → scoring/engine.ts (pure function: applyNoteOn)
    → ScoringTarget comparison (pitch + chord-set matching, MVP: no rhythm)
    → UI re-renders via reducer state + OsmdScore coloring
    → on completion: POST /api/scores/:id/sessions
```

Key architectural decision: **targets are not stored in the database**. They are extracted at runtime from MusicXML via OSMD cursor walk in `extractTargets.ts`. The server only stores the raw `sourceXml`.

### Frontend key modules

- **`app/src/services/osmd.ts`** — `OsmdService` class wrapping OpenSheetMusicDisplay. Handles: load XML → render SVG, extract targets via cursor walk, note coloring via `GraphicalNote.setColor()`, click event dispatch. Only public `async` method is `load()`.
- **`app/src/services/extractTargets.ts`** — Pure function `extractTargetFromCursor()`. Extracts `ScoringTarget` from OSMD cursor data (staff→hand mapping, rest filtering, duration max, hands dedup). Testable without OSMD DOM.
- **`app/src/scoring/`** — Isolated scoring engine (pure functions, no React). `applyNoteOn()` judges pitch + chord-set matching. Swap judgment rules here without touching hooks or UI.
- **`app/src/components/OsmdScore.tsx`** — React wrapper for OsmdService. Handles lifecycle (load/destroy), coloring effects (current=past=future), practice mode (gray out inactive hand), note click forwarding.
- **`app/src/lib/api.ts`** — Single API client. All `/api` calls go through here; `ApiError` class for structured errors. `ScoreData` type includes `sourceXml`.
- **`app/src/hooks/usePractice.ts`** — `useReducer` + scoring engine. Serialized event processing prevents race conditions.
- **`app/src/hooks/useSettings.ts`** — Single source of truth for all settings (localStorage).
- **`app/src/hooks/useScore.ts`** — Fetches one full score (with `sourceXml`) for the practice page.

### Routing

```tsx
<HashRouter>
  / → redirects to /library
  /library → LibraryPage (score list + search + filter + sort + delete)
  /import → AIScanPage (MusicXML upload, real XHR progress)
  /practice/:scoreId → PracticePage (OSMD rendering + MIDI + scoring engine + free/follow/listen modes)
  /settings → SettingsPage (persisted via useSettings)
</HashRouter>
```

> 注：`/import` 路由挂载的组件名是 `AIScanPage`（历史命名），实际承载 MusicXML 文件上传，并非 AI/图像识别。

### Key types (`app/src/types/music.ts`)

- **ScoringTarget** — practice target extracted at runtime from OSMD: `index`, `midiNotes[]` (chord = array length > 1), `hands[]` (`'left'`|`'right'`), `durationBeats`
- **Hand** — `'left'` | `'right'`
- **PracticeMode** — `'right'` | `'left'` | `'both'`
- **NoteEvent** — MIDI event: `pitch` (MIDI number), `velocity`, `timestamp`, `type`

### Database schema (`server/src/db/schema.ts`)

Two tables only — **no `score_notes` table** (targets are runtime-derived):

- **`scores`** — `id` (UUID), `title`, `composer`, `tempo` (default 120), `sourceFormat`, `sourceXml` (raw MusicXML), `createdAt`
- **`sessions`** — `id`, `scoreId` (FK cascade), `startedAt`, `endedAt`, `pitchAccuracy`, `rhythmAccuracy`, `durationSec`, `practiceMode` (right/left/both), `completed`

## Test Structure

| Layer | Location | Runner | Count |
|-------|----------|--------|-------|
| Scoring engine | `app/src/scoring/engine.test.ts` | Vitest | 40 |
| Position tracker | `app/src/scoring/position.test.ts` | Vitest | 24 |
| Timeline | `app/src/scoring/timeline.test.ts` | Vitest | 5 |
| Range filter | `app/src/scoring/rangeFilter.test.ts` | Vitest | 8 |
| Playback schedule | `app/src/scoring/__tests__/playbackSchedule.test.ts` | Vitest | 8 |
| Tie extraction | `app/src/services/extractTargets.test.ts` | Vitest | 11 |
| OSMD extraction | `app/src/services/__tests__/extractTargets.test.ts` | Vitest | 9 |
| RealValue units | `app/src/services/__tests__/realvalue-units.test.ts` | Vitest | 7 |
| Audio output | `app/src/services/__tests__/audio.test.ts` | Vitest | 42 |
| usePractice hook | `app/src/hooks/__tests__/usePractice.test.ts` | Vitest + jsdom | 13 |
| usePlayback hook | `app/src/hooks/__tests__/usePlayback.test.ts` | Vitest + jsdom | 12 |
| Listen mode | `app/src/hooks/__tests__/listen-mode.test.ts` | Vitest + jsdom | 9 |
| useClock hook | `app/src/hooks/__tests__/useClock.test.ts` | Vitest + jsdom | 6 |
| Fast-tempo regression | `app/src/hooks/__tests__/fast-tempo.test.ts` | Vitest + jsdom | 5 |
| Server parser | `server/src/parsing/musicxml.test.ts` | Vitest | 7 |
| API integration | `server/src/routes/__tests__/*.test.ts` | Vitest | 9 |
| E2E | `e2e/practice-flow.spec.ts` | Playwright | 5 (1 skipped) |
<!-- counts as of 2026-06; verify with npx vitest run -->

Frontend vitest config: `app/vitest.config.ts` (default `environment: 'node'`). Hook tests use `@vitest-environment jsdom` per-file pragma.

Server vitest config: `server/vitest.config.ts` (isolated `root: __dirname` to avoid walking up to legacy root).

API integration tests use `createTestApp()` helper (`server/src/routes/__tests__/helpers.ts`) that creates a fresh in-memory SQLite per test suite.

E2E tests use `reuseExistingServer: true` — dev servers must be started manually before running `npx playwright test`. Test fixture: `test-score.xml` (4-measure piano score, both hands, chords).

## Development Notes

### TypeScript constraints (both app/ and server/)
- `verbatimModuleSyntax` — ALL type-only imports MUST use `import type { ... }`
- `noUnusedLocals` / `noUnusedParameters` — remove anything unused
- `erasableSyntaxOnly` (app/) — no constructor parameter properties (`readonly` in constructor args); declare fields explicitly
- App path alias: `@/` → `app/src/`

### Server vitest gotcha
The server has its own `vitest.config.ts` with `root: __dirname` to prevent it from walking up to the legacy root `vite.config.ts`. If you add a new package at project root, ensure server tests still find their own config.

### Design principles
- **Modular isolation**: scoring judgment, parsing, OSMD service, settings are each independent modules with narrow interfaces. Change judgment rules → only touch `app/src/scoring/`. Add a format → implement `ScoreParser` and `register()`.
- **No fake data**: frontend shows errors when backend is unreachable, never falls back to hardcoded samples.
- **REST contract**: frontend only knows `/api` endpoints; backend and frontend can evolve independently.
- **Pure function extraction**: OSMD-dependent logic in `osmd.ts` is kept thin. The substantial data extraction logic lives in `extractTargets.ts` as a testable pure function.

### OSMD notes
- OSMD renders SVG via VexFlow backend. `OsmdService` uses `GraphicalNote.setColor()` for note coloring (no re-render needed).
- Known issue: `getSVGGElement()` may return null in certain OSMD versions/timing, causing note coloring to fail silently. The `colorPosition()` method guards against this with try/catch.
- OSMD `halfTone` on `Note` is 0-indexed from C0, matching standard MIDI note numbers (C4 = halfTone 60).
- Staff ID mapping: staff 1 = treble (right hand), staff 2 = bass (left hand) for standard two-staff piano scores.

### Tauri (Desktop)
- Tauri v1 (not v2). System deps: `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`, `libsoup2.4-dev`, `librsvg2-dev`
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Builds from `app/` directory. `npm run tauri-dev` sources cargo automatically.

### Spec documents
Requirements, design, and task tracking live in `.kiro/specs/pianoscore-mvp/`:
- `requirements.md` — EARS-format acceptance criteria (REQ 1–6 + 1a)
- `design.md` — architecture, data model, scoring engine, API contract
- `tasks.md` — phased implementation checklist (A–F)

### Known bugs
- **Note coloring**: `getGraphicalNoteSvg()` returns null, preventing `data-pianoscore-target` attributes from being set on SVG elements. E2E phase 2 (visual feedback tests) blocked on this.

> 历史的"和弦窗口 wrongPitch 不清空 pressedInWindow"bug 已在 noteOff tracking 重构（ADR 0002）中修复，不再列入。
