# PianoScore 代码库总结

> 📖 本文档是 PianoScore 项目的完整技术参考，涵盖架构、数据流、API、组件和开发状态。

---

## 1. 项目概览

**PianoScore** 是一个钢琴练习辅助应用，支持 MusicXML 曲谱导入、MIDI 键盘实时练习、多音评分（和弦匹配）、练习历史记录。项目采用 Tauri v1 封装为桌面应用，也可作为 Web 应用运行。

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React + TypeScript | 19.2 / 5.9 |
| 前端构建 | Vite | 7.2 |
| 曲谱渲染 | OpenSheetMusicDisplay (OSMD) | 1.9 |
| UI 组件库 | shadcn/ui (Radix UI) | ~20 组件 |
| 样式 | Tailwind CSS | 3.4 |
| 动画 | Framer Motion | 12.x |
| 路由 | React Router DOM | 7.x (HashRouter) |
| 后端框架 | Hono | 4.6 |
| ORM | Drizzle ORM | 0.38 |
| 数据库 | SQLite (better-sqlite3) | 11.7 |
| XML 解析 | fast-xml-parser | 4.5 |
| ZIP 解压 | fflate | 0.8 |
| 前端测试 | Vitest + jsdom + @testing-library/react | 2.1 |
| 后端测试 | Vitest | 2.1 |
| E2E 测试 | Playwright | 1.60 |
| 桌面端 | Tauri v1 | 1.5 |

---

## 2. 目录结构

```
PianoScore/
├── CLAUDE.md                          # Claude Code 开发指南（权威文档）
├── CODEBASE_SUMMARY.md                # 本文件
├── playwright.config.ts               # Playwright E2E 配置
├── test-score.xml                     # E2E 测试用 MusicXML (4 小节双手钢琴)
├── .kiro/specs/pianoscore-mvp/        # 需求 & 设计文档
│   ├── requirements.md                # EARS 格式需求 (REQ 1-6 + 1a)
│   ├── design.md                      # 架构设计、数据模型、API 契约
│   └── tasks.md                       # 分阶段任务清单 (A-F)
│
├── app/                               # ✅ 活跃前端 (React 19 + Vite 7)
│   ├── package.json
│   ├── vite.config.ts                 # @/ 别名, /api 代理 → :8000
│   ├── index.html                     # Vite 入口 HTML
│   ├── vitest.config.ts               # 测试配置: environment 'node', @/ 别名
│   ├── tailwind.config.js             # shadcn/ui 主题, darkMode "class"
│   └── src/
│       ├── main.tsx                   # 入口: createRoot + StrictMode
│       ├── App.tsx                    # HashRouter + Layout + 路由
│       ├── components/
│       │   ├── Layout.tsx             # 页面框架: header + nav + AnimatePresence
│       │   ├── Navigation.tsx         # 顶部导航栏 (Library / 导入曲谱 / Settings)
│       │   ├── OsmdScore.tsx          # 🎵 OSMD 曲谱渲染器 (SVG, memo)
│       │   ├── VirtualKeyboard.tsx    # 屏幕钢琴键盘 (6 种视觉状态 + 手部颜色)
│       │   └── ui/                    # 13 个 shadcn/ui 组件 (button/card/input/select/dialog/...)
│       ├── services/
│       │   ├── osmd.ts                # 🎵 OsmdService 类 (OSMD 封装, ~380 行)
│       │   ├── audio.ts               # 🔊 AudioOutput 接口 + ToneJsOutput (@tonejs/piano 采样) + WebAudioSynth (振荡器合成) + MidiOutput
│       │   ├── extractTargets.ts      # 纯函数: 从 cursor 数据提取 ScoringTarget
│       │   ├── extractTargets.test.ts # 11 个连音线 (Tie) 提取测试 (与 __tests__/ 版分离)
│       │   └── __tests__/
│       │       ├── extractTargets.test.ts  # 9 个提取逻辑测试 (staff→hand, rest, duration ×4)
│       │       ├── audio.test.ts           # 42 个音频测试 (ToneJsOutput + WebAudioSynth + MidiOutput + midiToNoteName)
│       │       └── realvalue-units.test.ts # 7 个 RealValue→durationBeats ×4 转换回归
│       ├── hooks/
│       │   ├── usePractice.ts         # 练习状态机 (双状态: PositionState + ScoringState, noteOn/noteOff)
│       │   ├── usePlayback.ts         # 🔊 自动回放 hook (useClock + tempoTick 驱动光标; buildNoteEvents 事件表驱动音频, 复音延音; 无 onsetBeat 时回退旧的按 index 发声)
│       │   ├── useClock.ts            # rAF 驱动的时钟 hook (跟练/听音模式节拍源)
│       │   ├── useScore.ts            # 获取单首曲谱 (含 sourceXml)
│       │   ├── useScores.ts           # 曲谱列表 + 导入 + 删除
│       │   ├── useSettings.ts         # 设置持久化 (localStorage)
│       │   ├── useMIDI.ts             # Web MIDI API 接入 (输入 + 输出)
│       │   └── __tests__/
│       │       ├── usePractice.test.ts     # 13 个 hook 测试 (free/follow/listen 状态推进, jsdom)
│       │       ├── usePlayback.test.ts     # 12 个回放测试 (play/stop/和弦/空 targets/null output)
│       │       ├── listen-mode.test.ts     # 9 个听音模式时序测试 (含休止符)
│       │       ├── useClock.test.ts        # 6 个时钟测试 (rAF 时序/elapsed/unmount 清理)
│       │       └── fast-tempo.test.ts      # 5 个快速节拍回归测试
│       ├── lib/
│       │   ├── api.ts                 # API 客户端 (所有 /api 调用)
│       │   └── utils.ts               # shadcn/ui 工具
│       ├── pages/
│       │   ├── LibraryPage.tsx        # /library — 曲谱库 (搜索 + 作曲家筛选 + 排序 + 删除)
│       │   ├── PracticePage.tsx       # /practice/:id — 练习页
│       │   ├── AIScanPage.tsx         # /import — 曲谱导入 (MusicXML 上传, 拖拽 + 进度)
│       │   └── SettingsPage.tsx       # /settings — 设置页
│       ├── scoring/
│       │   ├── types.ts               # ScoringConfig, ScoringState (含 heldNotes), Judgment
│       │   ├── engine.ts              # 纯函数评分引擎 (judgeNoteOn, judgeNoteOff, settleTarget)
│       │   ├── position.ts            # PositionState 接口 + 纯函数 (advancePosition, handleJudgment, tempoTick)
│       │   ├── playbackSchedule.ts     # buildNoteEvents: ScoringTarget[] → 排序的 noteOn/off 事件表 (复音延音)
│       │   ├── rangeFilter.ts         # MeasureRange 接口 + filterTargetsByRange 纯函数
│       │   ├── engine.test.ts         # 40 个评分测试
│       │   ├── position.test.ts       # 24 个位置追踪测试
│       │   ├── rangeFilter.test.ts    # 8 个范围过滤测试
│       │   └── __tests__/
│       │       └── playbackSchedule.test.ts  # 8 个复音回归测试
│       └── types/
│           └── music.ts               # 核心类型: ScoringTarget, Hand, PracticeMode, PracticeStyle, NoteEvent
│
├── server/                            # ✅ 活跃后端 (Node + Hono + Drizzle + SQLite)
│   ├── package.json
│   ├── vitest.config.ts               # root: __dirname (隔离测试)
│   ├── drizzle.config.ts
│   ├── db.sqlite                      # SQLite 数据文件
│   └── src/
│       ├── index.ts                   # Hono app + CORS + 路由挂载 (:8000)
│       ├── routes/
│       │   ├── scores.ts              # GET/DELETE /api/scores, GET /api/scores/:id
│       │   ├── sessions.ts            # GET/POST /api/scores/:id/sessions
│       │   ├── import.ts              # POST /api/import (multipart)
│       │   └── __tests__/
│       │       ├── helpers.ts         # createTestApp() — 内存 SQLite + Hono
│       │       ├── import.test.ts     # 5 个导入测试
│       │       ├── scores.test.ts     # 3 个曲谱 CRUD 测试
│       │       └── sessions.test.ts   # 1 个 session 测试
│       ├── parsing/
│       │   ├── parser.ts              # ScoreParser 接口 + ParserRegistry
│       │   ├── musicxml.ts            # MusicXmlParser 实现
│       │   └── musicxml.test.ts       # 7 个解析测试
│       └── db/
│           ├── schema.ts              # 2 张表: scores, sessions
│           ├── client.ts              # Drizzle + better-sqlite3 初始化
│           ├── instance.ts            # 进程级单例 db
│           └── repo.ts                # CRUD 操作函数
│
├── e2e/                               # Playwright E2E 测试
│   └── practice-flow.spec.ts          # 5 个 E2E 测试 (1 个 skipped)
│
└── src-tauri/                         # 🖥️ Tauri v1 桌面端壳
    ├── Cargo.toml                     # Rust 依赖, bundle id: com.pianoscore.app
    └── tauri.conf.json                # 窗口 1200x800, 引用 app/ 构建
```

> ℹ️ 历史遗留：仓库早期曾有根目录 `index.html`、`src/` (React 18 旧前端) 与 `pianoscore-api/` (Python/FastAPI 旧后端)，均已在后续重构中移除。活跃代码仅在 `app/`、`server/`、`src-tauri/`、`e2e/`。

---

## 3. 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (app/)                               │
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ Library  │   │ AIScan   │   │ Practice │   │ Settings │    │
│  │ Page     │   │ Page     │   │ Page     │   │ Page     │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘    │
│       │              │              │               │            │
│  useScores()    api.import    useScore()       useSettings()    │
│                                usePractice()    useMIDI()        │
│                                usePlayback()                    │
│                                useMIDI()                        │
│                                   │                              │
│                    ┌──────────────┼──────────────┐               │
│                    │              │              │                │
│              ┌─────┴───┐   ┌─────┴──┐   ┌──────┴───┐           │
│              │ OsmdScore│   │Scoring │   │ Virtual  │           │
│              │ (SVG)   │   │Engine  │   │Keyboard  │           │
│              └─────────┘   └────────┘   └──────────┘           │
│              OsmdService     (纯函数,                            │
│              extractTargets  无 React)                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │ fetch /api
┌───────────────────────────────┼─────────────────────────────────┐
│                        后端 (server/)                           │
│                           │                                     │
│  ┌──────────┐   ┌─────────┴──┐   ┌──────────┐                 │
│  │  scores  │   │   import   │   │ sessions │                 │
│  │  routes  │   │   route    │   │  routes  │                 │
│  └────┬─────┘   └─────┬──────┘   └────┬─────┘                 │
│       │               │               │                         │
│       └───────────────┼───────────────┘                         │
│                       │                                          │
│              ┌────────┴────────┐                                 │
│              │   repo.ts       │                                 │
│              │   (CRUD 操作)   │                                 │
│              └────────┬────────┘                                 │
│                       │                                          │
│              ┌────────┴────────┐     ┌──────────────────┐       │
│              │  Drizzle ORM    │─────│  SQLite (db.sqlite)│     │
│              └─────────────────┘     └──────────────────┘       │
│                                                                  │
│  ┌──────────────────┐                                            │
│  │  ParserRegistry  │── MusicXmlParser (fast-xml-parser + fflate)│
│  │  (开闭原则)      │   可扩展: 新格式只需 register()             │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

### 核心数据流

```
MusicXML 文件上传
    │
    ▼
POST /api/import ─→ MusicXmlParser.parse() ─→ ParsedScore (元数据 + sourceXml)
    │                                              │
    │                                   insertScore(db, parsed)
    │                                              │
    │                                              ▼
    │                                    ┌─────────────────┐
    │                                    │  scores 表       │
    │                                    │  (含 sourceXml)  │
    │                                    └─────────────────┘
    │
    ▼
GET /api/scores/:id ─→ getFullScore() ─→ ScoreData { id, title, composer, tempo, sourceXml }
    │
    ▼
PracticePage ─→ OsmdService.load(container, xml) ─→ OSMD 渲染 SVG
    │              └→ extractTargetFromCursor() ─→ ScoringTarget[] (运行时提取)
    │
    │  MIDI 键盘输入 (useMIDI) 或屏幕键盘 (VirtualKeyboard)
    │      │
    │      ▼
    │  handleNoteOn(midiNote)
    │      │
    │      ▼
    │  judgeNoteOn(scoringState, midiNote, currentTarget, config) ─→ { state, judgment }
    │      │
    │      ▼ (judgment 结果)
    │  handleJudgment(positionState, judgment) ─→ PositionState (前进/保持)
    │      │
    │      ▼ (完成时)
    │  summarize(scorableTargetCount) ─→ ScoringSummary
    │      │
    │      ▼
    │  POST /api/scores/:id/sessions ─→ sessions 表
    │
    ▼
OsmdScore 组件: SVG 曲谱渲染
    ├── OSMD VexFlow 后端生成 SVG
    ├── OsmdService.colorPosition() 高亮当前目标 (蓝色 #007ACC)
    ├── 已过目标灰色 (#999)
    ├── 单手模式灰显非活跃手 (#cccccc)
    └── VirtualKeyboard 高亮当前目标音符 + heldNotes 视觉反馈 (蓝/绿/红)
```

**关键架构决策：targets 不存储在数据库中。** 服务器只存原始 `sourceXml`。ScoringTarget[] 在运行时由 OSMD cursor walk 提取（`extractTargets.ts`）。

---

## 4. 前端详解 (app/)

### 4.1 类型系统 (types/music.ts)

| 类型 | 字段 | 用途 |
|------|------|------|
| `ScoringTarget` | `{ index, midiNotes[], hands[], durationBeats, measureNumber?, onsetBeat?, noteDurations? }` | 练习目标（和弦 = midiNotes 长度 > 1，measureNumber = 1-based 小节号，onsetBeat = 真实乐理起音拍，noteDurations = 与 midiNotes 对齐的每音时值，复音延音用） |
| `Hand` | `'left' \| 'right'` | 手（staff 1 = right, staff 2 = left） |
| `PracticeMode` | `'right' \| 'left' \| 'both'` | 练习模式 |
| `PracticeStyle` | `'free' \| 'listen' \| 'follow'` | 驱动练习的方式 |
| `NoteEvent` | `{ id, pitch, velocity, timestamp, type }` | MIDI 输入事件 |

### 4.2 API 客户端 (lib/api.ts)

| 函数 | 方法 | 路径 | 返回 |
|------|------|------|------|
| `fetchScores()` | GET | `/api/scores` | `ScoreSummary[]` |
| `fetchScore(id)` | GET | `/api/scores/:id` | `ScoreData` |
| `importScore(file)` | POST | `/api/import` | `ScoreSummary` |
| `deleteScore(id)` | DELETE | `/api/scores/:id` | `void` |
| `fetchSessions(scoreId)` | GET | `/api/scores/:id/sessions` | `SessionRecord[]` |
| `recordSession(scoreId, data)` | POST | `/api/scores/:id/sessions` | `string` (新 ID) |

`ScoreData = { id, title, composer, tempo, sourceXml }` — 前端拿到 `sourceXml` 后传给 OsmdService。

错误处理: `ApiError extends Error { detail?, status? }`

### 4.3 评分引擎 (scoring/)

**纯函数设计** — 无 React 依赖，可独立测试。

**职责分离** — 评分判断 (engine.ts) 与位置追踪 (position.ts) 解耦。

**评分判断** (`judgeNoteOn`):
```
输入: (scoringState, midiNote, currentTarget, config)
  ├── 音高不匹配 → wrongPitch (wrong +1, 不前进, heldNotes.set(note, null))
  ├── 单音匹配 → correct + 前进 (heldNotes.set(note, hand))
  ├── 和弦部分匹配 → partialChord (累积 pressedInWindow, heldNotes.set(note, null))
  └── 和弦完全匹配 → correct + 前进 (setsEqual 检查, heldNotes.set 所有和弦音)
输出: { state: ScoringState, judgment: Judgment }
```

**音符释放** (`judgeNoteOff`):
```
输入: (scoringState, midiNote)
  ├── 从 heldNotes 删除该音
  └── 如果该音在 pressedInWindow 中 → 同时清空 pressedInWindow (修复和弦窗口 bug)
输出: ScoringState
```

**位置追踪** (position.ts):
- `initPositionState()` — 初始化位置状态
- `advancePosition()` — 前进到下一个 target
- `handleJudgment()` — 根据 judgment 结果决定是否前进
- `isPositionComplete()` — 检查是否已完成所有 targets
- `resetPosition()` — 重置位置状态

**时间线预计算** (位于 `position.ts`，作为 TempoDrivenPosition 的一部分):
- `buildTargetTimeline(targets)` — 从 ScoringTarget[] 预计算每个 target 的节拍位置（`TargetTimelineEntry[]`）
- `TargetTimeline` 类型别名 — 存储预计算的位置信息

**配置** (`ScoringConfig`):
- `chordWindowMs: 120` — 和弦收集窗口

**状态** (`ScoringState`):
- `pressedInWindow[]`, `windowOpenedAt`, `correct`, `wrong`
- `heldNotes: Map<number, Hand | null>` — 当前按住的 MIDI 音符及其手部归属
- `targetIndex` 已从 ScoringState 移至 `PositionState` (position.ts)

**MVP 限制：不做节奏评分，仅音高匹配。**

### 4.4 Hooks 组合

```
useSettings()  ←→ localStorage
    │ ScoringConfig (chordWindowMs)
    ▼
usePractice(targets, config)
    │ useReducer 内部 (双状态)
    │   PositionState (targetIndex) ←→ position.ts
    │   ScoringState (correct, wrong, heldNotes) ←→ engine.ts
    │ judgeNoteOn() 每次音符输入
    │ handleJudgment() 处理位置前进
    ▼
{ scoringState, positionState, handleNoteOn, reset, isComplete, summary }

useMIDI() ←→ Web MIDI API
    │ lastNoteEvent
    ▼
PracticePage: MIDI noteOn → handleNoteOn(pitch)

VirtualKeyboard: onClick → onNoteOn(midi) → handleNoteOn(midi); heldNotes/activeHand/targetMidiSet props 控制 6 种视觉状态
```

| Hook | 状态 | 用途 |
|------|------|------|
| `useSettings` | `{ referenceTone, chordWindowMs }` | 设置持久化 |
| `usePlayback` | `{ play, stop, isPlaying, currentPosition }` | 自动回放 (listen/follow 模式) |
| `useMIDI` | `{ isSupported, isConnected, devices[], lastNoteEvent, outputs[], selectedOutput, sendNoteOn, sendNoteOff }` | MIDI 设备管理 (输入+输出) |
| `useScores` | `{ scores[], isLoading, error, refresh(), importScore(), removeScore() }` | 曲谱列表 |
| `useScore` | `{ score, isLoading, error }` | 单首曲谱 (含 sourceXml) |
| `usePractice` | `{ scoringState, positionState, handleNoteOn, handleNoteOff, reset, isComplete, summary }` | 练习状态机 (双状态) |

### 4.5 页面路由

| 路由 | 组件 | 功能 |
|------|------|------|
| `/` | `Navigate → /library` | 默认重定向 |
| `/library` | `LibraryPage` | 浏览/搜索/筛选/排序/删除曲谱 |
| `/import` | `AIScanPage` | MusicXML 文件上传 (拖拽 + 进度) |
| `/practice/:scoreId` | `PracticePage` | 实时练习 + 评分 + OSMD 渲染 + 三种推进模式 |
| `/settings` | `SettingsPage` | MIDI 设备 + 音频输出 + 练习设置 |

> 注：`/import` 路由挂载的组件名为 `AIScanPage`（历史命名），实际承载 MusicXML 导入功能，并非图像/AI 识别。

### 4.6 OSMD 曲谱渲染系统 (services/)

**OsmdService** (`services/osmd.ts`, ~380 行) — OSMD 封装类:
- `load(container, xml)`: 创建 OSMD 实例，渲染 SVG，提取 targets，挂载 click handler
- `getTargets()`: 返回 ScoringTarget[]（含 measureNumber）
- `getMeasureCount()`: 返回总小节数
- `colorPosition(index, color)`: 通过 `GraphicalNote.setColor()` 着色（无需重渲染）
- `resetAllColors()`: 重置所有音符为黑色
- `applyPracticeMode(mode, filteredIndices)`: 灰显非活跃手
- `onNoteClick(callback)`: 注册 SVG 音符点击回调

**extractTargetFromCursor** (`services/extractTargets.ts`) — 纯函数:
- 输入: cursor 位置的音符数据、target index、可选 measureNumber、可选 onsetBeat（真实乐理起音拍）
- 过滤休止符，提取 midiNotes (halfTone)，映射 staff→hand (1=right, 2=left)
- OSMD `Length.RealValue`（全音符单位）× 4 转换为 `durationBeats`（四分音符节拍）
- `onsetBeat` 来自 OSMD iterator `CurrentEnrolledTimestamp.RealValue × 4`（真实乐理起音拍，复音重叠时正确，不靠累加时值）
- **连音线 (Tie) 处理**：延续音（`note !== note.NoteTie.StartNote`，按身份判定不靠音高）不产生 midiNote——它不重新起音、不计分、音频里无第二个 noteOn；起音音承载整条连音链的合并时值 `NoteTie.Duration.RealValue × 4`（OSMD 累加所有 tie 成员），使其在 buildNoteEvents 中响满整段。圆滑线 (Slur) 不在此列，每音照常各自起音。
- 计算最大 durationBeats，去重 hands，传递 measureNumber 到 ScoringTarget
- 匹配 GraphicalNote 引用（用于着色）
- 全休止符位置返回空条目 `midiNotes=[], hands=[]`（保留 timeline 间隙）。纯延续音位置（剔除后无新起音）同样返回空条目占位，gNotes 仍保留以着色延音符头
- 返回 `{ target: ScoringTarget, gNotes }` 或 null（空输入）

**OsmdScore** (`components/OsmdScore.tsx`) — React memo 组件:
- useEffect 管理 OsmdService 生命周期 (load/destroy)
- currentTargetIndex 变化时重新着色（当前蓝色、过去灰色）
- filteredTargetIndices 控制单手模式灰显
- onNoteClick 转发 SVG 音符点击事件

**OSMD 技术细节**:
- `halfTone` 属性: C0 = 0, C4 = 60, 与 MIDI 编号一致
- Staff ID 映射: staff 1 = treble (right), staff 2 = bass (left)
- `GraphicalNote.setColor()` 直接修改 SVG，无需重渲染
- 已知问题: `getSVGGElement()` 某些时机返回 null，导致着色失败

### 4.7 组件层次

```
App
  Layout
    Navigation
    Routes
      LibraryPage
        Score cards grid → /practice/:id
      PracticePage
        Score header card
        Feedback badges (Framer Motion 动画)
        OsmdScore (OSMD SVG 曲谱)
        MIDI status bar
        VirtualKeyboard (HTML/CSS 钢琴键)
        Progress bar
        Start/Stop/Reset controls
        Practice mode toggle (right/left/both)
        Completion screen (统计 + 重玩)
      ImportPage
        Drop zone + upload progress
      SettingsPage
        MIDI device card
        Audio settings card
        Practice settings card
```

---

## 5. 后端详解 (server/)

### 5.1 API 端点

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| GET | `/api/scores` | — | `{ scores: ScoreSummary[] }` | 曲谱列表 |
| GET | `/api/scores/:id` | — | `ScoreData` (含 sourceXml) | 曲谱详情 |
| DELETE | `/api/scores/:id` | — | `{ deleted: true }` | 删除曲谱 (级联删除) |
| GET | `/api/scores/:id/sessions` | — | `{ sessions: SessionRow[] }` | 练习历史 |
| POST | `/api/scores/:id/sessions` | JSON `{ startedAt, endedAt, pitchAccuracy, rhythmAccuracy, durationSec, practiceMode }` | `{ id }` (201) | 记录练习 |
| POST | `/api/import` | multipart `file` (.musicxml/.xml/.mxl, ≤10MB) | `ScoreSummary` (201) | 导入曲谱 |

### 5.2 数据库 Schema

**scores 表**:
| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| title | text NOT NULL | 曲名 |
| composer | text | 作曲家 |
| tempo | integer DEFAULT 120 | BPM |
| sourceFormat | text DEFAULT 'musicxml' | 来源格式 |
| sourceXml | text | 原始 MusicXML |
| createdAt | integer DEFAULT unixepoch() | 创建时间 |

**sessions 表**:
| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | UUID |
| scoreId | text FK → scores.id ON DELETE CASCADE | 所属曲谱 |
| startedAt | integer | 开始时间戳 |
| endedAt | integer | 结束时间戳 |
| pitchAccuracy | real | 音准正确率 0..1 |
| rhythmAccuracy | real | 节奏正确率 0..1 |
| durationSec | real | 练习时长 (秒) |
| practiceMode | text DEFAULT 'both' | 练习模式 (right/left/both) |
| completed | boolean DEFAULT true | 是否完成 |

**注意**: 没有 `score_notes` 表。练习目标在运行时从 MusicXML 通过 OSMD cursor walk 提取。

### 5.3 解析器架构

```typescript
// 开闭原则: 新格式只需实现 ScoreParser 并 register()
interface ScoreParser {
  readonly format: string
  canParse(filename: string, bytes: Uint8Array): boolean
  parse(bytes: Uint8Array): Promise<ParsedScore>
}

class ParserRegistry {
  register(parser: ScoreParser): void
  select(filename: string, bytes: Uint8Array): ScoreParser | null
}
```

**MusicXmlParser** 实现:
- 支持 `.musicxml`, `.xml`, `.mxl` (ZIP 压缩)
- 提取标题 (work-title / movement-title)、作曲家、速度
- 返回 `ParsedScore { title, composer, tempo, sourceXml }`
- **不提取 targets/notes** — targets 由前端 OSMD 在运行时提取

---

## 6. 桌面端 (Tauri v1)

| 配置 | 值 |
|------|------|
| 版本 | Tauri v1.5.0 (非 v2) |
| Bundle ID | `com.pianoscore.app` |
| 窗口 | 1200x800, 可调, 居中 |
| 开发命令 | `beforeDevCommand: cd app && npm run dev` → `http://localhost:5173` |
| 构建命令 | `beforeBuildCommand: cd app && npm run build` → `../app/dist` |
| 系统依赖 (Linux) | libgtk-3-dev, libwebkit2gtk-4.0-dev, libsoup2.4-dev, librsvg2-dev |

```bash
npm run tauri-dev     # 开发模式
npm run tauri-build   # 生产构建
```

---

## 7. 测试

### 前端测试 (199 个)

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `app/src/scoring/engine.test.ts` | 40 | judgeNoteOn/judgeNoteOff/settleTarget/summarize（含位置追踪、heldNotes、和弦窗口） |
| `app/src/services/__tests__/audio.test.ts` | 42 | ToneJsOutput + WebAudioSynth + MidiOutput + midiToNoteName |
| `app/src/scoring/position.test.ts` | 24 | initPositionState、advancePosition、handleJudgment、tempoTick、buildTargetTimeline、isPositionComplete |
| `app/src/hooks/__tests__/usePractice.test.ts` | 13 | free/follow/listen 模式状态推进、settleTarget、settlements |
| `app/src/hooks/__tests__/usePlayback.test.ts` | 12 | 自动回放 (play/stop/noteOn/noteOff/和弦/空 targets/null output/stoppedRef) |
| `app/src/services/extractTargets.test.ts` | 11 | 连音线 (Tie): 起音承载合并时值、延续音剔除、纯延续位置空占位、3 音连音链、部分连音和弦、同音反复不误判 |
| `app/src/hooks/__tests__/listen-mode.test.ts` | 9 | listen 模式回放时序、休止符（开头/中间/结尾/连续）、混合时值 |
| `app/src/services/__tests__/extractTargets.test.ts` | 9 | staff→hand 映射、rest 空条目、duration ×4 转换、hands 去重 |
| `app/src/scoring/__tests__/playbackSchedule.test.ts` | 8 | 复音回归: 真实 onset 时间线(非累加)、归一化、buildNoteEvents 延音事件表、休止符、回退 |
| `app/src/scoring/rangeFilter.test.ts` | 8 | measureNumber 范围过滤、null range、边界情况 |
| `app/src/services/__tests__/realvalue-units.test.ts` | 7 | RealValue→durationBeats ×4 转换回归、端到端时序（120/60 BPM） |
| `app/src/hooks/__tests__/useClock.test.ts` | 6 | rAF 时序、elapsed 递增、tempo 重置、unmount 清理 |
| `app/src/hooks/__tests__/fast-tempo.test.ts` | 5 | 快速节拍回归（高 BPM 下时序不漂移） |

> 合计 199 个测试。前端 vitest 配置: `app/vitest.config.ts`（默认 environment: 'node'）。hook 测试使用 `@vitest-environment jsdom` 逐文件覆盖。
> 注意 `extractTargets.test.ts` 同时存在两份：`services/extractTargets.test.ts`（连音线专项，11 个）和 `services/__tests__/extractTargets.test.ts`（基础提取，9 个）。

### 后端测试 (16 个)

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `server/src/parsing/musicxml.test.ts` | 7 | 标题/作曲家/速度解析、sourceXml 保存、默认值、错误拒绝、文件扩展名识别 |
| `server/src/routes/__tests__/import.test.ts` | 5 | 导入成功、列表可见、重复导入、文件类型拒绝、空 body 拒绝 |
| `server/src/routes/__tests__/scores.test.ts` | 3 | 404、删除、sourceXml 返回 |
| `server/src/routes/__tests__/sessions.test.ts` | 1 | session 记录与检索 |

API 集成测试使用 `createTestApp()` helper (`server/src/routes/__tests__/helpers.ts`)，每个测试套件创建独立内存 SQLite。

### E2E 测试 (5 个)

| 文件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| `e2e/practice-flow.spec.ts` | 5 (1 skipped) | 完整用户流程、OSMD SVG 渲染、键盘交互推进评分、完成状态、错误状态 |

E2E 配置: `playwright.config.ts`，`reuseExistingServer: true`（需手动启动 dev servers）。测试数据: `test-score.xml`（4 小节双手钢琴曲）。

---

## 8. 当前状态与待办

### 需求完成状态

| 需求 | 标题 | 状态 |
|------|------|------|
| REQ 1 | MusicXML 导入 (可扩展) | ✅ 完成 |
| REQ 1a | 导入页面 UI | ✅ 完成 (AIScanPage，路由 `/import`) |
| REQ 2 | MIDI 练习 + 多音评分 | ✅ 完成 (音高匹配) |
| REQ 3 | 曲谱库 CRUD | ✅ 完成 |
| REQ 3a | 库搜索/筛选/排序/删除 | ✅ 完成 (LibraryPage：搜索框 + 作曲家筛选 + 标题/时间排序 + 删除确认) |
| REQ 4 | 练习历史 + 进度 | ✅ 后端完成, ⬜ 前端展示待做 |
| REQ 5 | 设置持久化 | ✅ 完成 |
| REQ 6 | 非功能需求 | ⬜ 大部分待做 |

### 已知限制

1. **音符着色 Bug** — `getSVGGElement()` 返回 null，导致当前/过去音符无法区分颜色（E2E phase 2 视觉反馈测试受阻）
2. **仅解析第一声部** — 多声部/多行五线谱暂不支持
3. **无节奏评分** — MVP 阶段仅做音高匹配（基础设施已具备：noteOff tracking + 时钟系统，见 TODO.md 未来功能）
4. **无认证** — 所有端点开放
5. **无分页** — 列表端点返回全量

> 历史"和弦窗口 bug"（错音不清空 `pressedInWindow`）已在 noteOff tracking 重构中修复（见 ADR 0002），不再列入。

---

## 9. 关键设计模式

| 模式 | 应用位置 | 说明 |
|------|----------|------|
| **纯函数引擎** | `scoring/engine.ts` | 无 React 依赖，可独立测试 |
| **评分-位置分离** | `scoring/engine.ts` + `scoring/position.ts` | 判断逻辑与位置追踪解耦，各自纯函数独立测试 |
| **纯函数提取** | `services/extractTargets.ts` | OSMD 数据提取逻辑与 DOM 解耦，可测试 |
| **useReducer 序列化** | `usePractice.ts` | 防止 MIDI 快速输入的竞态条件，管理双状态 (PositionState + ScoringState) |
| **双输入路径** | useMIDI + VirtualKeyboard | 统一 `handleNoteOn`/`handleNoteOff` 回调 |
| **设置单一来源** | `useSettings` | localStorage 持久化，其他模块从中读取 |
| **开闭原则** | `ParserRegistry` | 新格式只需 `register()`，不修改已有代码 |
| **服务类封装** | `OsmdService` | OSMD 实例生命周期管理，着色/事件/cursor 统一封装 |
| **API 客户端集中** | `lib/api.ts` | 所有 `/api` 调用集中，`ApiError` 统一错误处理 |

---

## 10. 开发命令速查

```bash
# 前端
cd app && npm install                # 安装依赖
cd app && npm run dev                # Vite 开发服务器 :5173
cd app && npm run build              # tsc + Vite 生产构建
cd app && npm run lint               # ESLint
cd app && npx vitest run             # 运行所有前端测试 (199 个)
cd app && npx vitest                 # 测试 watch 模式
cd app && npx vitest run src/scoring/engine.test.ts  # 单个测试文件

# 后端
cd server && npm install             # 安装依赖
cd server && npm run dev             # tsx watch :8000
cd server && npm run typecheck       # tsc --noEmit
cd server && npm test                # vitest run (16 个)

# E2E (先启动 dev servers)
cd server && npm run dev &
cd app && npm run dev &
npx playwright test                  # 需要 :8000 和 :5173 运行中

# 桌面端
npm run tauri-dev                    # Tauri 开发 (需要 Rust + 系统依赖)
npm run tauri-build                  # 生产构建

# 全量验证
cd app && npm run build && npx vitest run && cd ../server && npm run typecheck && npm test
```
