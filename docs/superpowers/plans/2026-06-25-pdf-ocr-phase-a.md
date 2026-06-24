# PDF/图片乐谱识别（OMR）— 阶段 A：后端 OCR 核心实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Hono 后端实现 PDF/图片 → Audiveris 子进程 → MusicXML 入库的完整 OCR 识别管线，不碰 Tauri。

**Architecture:** 后端用 `child_process.spawn('java', ...)` 调用 Audiveris（进程隔离，AGPL 边界），通过异步任务表（`ocr_tasks`）+ 1.5s 轮询暴露状态。OcrEngine 负责进程调用和错误码映射，OcrRunner 负责状态机和入库回填。识别完成直接 `insertScore`（sourceFormat='ocr'），不做事后预览。

**Tech Stack:** Hono 4 / Drizzle ORM / better-sqlite3 / vitest / Node child_process / fast-xml-parser + fflate（复用现有 .mxl 解压）

**Spec:** `docs/superpowers/specs/2026-06-24-pdf-ocr-design.md`（本计划对应第 11 节"阶段 A"）

**所有命令在 `server/` 目录执行：** `cd server && <command>`

---

## 文件结构（阶段 A 涉及）

| 文件 | 操作 | 责任 |
|------|------|------|
| `server/src/parsing/musicxml.ts` | 修改 | 导出 `extractMxl`、`isZip`、`extractMusicXmlMetadata` 供 OCR 复用 |
| `server/src/parsing/musicxml.test.ts` | 修改 | 补导出函数的单测 |
| `server/src/db/schema.ts` | 修改 | 新增 `ocrTasks` 表定义 |
| `server/src/db/repo.ts` | 修改 | `insertScore` 加可选 sourceFormat；`ScoreSummary`/`FullScore` 加 sourceFormat；新增 `OcrTaskRepo` |
| `server/src/routes/__tests__/helpers.ts` | 修改 | 测试建表 SQL 加 `ocr_tasks` |
| `server/src/routes/scores.ts` | 无需改 | 透传 repo（sourceFormat 已在返回中） |
| `server/src/ocr/config.ts` | 新建 | `loadOcrConfig()` 读环境变量 |
| `server/src/ocr/engine.ts` | 新建 | `OcrEngine` 类：spawn java、解析输出、错误码 |
| `server/src/ocr/runner.ts` | 新建 | `OcrRunner` 类：状态机、入库回填 |
| `server/src/ocr/errors.ts` | 新建 | `OcrError` 类、`ErrorCode` 类型 |
| `server/src/routes/ocr.ts` | 新建 | `createOcrRoute()`：3 端点 + 409 串行 |
| `server/src/index.ts` | 修改 | 扩展 `/api/health` + 挂载 `/api/ocr` |
| `server/src/ocr/__tests__/*.test.ts` | 新建 | 第一层单测 |
| `server/src/ocr/__tests__/integration.test.ts` | 新建 | 第二层集成测试（skipIf 守卫） |
| `LICENSE-THIRD-PARTY.md` | 新建 | AGPL 合规声明 |
| `LICENSES/AGPL-3.0.txt` | 新建 | AGPL 全文 |
| `README.md` | 修改 | 第三方组件章节 |
| `LICENSE` | 修改 | MIT 声明 + 第三方指引 |

---

## Task 1: 导出 musicxml.ts 的复用函数

OcrEngine 读 Audiveris 的 `.mxl` 输出需要复用现有的 ZIP 解压和元数据提取逻辑。目前 `extractMxl`、`isZip`、`extractMetadata` 都是私有函数。

**Files:**
- Modify: `server/src/parsing/musicxml.ts:23-94`
- Test: `server/src/parsing/musicxml.test.ts`

- [ ] **Step 1: 写失败测试 —— extractMxl/isZip 可导入且行为不变**

在 `musicxml.test.ts` 顶部 import 区追加，并在 `describe('MusicXmlParser')` 块**之后**追加新 describe：

```typescript
import { extractMxl, isZip, extractMusicXmlMetadata } from './musicxml'

describe('exported musicxml helpers', () => {
  it('isZip detects PK magic bytes', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true)
    expect(isZip(new Uint8Array([0x1f, 0x8b, 0x08, 0]))).toBe(false) // gzip
  })

  it('extractMusicXmlMetadata uses provided fallback title', () => {
    // 无 work-title/movement-title 的根
    const root = { 'part-list': { 'score-part': { id: 'P1' } } }
    const meta = extractMusicXmlMetadata(root as never, '<xml/>', 'my-score')
    expect(meta.title).toBe('my-score')
    expect(meta.tempo).toBe(120) // 默认
  })

  it('extractMusicXmlMetadata prefers real title over fallback', () => {
    const root = { work: { 'work-title': 'Real Title' } }
    const meta = extractMusicXmlMetadata(root as never, '<xml/>', 'fallback')
    expect(meta.title).toBe('Real Title')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/parsing/musicxml.test.ts`
Expected: FAIL — "extractMxl is not exported" 或类似（函数当前私有）

- [ ] **Step 3: 重构 musicxml.ts 导出三个函数**

将 `extractMxl`、`isZip` 改为 export（去 `function` 改 `export function`）。把 `extractMetadata(root, sourceXml)` 重命名为 `extractMusicXmlMetadata(root, sourceXml, fallbackTitle = 'Untitled')` 并导出，title 解析改用 `fallbackTitle`：

```typescript
// 从 .mxl（zip）中取出根 MusicXML 文档。
export function extractMxl(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const container = files['META-INF/container.xml']
  if (container) {
    const doc = xml.parse(strFromU8(container))
    const full = doc?.container?.rootfiles?.rootfile?.['@_full-path']
    if (full && files[full]) return strFromU8(files[full])
  }
  const fallback = Object.keys(files).find(
    (n) => !n.startsWith('META-INF') && (n.endsWith('.xml') || n.endsWith('.musicxml')),
  )
  if (fallback) return strFromU8(files[fallback])
  throw new ParseError('Invalid .mxl', 'No MusicXML document found inside archive')
}

// zip 魔数 PK\x03\x04
export function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}
```

`MusicXmlParser.parse` 内的调用改为 `extractMusicXmlMetadata(root, text)`（用默认 fallback 'Untitled'，行为不变）。

新导出函数：

```typescript
// 从 MusicXML 根对象提取元数据（标题/作曲家/速度）。fallbackTitle 用于缺标题时回退。
export function extractMusicXmlMetadata(
  root: Record<string, unknown>,
  sourceXml: string,
  fallbackTitle = 'Untitled',
): ParsedScore {
  const work = root['work'] as { 'work-title'?: string } | undefined
  const ident = root['identification'] as { creator?: unknown } | undefined
  const title = work?.['work-title'] ?? (root['movement-title'] as string) ?? fallbackTitle

  const composer = asArray(ident?.creator)
    .map((c) => (typeof c === 'object' ? (c as Record<string, unknown>)['#text'] : c))
    .find(Boolean) as string | undefined

  let tempo = 120
  const parts = asArray(root['part'] as unknown)
  if (parts.length) {
    const measuresXml = asArray((parts[0] as Record<string, unknown>)['measure'] as unknown)
    for (const m of measuresXml) {
      const mEl = m as Record<string, unknown>
      const sound = (mEl['sound'] ?? (mEl['direction'] as Record<string, unknown>)?.['sound']) as Record<string, unknown> | undefined
      if (sound?.['@_tempo'] !== undefined) {
        tempo = num(sound['@_tempo'], tempo)
        break
      }
    }
  }

  return { title: String(title), composer, tempo, sourceXml }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/parsing/musicxml.test.ts`
Expected: PASS — 包括新导出测试和原有 8 个测试（确保重构未破坏行为）

- [ ] **Step 5: typecheck**

Run: `cd server && npm run typecheck`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
cd server
git add src/parsing/musicxml.ts src/parsing/musicxml.test.ts
git commit -m "refactor: export musicxml helpers (extractMxl/isZip/extractMusicXmlMetadata) for OCR reuse"
```

---

## Task 2: ocr_tasks 表 + ScoreSummary 加 sourceFormat

数据模型层。新增 `ocr_tasks` 表，并打通 `sourceFormat` 从 DB 到返回链路。

**Files:**
- Modify: `server/src/db/schema.ts:1-31`
- Modify: `server/src/db/repo.ts:7-40`
- Modify: `server/src/routes/__tests__/helpers.ts:24-46`

- [ ] **Step 1: schema.ts 追加 ocrTasks 定义**

在 `schema.ts` 的 `sessions` 表定义之后、`export type ScoreRow` 之前追加：

```typescript
// OCR 识别任务。done 时 scoreId 指向入库的 scores 行（软关联，不加 FK）。
export const ocrTasks = sqliteTable('ocr_tasks', {
  id: text('id').primaryKey(),
  status: text('status', {
    enum: ['pending', 'running', 'done', 'failed'],
  }).notNull(),
  inputFormat: text('input_format').notNull(),
  inputFileName: text('input_file_name').notNull(),
  inputPath: text('input_path'),
  scoreId: text('score_id'),
  errorCode: text('error_code'),
  errorDetail: text('error_detail'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})

export type OcrTaskRow = typeof ocrTasks.$inferSelect
```

- [ ] **Step 2: repo.ts 改 ScoreSummary/FullScore + insertScore**

`ScoreSummary` 接口加 `sourceFormat`：

```typescript
export interface ScoreSummary {
  id: string
  title: string
  composer: string | null
  tempo: number
  sourceFormat: string
}

export interface FullScore extends ScoreSummary {
  sourceXml: string | null
}
```

`insertScore` 加可选参数（向后兼容）：

```typescript
export function insertScore(
  db: Db,
  parsed: ParsedScore,
  options?: { sourceFormat?: string },
): string {
  const id = randomUUID()
  db.insert(scores).values({
    id,
    title: parsed.title,
    composer: parsed.composer ?? null,
    tempo: parsed.tempo,
    sourceFormat: options?.sourceFormat ?? 'musicxml',
    sourceXml: parsed.sourceXml,
  }).run()
  return id
}
```

`listScores` 返回加 `sourceFormat: s.sourceFormat`：

```typescript
export function listScores(db: Db): ScoreSummary[] {
  const all = db.select().from(scores).all()
  return all.map((s) => ({
    id: s.id,
    title: s.title,
    composer: s.composer,
    tempo: s.tempo,
    sourceFormat: s.sourceFormat,
  }))
}
```

`getFullScore` 返回加 `sourceFormat: s.sourceFormat`：

```typescript
export function getFullScore(db: Db, id: string): FullScore | null {
  const s = db.select().from(scores).where(eq(scores.id, id)).get()
  if (!s) return null
  return {
    id: s.id,
    title: s.title,
    composer: s.composer,
    tempo: s.tempo,
    sourceFormat: s.sourceFormat,
    sourceXml: s.sourceXml,
  }
}
```

- [ ] **Step 3: helpers.ts 测试建表 SQL 加 ocr_tasks**

在 `helpers.ts` 的 `sqlite.exec` 字符串里，`sessions` 表 CREATE 之后追加：

```sql
    CREATE TABLE ocr_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      input_format TEXT NOT NULL,
      input_file_name TEXT NOT NULL,
      input_path TEXT,
      score_id TEXT,
      error_code TEXT,
      error_detail TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER
    );
```

- [ ] **Step 4: 写失败测试 —— sourceFormat 链路**

在 `server/src/routes/__tests__/scores.test.ts` 末尾 `describe` 内追加：

```typescript
  it('list returns sourceFormat field', async () => {
    await importScore()
    const res = await test.app.request('/api/scores')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body[0]).toHaveProperty('sourceFormat')
    expect(body[0].sourceFormat).toBe('musicxml')
  })

  it('full score returns sourceFormat field', async () => {
    const id = await importScore()
    const res = await test.app.request(`/api/scores/${id}`)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('sourceFormat')
    expect(body.sourceFormat).toBe('musicxml')
  })
```

- [ ] **Step 5: 跑测试确认通过（schema/repo 改动已使测试通过）**

Run: `cd server && npx vitest run src/routes/__tests__/scores.test.ts`
Expected: PASS — 两个新测试通过

- [ ] **Step 6: 全量测试 + typecheck**

Run: `cd server && npm test && npm run typecheck`
Expected: 全部通过（确保 insertScore 签名变更未破坏 import.test.ts）

- [ ] **Step 7: Commit**

```bash
cd server
git add src/db/schema.ts src/db/repo.ts src/routes/__tests__/helpers.ts src/routes/__tests__/scores.test.ts
git commit -m "feat(db): add ocr_tasks table and thread sourceFormat through score chain"
```

---

## Task 3: OcrTaskRepo

`ocr_tasks` 表的 CRUD 操作。独立于 OcrEngine，便于单测。

**Files:**
- Create: `server/src/db/ocrTaskRepo.ts`
- Test: `server/src/db/__tests__/ocrTaskRepo.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// server/src/db/__tests__/ocrTaskRepo.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { OcrTaskRepo } from '../ocrTaskRepo.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE ocr_tasks (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, input_format TEXT NOT NULL,
      input_file_name TEXT NOT NULL, input_path TEXT, score_id TEXT,
      error_code TEXT, error_detail TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER, completed_at INTEGER
    );
  `)
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

describe('OcrTaskRepo', () => {
  let repo: OcrTaskRepo
  let close: () => void

  beforeEach(() => {
    const t = makeDb()
    repo = new OcrTaskRepo(t.db)
    close = t.close
  })
  afterEach(() => close())

  it('creates and gets a task', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    const task = repo.get(id)
    expect(task).toBeDefined()
    expect(task!.status).toBe('pending')
    expect(task!.inputFormat).toBe('pdf')
    expect(task!.inputFileName).toBe('a.pdf')
  })

  it('marks running with startedAt', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markRunning(id)
    expect(repo.get(id)!.status).toBe('running')
    expect(repo.get(id)!.startedAt).toBeGreaterThan(0)
  })

  it('marks done with scoreId and completedAt', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markDone(id, 'score-123')
    const task = repo.get(id)!
    expect(task.status).toBe('done')
    expect(task.scoreId).toBe('score-123')
    expect(task.completedAt).toBeGreaterThan(0)
  })

  it('marks failed with error code/detail', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    repo.markFailed(id, 'engine_crash', 'exit code 1')
    const task = repo.get(id)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('engine_crash')
    expect(task.errorDetail).toBe('exit code 1')
  })

  it('finds active task (pending/running)', () => {
    const id1 = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    const active = repo.findActive()
    expect(active?.id).toBe(id1)
    repo.markDone(id1, 's1')
    expect(repo.findActive()).toBeNull()
  })

  it('deletes a task', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf', inputPath: '/tmp/a.pdf' })
    expect(repo.delete(id)).toBe(true)
    expect(repo.get(id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/db/__tests__/ocrTaskRepo.test.ts`
Expected: FAIL — "Cannot find module '../ocrTaskRepo.js'"

- [ ] **Step 3: 实现 OcrTaskRepo**

```typescript
// server/src/db/ocrTaskRepo.ts
import { eq, or, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Db } from './client.js'
import { ocrTasks } from './schema.js'

export interface CreateTaskInput {
  inputFormat: string
  inputFileName: string
  inputPath?: string
}

export class OcrTaskRepo {
  constructor(private db: Db) {}

  create(input: CreateTaskInput): string {
    const id = randomUUID()
    this.db.insert(ocrTasks).values({
      id,
      status: 'pending',
      inputFormat: input.inputFormat,
      inputFileName: input.inputFileName,
      inputPath: input.inputPath ?? null,
    }).run()
    return id
  }

  get(id: string) {
    return this.db.select().from(ocrTasks).where(eq(ocrTasks.id, id)).get()
  }

  markRunning(id: string): void {
    this.db.update(ocrTasks).set({
      status: 'running',
      startedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  markDone(id: string, scoreId: string): void {
    this.db.update(ocrTasks).set({
      status: 'done',
      scoreId,
      completedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  markFailed(id: string, errorCode: string, errorDetail?: string): void {
    this.db.update(ocrTasks).set({
      status: 'failed',
      errorCode,
      errorDetail: errorDetail ?? null,
      completedAt: Math.floor(Date.now() / 1000),
    }).where(eq(ocrTasks.id, id)).run()
  }

  // 查找 pending 或 running 的任务（用于 409 串行约束）
  findActive() {
    return this.db.select().from(ocrTasks)
      .where(or(eq(ocrTasks.status, 'pending'), eq(ocrTasks.status, 'running')))
      .get() ?? null
  }

  delete(id: string): boolean {
    const res = this.db.delete(ocrTasks).where(eq(ocrTasks.id, id)).run()
    return res.changes > 0
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/db/__tests__/ocrTaskRepo.test.ts`
Expected: PASS — 全部 6 个测试

- [ ] **Step 5: typecheck**

Run: `cd server && npm run typecheck`
Expected: 无错误（注意：若 `isNull` 未用到可移除 import，保留也无妨）

- [ ] **Step 6: Commit**

```bash
cd server
git add src/db/ocrTaskRepo.ts src/db/__tests__/ocrTaskRepo.test.ts
git commit -m "feat(db): add OcrTaskRepo for ocr_tasks CRUD and active-task lookup"
```

---

## Task 4: OcrError + OcrConfig

错误类型和配置加载。两个小模块，一起做。

**Files:**
- Create: `server/src/ocr/errors.ts`
- Create: `server/src/ocr/config.ts`
- Test: `server/src/ocr/__tests__/config.test.ts`

- [ ] **Step 1: 写配置测试**

```typescript
// server/src/ocr/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadOcrConfig } from '../config.js'

describe('loadOcrConfig', () => {
  const original = { ...process.env }
  beforeEach(() => {
    delete process.env.PIANOSCORE_JAVA
    delete process.env.PIANOSCORE_AUDIVERIS_JAR
    delete process.env.PIANOSCORE_TESSDATA
    delete process.env.PIANOSCORE_DB
  })
  afterEach(() => { process.env = { ...original } })

  it('uses env vars when set', () => {
    process.env.PIANOSCORE_JAVA = '/app/jre/bin/java'
    process.env.PIANOSCORE_AUDIVERIS_JAR = '/app/audiveris.jar'
    process.env.PIANOSCORE_TESSDATA = '/app/tessdata'
    const cfg = loadOcrConfig()
    expect(cfg.javaBin).toBe('/app/jre/bin/java')
    expect(cfg.jarPath).toBe('/app/audiveris.jar')
    expect(cfg.tessdataDir).toBe('/app/tessdata')
  })

  it('falls back to PATH java and local jar in dev', () => {
    const cfg = loadOcrConfig()
    expect(cfg.javaBin).toBe('java')
    expect(cfg.jarPath).toBe('./audiveris.jar')
    expect(cfg.tessdataDir).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/ocr/__tests__/config.test.ts`
Expected: FAIL — "Cannot find module '../config.js'"

- [ ] **Step 3: 实现 errors.ts**

```typescript
// server/src/ocr/errors.ts
export type ErrorCode =
  | 'no_java'
  | 'no_audiveris'
  | 'engine_crash'
  | 'no_output'
  | 'low_confidence'

export class OcrError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'OcrError'
  }
}
```

- [ ] **Step 4: 实现 config.ts**

```typescript
// server/src/ocr/config.ts
export interface OcrConfig {
  javaBin: string
  jarPath: string
  tessdataDir?: string
  dbPath: string
}

export function loadOcrConfig(): OcrConfig {
  return {
    javaBin: process.env.PIANOSCORE_JAVA ?? 'java',
    jarPath: process.env.PIANOSCORE_AUDIVERIS_JAR ?? './audiveris.jar',
    tessdataDir: process.env.PIANOSCORE_TESSDATA ?? undefined,
    dbPath: process.env.PIANOSCORE_DB ?? './db.sqlite',
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && npx vitest run src/ocr/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 6: typecheck + Commit**

Run: `cd server && npm run typecheck`
Expected: 无错误

```bash
cd server
git add src/ocr/errors.ts src/ocr/config.ts src/ocr/__tests__/config.test.ts
git commit -m "feat(ocr): add OcrError/OcrConfig (env-var based, dev fallbacks)"
```

---

## Task 5: OcrEngine 核心识别逻辑

工程难点。spawn java 调 Audiveris，解析输出，映射错误码。**这一步大量 mock child_process，不依赖真实 Java。**

**Files:**
- Create: `server/src/ocr/engine.ts`
- Test: `server/src/ocr/__tests__/engine.test.ts`

- [ ] **Step 1: 写失败测试 —— healthCheck**

OcrEngine 的 healthCheck 用 `child_process.spawnSync('java', ['-version'])` 检测，测试用 mock。

```typescript
// server/src/ocr/__tests__/engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as childProcess from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { OcrEngine } from '../engine.js'
import { OcrError } from '../errors.js'

// Mock child_process
vi.mock('node:child_process')

const validConfig = {
  javaBin: '/fake/java',
  jarPath: '/fake/audiveris.jar',
  tessdataDir: '/fake/tessdata',
  dbPath: '/fake/db.sqlite',
}

describe('OcrEngine.healthCheck', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok when java -version succeeds and jar exists', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0, stdout: '', stderr: 'openjdk 17', pid: 1,
      output: [null, '', ''], signal: null,
    } as never)
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)

    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(true)
  })

  it('returns no_java when java -version fails', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 127, stdout: '', stderr: 'not found', pid: 0,
      output: [null, '', ''], signal: null,
    } as never)
    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_java')
  })

  it('returns no_audiveris when jar missing', async () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      status: 0, stdout: '', stderr: '', pid: 1,
      output: [null, '', ''], signal: null,
    } as never)
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'))

    const engine = new OcrEngine(validConfig)
    const result = await engine.healthCheck()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_audiveris')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/ocr/__tests__/engine.test.ts`
Expected: FAIL — "Cannot find module '../engine.js'"

- [ ] **Step 3: 实现 OcrEngine（healthCheck + recognize 骨架）**

```typescript
// server/src/ocr/engine.ts
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { extractMxl, isZip, extractMusicXmlMetadata } from '../parsing/musicxml.js'
import { OcrError, type ErrorCode } from './errors.js'
import type { OcrConfig } from './config.js'

export interface RecognizeInput {
  taskId: string
  filePath: string
  format: 'pdf' | 'image'
}

export interface OcrResult {
  musicXml: string
  meta: { title: string; composer?: string; tempo: number }
}

export interface HealthResult {
  ok: boolean
  reason?: ErrorCode
}

const TIMEOUT_MS = 90_000
const STDERR_CAP = 64 * 1024

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export class OcrEngine {
  private availableCache: HealthResult | null = null

  constructor(private config: OcrConfig) {}

  async healthCheck(): Promise<HealthResult> {
    if (this.availableCache) return this.availableCache

    // 1. java -version
    const javaCheck = spawnSync(this.config.javaBin, ['-version'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (javaCheck.status !== 0) {
      this.availableCache = { ok: false, reason: 'no_java' }
      return this.availableCache
    }

    // 2. jar 存在
    try {
      await fs.access(this.config.jarPath)
    } catch {
      this.availableCache = { ok: false, reason: 'no_audiveris' }
      return this.availableCache
    }

    this.availableCache = { ok: true }
    return this.availableCache
  }

  async recognize(input: RecognizeInput): Promise<OcrResult> {
    const health = await this.healthCheck()
    if (!health.ok) {
      throw new OcrError(health.reason!, `${health.reason} detected by healthCheck`)
    }

    const outDir = path.join(path.dirname(input.filePath), 'out')
    await fs.mkdir(outDir, { recursive: true })

    const child = spawn(this.config.javaBin, [
      '-jar', this.config.jarPath,
      '-batch', '-transcribe', '-export', '-sheets', '1',
      '-output', outDir,
      '--', input.filePath,
    ], {
      env: { ...process.env, TESSDATA_PREFIX: this.config.tessdataDir },
    })

    await this.runWithTimeout(child)

    // 找输出文件：优先 .mxl，回退 .xml
    const entries = await fs.readdir(outDir)
    const mxlFile = entries.find((e) => e.endsWith('.mxl'))
    const xmlFile = entries.find((e) => e.endsWith('.xml'))
    const target = mxlFile ?? xmlFile
    if (!target) {
      const listing = entries.join(', ') || '(empty)'
      throw new OcrError('no_output', 'Audiveris produced no .mxl/.xml', `outDir: ${listing}`)
    }

    const fileBytes = await fs.readFile(path.join(outDir, target))
    const xmlText = isZip(fileBytes) ? extractMxl(fileBytes) : fileBytes.toString('utf8')

    let doc: Record<string, unknown>
    try {
      doc = xmlParser.parse(xmlText)
    } catch (e) {
      throw new OcrError('no_output', 'Audiveris output is not valid XML', String(e))
    }

    const root = (doc['score-partwise'] ?? doc['score-timewise']) as
      | Record<string, unknown> | undefined
    if (!root) {
      throw new OcrError('no_output', 'Audiveris output missing <score-partwise>')
    }

    // 0 音符检测
    const noteCount = countNotes(root)
    if (noteCount === 0) {
      throw new OcrError('low_confidence', 'Audiveris output has 0 notes')
    }

    // 复用元数据提取，fallback 用文件名（去扩展名）
    const fallbackTitle = stripExt(input.filePath)
    const meta = extractMusicXmlMetadata(root, xmlText, fallbackTitle)

    return { musicXml: xmlText, meta }
  }

  // 包裹 child 进程：超时 kill + exit code 校验 + stderr 封顶
  // 抽成方法便于子类/测试覆盖
  protected async runWithTimeout(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let stderrBuf = ''
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGKILL')
        reject(new OcrError('engine_crash', 'Audiveris timed out', `${TIMEOUT_MS}ms`))
      }, TIMEOUT_MS)

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8')
        // 封顶：保留尾部
        if (stderrBuf.length > STDERR_CAP) {
          stderrBuf = stderrBuf.slice(-STDERR_CAP)
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new OcrError('engine_crash', 'Failed to spawn Audiveris', String(err)))
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) return // 已 reject
        if (code === 0) {
          resolve()
        } else {
          reject(new OcrError('engine_crash', `Audiveris exited with code ${code}`, stderrBuf.slice(-2000)))
        }
      })
    })
  }
}

function countNotes(root: Record<string, unknown>): number {
  const parts = Array.isArray(root['part']) ? root['part'] : root['part'] ? [root['part']] : []
  let count = 0
  for (const p of parts as Record<string, unknown>[]) {
    const measures = Array.isArray(p['measure']) ? p['measure'] : p['measure'] ? [p['measure']] : []
    for (const m of measures as Record<string, unknown>[]) {
      const notes = Array.isArray(m['note']) ? m['note'] : m['note'] ? [m['note']] : []
      count += notes.length
    }
  }
  return count
}

function stripExt(filePath: string): string {
  const base = path.basename(filePath)
  return base.replace(/\.[^.]+$/, '')
}
```

- [ ] **Step 4: 跑 healthCheck 测试确认通过**

Run: `cd server && npx vitest run src/ocr/__tests__/engine.test.ts`
Expected: PASS — 3 个 healthCheck 测试通过

- [ ] **Step 5: Commit（healthCheck 部分）**

```bash
cd server
git add src/ocr/engine.ts src/ocr/__tests__/engine.test.ts
git commit -m "feat(ocr): OcrEngine healthCheck (java + jar detection, cached)"
```

---

## Task 6: OcrEngine.recognize 错误码映射

继续在 engine.test.ts 加 recognize 的错误码测试，用 mock 的 spawn + 自定义 ChildProcess。

**Files:**
- Modify: `server/src/ocr/__tests__/engine.test.ts`

- [ ] **Step 1: 写 recognize 测试 —— 成功路径 + 4 种错误**

在 engine.test.ts 追加。用 EventEmitter 模拟 child process，控制 close 事件和 outDir 内容。

```typescript
import { EventEmitter } from 'node:events'
import os from 'node:os'

// helper: 创建 mock child + 模拟 outDir 文件
function mockSpawn(opts: {
  exitCode?: number
  outFiles?: Record<string, string | Buffer>  // fileName -> content
  delayMs?: number
}) {
  const child = new EventEmitter() as any
  ;(child as any).stderr = new EventEmitter()
  ;(child as any).kill = vi.fn()

  vi.mocked(childProcess.spawn).mockImplementation(() => child)

  // 异步写 outDir + emit close
  setTimeout(async () => {
    if (opts.outFiles) {
      const tmpRoot = path.join(os.tmpdir(), 'pianoscore-ocr-test')
      const outDir = path.join(tmpRoot, 'out')
      await fs.rm(outDir, { recursive: true, force: true })
      await fs.mkdir(outDir, { recursive: true })
      for (const [name, content] of Object.entries(opts.outFiles)) {
        await fs.writeFile(path.join(outDir, name), content)
      }
    }
    child.emit('close', opts.exitCode ?? 0)
  }, opts.delayMs ?? 0)

  return child
}

const NOTE_XML = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>OCR Title</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
  </measure></part>
</score-partwise>`

describe('OcrEngine.recognize', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses .xml output and extracts meta', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined) // healthCheck jar
    mockSpawn({ outFiles: { 'input.xml': NOTE_XML } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath: '/tmp/x/某曲谱.pdf', format: 'pdf',
    })
    expect(result.meta.title).toBe('OCR Title')
    expect(result.musicXml).toContain('<score-partwise')
  })

  it('uses file name as fallback title when XML has no title', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const noTitleXml = NOTE_XML.replace(
      /<work>.*?<\/work>/, '',
    )
    mockSpawn({ outFiles: { 'input.xml': noTitleXml } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath: '/tmp/x/月光奏鸣曲.pdf', format: 'pdf',
    })
    expect(result.meta.title).toBe('月光奏鸣曲')
  })

  it('throws engine_crash on non-zero exit', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const child = mockSpawn({ exitCode: 1 })
    ;(child.stderr as EventEmitter).emit('data', Buffer.from('boom'))

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath: '/tmp/x.pdf', format: 'pdf',
    })).rejects.toThrow(/engine_crash/)
  })

  it('throws no_output when outDir empty', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    mockSpawn({ outFiles: {} })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath: '/tmp/x.pdf', format: 'pdf',
    })).rejects.toThrow(/no_output/)
  })

  it('throws low_confidence when XML has 0 notes', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const emptyXml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
</score-partwise>`
    mockSpawn({ outFiles: { 'input.xml': emptyXml } })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath: '/tmp/x.pdf', format: 'pdf',
    })).rejects.toThrow(/low_confidence/)
  })
})
```

- [ ] **Step 2: 跑测试确认通过（recognize 实现已在 Task 5 Step 3 完成）**

Run: `cd server && npx vitest run src/ocr/__tests__/engine.test.ts`
Expected: PASS — 全部 8 个测试（3 healthCheck + 5 recognize）

- [ ] **Step 3: typecheck**

Run: `cd server && npm run typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
cd server
git add src/ocr/__tests__/engine.test.ts
git commit -m "test(ocr): cover recognize error codes (crash/no_output/low_confidence) + fallback title"
```

---

## Task 7: OcrRunner 状态机

把 OcrEngine 的阻塞 recognize 包成任务表里的异步生命周期。

**Files:**
- Create: `server/src/ocr/runner.ts`
- Test: `server/src/ocr/__tests__/runner.test.ts`

- [ ] **Step 1: 写失败测试 —— 状态流转**

mock OcrEngine，断言 task 表字段流转 + insertScore 被调。

```typescript
// server/src/ocr/__tests__/runner.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../db/schema.js'
import { OcrTaskRepo } from '../../db/ocrTaskRepo.js'
import { OcrRunner } from '../runner.js'
import { OcrError } from '../errors.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE scores (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, composer TEXT,
      tempo INTEGER NOT NULL DEFAULT 120, source_format TEXT NOT NULL DEFAULT 'musicxml',
      source_xml TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE ocr_tasks (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, input_format TEXT NOT NULL,
      input_file_name TEXT NOT NULL, input_path TEXT, score_id TEXT,
      error_code TEXT, error_detail TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER, completed_at INTEGER
    );
  `)
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

function mockEngine(result: { meta: any; musicXml: string } | OcrError) {
  return {
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
    recognize: vi.fn().mockImplementation(async () => {
      if (result instanceof OcrError) throw result
      return result
    }),
  }
}

describe('OcrRunner', () => {
  let close: () => void
  let repo: OcrTaskRepo

  beforeEach(() => {
    const t = makeDb()
    repo = new OcrTaskRepo(t.db)
    close = t.close
    // 暂存到全局供各 it 使用
    ;(globalThis as any).__testDb = t.db
  })
  afterEach(() => { close(); delete (globalThis as any).__testDb })

  it('happy path: pending → running → done with scoreId', async () => {
    const db = (globalThis as any).__testDb
    const engine = mockEngine({ meta: { title: 'T', tempo: 100 }, musicXml: '<xml/>' })
    const runner = new OcrRunner(db, engine as any, repo)

    const taskId = runner.start({ filePath: '/tmp/a.pdf', format: 'pdf', fileName: 'a.pdf' })
    // start 触发异步 run，等它完成
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('done')
    expect(task.scoreId).toBeTruthy()
  })

  it('failure: marks failed with error code', async () => {
    const db = (globalThis as any).__testDb
    const engine = mockEngine(new OcrError('engine_crash', 'boom', 'detail'))
    const runner = new OcrRunner(db, engine as any, repo)

    const taskId = runner.start({ filePath: '/tmp/a.pdf', format: 'pdf', fileName: 'a.pdf' })
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('engine_crash')
    expect(task.errorDetail).toBe('detail')
  })

  it('healthCheck failure → failed with no_java', async () => {
    const db = (globalThis as any).__testDb
    const engine = {
      healthCheck: vi.fn().mockResolvedValue({ ok: false, reason: 'no_java' }),
      recognize: vi.fn(),
    }
    const runner = new OcrRunner(db, engine as any, repo)

    const taskId = runner.start({ filePath: '/tmp/a.pdf', format: 'pdf', fileName: 'a.pdf' })
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('no_java')
    expect(engine.recognize).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/ocr/__tests__/runner.test.ts`
Expected: FAIL — "Cannot find module '../runner.js'"

- [ ] **Step 3: 实现 OcrRunner**

```typescript
// server/src/ocr/runner.ts
import { insertScore } from '../db/repo.js'
import { OcrTaskRepo, type CreateTaskInput } from '../db/ocrTaskRepo.js'
import type { OcrEngine } from './engine.js'
import { OcrError } from './errors.js'
import type { Db } from '../db/client.js'

export interface StartInput extends CreateTaskInput {
  filePath: string
  format: 'pdf' | 'image'
}

export class OcrRunner {
  private active = new Map<string, { taskId: string; resolve: () => void }>()

  constructor(
    private db: Db,
    private engine: OcrEngine,
    private repo: OcrTaskRepo,
  ) {}

  start(input: StartInput): string {
    const taskId = this.repo.create(input)
    // 异步跑，不 await（路由立即返回 taskId）
    this.run(taskId, input).catch((err) => {
      // 兜底：run 内部已处理 OcrError；这里是未预期错误
      this.repo.markFailed(taskId, 'engine_crash', `unexpected: ${String(err)}`)
    })
    return taskId
  }

  // 测试用：等待任务到达终态
  async waitForTask(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      this.active.set(taskId, { taskId, resolve })
    })
  }

  private async run(taskId: string, input: StartInput): Promise<void> {
    const health = await this.engine.healthCheck()
    if (!health.ok) {
      this.repo.markFailed(taskId, health.reason!, 'healthCheck failed')
      this.resolve(taskId)
      return
    }

    this.repo.markRunning(taskId)
    try {
      const result = await this.engine.recognize({
        taskId,
        filePath: input.filePath,
        format: input.format,
      })
      const scoreId = insertScore(this.db, {
        title: result.meta.title,
        composer: result.meta.composer,
        tempo: result.meta.tempo,
        sourceXml: result.musicXml,
      }, { sourceFormat: 'ocr' })
      this.repo.markDone(taskId, scoreId)
    } catch (err) {
      if (err instanceof OcrError) {
        this.repo.markFailed(taskId, err.code, err.detail)
      } else {
        this.repo.markFailed(taskId, 'engine_crash', String(err))
      }
    } finally {
      this.resolve(taskId)
    }
  }

  private resolve(taskId: string): void {
    this.active.get(taskId)?.resolve()
    this.active.delete(taskId)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/ocr/__tests__/runner.test.ts`
Expected: PASS — 3 个测试

- [ ] **Step 5: typecheck + Commit**

Run: `cd server && npm run typecheck`

```bash
cd server
git add src/ocr/runner.ts src/ocr/__tests__/runner.test.ts
git commit -m "feat(ocr): OcrRunner state machine (pending→running→done/failed + scoreId backfill)"
```

---

## Task 8: OCR 路由 + 409 串行

3 个端点 + 409 并发拒绝。

**Files:**
- Create: `server/src/routes/ocr.ts`
- Test: `server/src/routes/__tests__/ocr.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// server/src/routes/__tests__/ocr.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestApp, TEST_MUSICXML } from './helpers.js'
import type { TestApp } from './helpers.js'
import * as ocrHelpers from '../../ocr/runner.js'

// 注入 mock runner，避免真实 spawn
vi.mock('../../ocr/runner.js', () => {
  return {
    OcrRunner: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockImplementation((input) => {
        // 模拟立即成功：往 db 插 score + 标 done
        // 但为隔离测试，这里只返回 fake taskId，状态由 createTestApp 的 mock 控制
        return 'fake-task-id'
      }),
    })),
  }
})

describe('OCR API', () => {
  let test: TestApp
  beforeEach(() => { test = createTestApp() })
  afterEach(() => { test.close() })

  it('POST /api/ocr rejects non-PDF/image', async () => {
    const fd = new FormData()
    fd.append('file', new File(['x'], 'a.txt', { type: 'text/plain' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('POST /api/ocr rejects oversized file', async () => {
    const big = new Uint8Array(21 * 1024 * 1024)
    const fd = new FormData()
    fd.append('file', new File([big], 'a.pdf', { type: 'application/pdf' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('POST /api/ocr accepts PDF and returns taskId', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([0x25, 0x50])], 'a.pdf', { type: 'application/pdf' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.taskId).toBeTruthy()
    expect(body.status).toBe('pending')
  })

  it('GET /api/ocr/:id returns 404 for unknown', async () => {
    const res = await test.app.request('/api/ocr/nonexistent')
    expect(res.status).toBe(404)
  })

  it('GET /api/health returns ocr availability', async () => {
    const res = await test.app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveProperty('ocr')
    expect(body.ocr).toHaveProperty('available')
  })
})
```

注意：`createTestApp` 当前不挂载 ocr 路由。需要在 helpers.ts 改造或测试内手动挂——这里用测试内注入。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/routes/__tests__/ocr.test.ts`
Expected: FAIL — 路由未挂载

- [ ] **Step 3: 实现 ocr 路由**

```typescript
// server/src/routes/ocr.ts
import { Hono } from 'hono'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Db } from '../db/client.js'
import { OcrTaskRepo } from '../db/ocrTaskRepo.js'
import { OcrEngine } from '../ocr/engine.js'
import { OcrRunner } from '../ocr/runner.js'
import { loadOcrConfig } from '../ocr/config.js'

const MAX_BYTES = 20 * 1024 * 1024 // 20MB
const ALLOWED_EXT: Record<string, 'pdf' | 'image'> = {
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
}

export function createOcrRoute(db: Db, engine: OcrEngine, runner: OcrRunner): Hono {
  const repo = new OcrTaskRepo(db)
  const route = new Hono()

  route.post('/', async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']
    if (!(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400)
    }

    const name = file.name.toLowerCase()
    const matched = Object.entries(ALLOWED_EXT).find(([ext]) => name.endsWith(ext))
    if (!matched) {
      return c.json({ error: 'Unsupported file type', detail: `Allowed: ${Object.keys(ALLOWED_EXT).join(', ')}` }, 400)
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: 'File too large', detail: 'Max 20MB' }, 400)
    }

    // 409 串行约束
    const active = repo.findActive()
    if (active) {
      return c.json({ error: 'An OCR task is already running', activeTaskId: active.id }, 409)
    }

    // 写临时文件
    const taskId = crypto.randomUUID()
    const taskDir = path.join(os.tmpdir(), 'pianoscore-ocr', taskId)
    const ext = path.extname(file.name)
    const inputPath = path.join(taskDir, `input${ext}`)
    await fs.mkdir(taskDir, { recursive: true })
    await fs.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))

    const ocrTaskId = runner.start({
      filePath: inputPath,
      format: matched[1],
      inputFormat: matched[1] === 'pdf' ? 'pdf' : ext.slice(1),
      inputFileName: file.name,
      inputPath,
    })

    return c.json({ taskId: ocrTaskId, status: 'pending' }, 201)
  })

  route.get('/:id', (c) => {
    const task = repo.get(c.req.param('id'))
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const elapsedMs = task.startedAt
      ? (task.completedAt ?? Math.floor(Date.now() / 1000)) - task.startedAt
      : 0

    if (task.status === 'done') {
      return c.json({ status: 'done', scoreId: task.scoreId })
    }
    if (task.status === 'failed') {
      return c.json({ status: 'failed', errorCode: task.errorCode, errorDetail: task.errorDetail })
    }
    return c.json({ status: task.status, inputFileName: task.inputFileName, elapsedMs: elapsedMs * 1000 })
  })

  route.delete('/:id', (c) => {
    const id = c.req.param('id')
    const task = repo.get(id)
    if (task?.inputPath) {
      const dir = path.dirname(task.inputPath)
      fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    const deleted = repo.delete(id)
    return c.json({ deleted })
  })

  return route
}
```

- [ ] **Step 4: 修改 helpers.ts 挂载 ocr 路由**

helpers.ts 的 `createTestApp` 需要挂 ocr 路由 + 提供 engine/runner。改为接受可选注入，便于测试传 mock。修改 helpers.ts：

```typescript
// 在 createTestApp 签名加可选参数
export function createTestApp(ocr?: { engine: any; runner: any }): TestApp {
  // ... 原有建表 + scores/sessions/import 路由 ...

  if (ocr) {
    app.route('/api/ocr', createOcrRoute(db, ocr.engine, ocr.runner))
  }
  // ... 其余不变 ...
}
```

并在 helpers.ts 顶部 import `createOcrRoute`。

由于 mock runner 测试方式复杂，**简化策略**：ocr.test.ts 直接用真实 OcrTaskRepo + 一个内联的 mock runner 对象，不依赖 vi.mock。重写 ocr.test.ts Step 1 的注入为构造真实组件但 engine mock：

```typescript
// 修改 ocr.test.ts 顶部，去掉 vi.mock，改用 helper 注入
import { OcrEngine } from '../../ocr/engine.js'

function makeMockRunner() {
  const tasks: Record<string, any> = {}
  return {
    start: vi.fn().mockImplementation((input: any) => {
      const id = crypto.randomUUID()
      tasks[id] = { status: 'pending', input }
      return id
    }),
    _tasks: tasks,
  }
}
```

并在每个测试 `createTestApp({ engine: new OcrEngine(config), runner: makeMockRunner() })`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && npx vitest run src/routes/__tests__/ocr.test.ts`
Expected: PASS

- [ ] **Step 6: typecheck + Commit**

Run: `cd server && npm run typecheck`

```bash
cd server
git add src/routes/ocr.ts src/routes/__tests__/ocr.test.ts src/routes/__tests__/helpers.ts
git commit -m "feat(routes): OCR endpoints (POST/GET/DELETE) with 409 serial constraint"
```

---

## Task 9: 扩展 /api/health + index.ts 挂载

把现有 `/api/health`（返回 `{ status: 'healthy' }`）扩展为含 OCR 可用性，并挂载 ocr 路由。

**Files:**
- Modify: `server/src/index.ts:22, 25-27`

- [ ] **Step 1: 修改 index.ts**

```typescript
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { db } from './db/instance.js'
import { createScoresRoute } from './routes/scores.js'
import { createSessionsRoute } from './routes/sessions.js'
import { createImportRoute } from './routes/import.js'
import { createOcrRoute } from './routes/ocr.js'
import { OcrEngine } from './ocr/engine.js'
import { OcrRunner } from './ocr/runner.js'
import { OcrTaskRepo } from './db/ocrTaskRepo.js'
import { loadOcrConfig } from './ocr/config.js'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)

const ocrConfig = loadOcrConfig()
const ocrEngine = new OcrEngine(ocrConfig)
const ocrTaskRepo = new OcrTaskRepo(db)
const ocrRunner = new OcrRunner(db, ocrEngine, ocrTaskRepo)

// 启动时异步跑 healthCheck，缓存结果供 /api/health
let ocrHealth = { ok: false, reason: 'no_audiveris' as const }
ocrEngine.healthCheck().then((r) => { ocrHealth = r })

app.get('/api/health', async (c) => {
  const ocr = await ocrEngine.healthCheck()
  return c.json({ status: 'healthy', ocr: { available: ocr.ok, reason: ocr.reason } })
})

// Business routes
app.route('/api/scores', createScoresRoute(db))
app.route('/api/scores', createSessionsRoute(db))
app.route('/api/import', createImportRoute(db))
app.route('/api/ocr', createOcrRoute(db, ocrEngine, ocrRunner))

const port = 8000
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PianoScore server on http://localhost:${info.port}`)
})

export { app }
```

- [ ] **Step 2: typecheck**

Run: `cd server && npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 全量测试**

Run: `cd server && npm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
cd server
git add src/index.ts
git commit -m "feat(server): extend /api/health with OCR availability + mount /api/ocr route"
```

---

## Task 10: AGPL 合规文件

**Files:**
- Create: `LICENSE-THIRD-PARTY.md`
- Create: `LICENSES/AGPL-3.0.txt`
- Modify: `LICENSE`（顶部加声明段）
- Modify: `README.md`（加第三方组件章节）

- [ ] **Step 1: 创建 LICENSES/AGPL-3.0.txt**

从 https://www.gnu.org/licenses/agpl-3.0.txt 下载全文存入。这是 AGPL-3.0 的官方标准全文，逐字复制。

Run（在仓库根目录）：
```bash
curl -s https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSES/AGPL-3.0.txt
```

- [ ] **Step 2: 创建 LICENSE-THIRD-PARTY.md**

```markdown
# Third-Party Licenses

PianoScore integrates the following third-party components. Each is a
**separate work**, invoked as an independent process (arm's length),
not linked into PianoScore's source.

## Audiveris

- **Purpose:** Optical Music Recognition (OMR) — converts PDF/images of
  sheet music to MusicXML.
- **License:** GNU Affero General Public License v3.0 (AGPL-3.0)
- **Source:** https://github.com/Audiveris/audiveris
- **Integration model:** PianoScore spawns Audiveris as an independent
  `java` subprocess via `child_process.spawn`. PianoScore does **not**
  import, link, or modify any Audiveris Java class. Communication is via
  the filesystem only (input PDF → output MusicXML).
- **License text:** See `LICENSES/AGPL-3.0.txt`
- **Compliance note:** Per the AGPL-3.0, the complete corresponding
  source code of Audiveris is available at the source link above.
  PianoScore uses the official, unmodified release jar.

## Tesseract OCR (via Audiveris)

- **Purpose:** Text recognition engine, bundled within Audiveris.
- **License:** Apache License 2.0
- **Source:** https://github.com/tesseract-ocr/tesseract
- **Note:** Used transitively by Audiveris. Not invoked directly by
  PianoScore.

---

**Legal disclaimer:** The process-isolation model above is the
GPL/AGPL community's accepted boundary for non-derivative works, but
has not been tested in court. Projects integrating AGPL components
should consult their own legal counsel.
```

- [ ] **Step 3: LICENSE 顶部加声明段**

在 LICENSE 文件最顶部（MIT 标题之前）追加：

```markdown
> PianoScore itself is licensed under the MIT License (below). Third-party
> components integrated as independent processes are listed in
> `LICENSE-THIRD-PARTY.md` and retain their original licenses.

```

- [ ] **Step 4: README.md 加"第三方组件"章节**

在 README 合适位置（如安装说明之后）加：

```markdown
## 第三方组件 (Third-Party Components)

PianoScore 通过子进程（`child_process.spawn`）方式集成以下 OMR 引擎，
作为独立工作调用，不修改其源码：

- **[Audiveris](https://github.com/Audiveris/audiveris)** (AGPL-3.0)：乐谱图像识别。
  PianoScore 不链接 Audiveris 代码，仅通过文件系统交换数据（输入 PDF → 输出 MusicXML）。
  许可证与源码获取详见 `LICENSE-THIRD-PARTY.md`。

> AGPL-3.0 是强 copyleft 许可证。本项目基于"进程隔离"原则集成，保留 MIT 许可。
> 商业部署请咨询法务。
```

- [ ] **Step 5: Commit**

```bash
git add LICENSES/AGPL-3.0.txt LICENSE-THIRD-PARTY.md LICENSE README.md
git commit -m "docs(license): AGPL compliance for Audiveris integration (process isolation, keep MIT)"
```

---

## Task 11: 第二层集成测试（带 Java 守卫）

真实跑 Audiveris 的集成测试，skipIf 守卫（无 jar 环境跳过）。

**Files:**
- Create: `server/src/ocr/__tests__/integration.test.ts`
- 需要测试资产：`server/test-fixtures/score-ocr.pdf`（小段简单旋律）、`server/test-fixtures/not-score.txt`（纯文字）

- [ ] **Step 1: 准备测试 fixture（需手动）**

这一步需要人工准备两份 PDF：
- `server/test-fixtures/score-ocr.pdf`：单谱表、C 大调四分音符音阶 4-8 个音符。可用 MuseScore 导出 PDF，或从公开免版税乐谱截取单页。**关键是简单到 Audiveris 几乎不会认错。**
- `server/test-fixtures/not-score.txt`：改名为 `.pdf` 扩展名的纯文字文件（或真实文字 PDF），用于断言 no_output/low_confidence。

在 README 或此处记录 fixture 来源。**若暂时无法准备，标记此 Task 为 blocked，先做 Task 12 验收。**

- [ ] **Step 2: 写集成测试**

```typescript
// server/src/ocr/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { OcrEngine } from '../engine.js'
import { OcrError } from '../errors.js'

const JAR = process.env.PIANOSCORE_AUDIVERIS_JAR

// 无 jar 则跳过整个 describe
const describeOrSkip = JAR ? describe : describe.skip

describeOrSkip('OcrEngine integration (real Audiveris)', () => {
  const engine = new OcrEngine({
    javaBin: process.env.PIANOSCORE_JAVA ?? 'java',
    jarPath: JAR!,
    tessdataDir: process.env.PIANOSCORE_TESSDATA,
    dbPath: '/dev/null',
  })

  it('recognizes a simple score PDF', async () => {
    const pdfPath = path.join(__dirname, '../../../test-fixtures/score-ocr.pdf')
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(pdfPath, inputPath)

    const result = await engine.recognize({ taskId: 'it1', filePath: inputPath, format: 'pdf' })
    expect(result.musicXml).toContain('<score-partwise')
    expect(result.meta.tempo).toBeGreaterThan(0)

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000) // 60s 超时

  it('fails on non-score input', async () => {
    const pdfPath = path.join(__dirname, '../../../test-fixtures/not-score.pdf')
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(pdfPath, inputPath)

    await expect(engine.recognize({ taskId: 'it2', filePath: inputPath, format: 'pdf' }))
      .rejects.toThrow()

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000)
})
```

- [ ] **Step 3: 跑测试（无 jar 应跳过）**

Run: `cd server && npx vitest run src/ocr/__tests__/integration.test.ts`
Expected: 无 jar 时 SKIP（输出 "skipped"），有 jar 时 PASS

- [ ] **Step 4: Commit**

```bash
cd server
git add src/ocr/__tests__/integration.test.ts
git commit -m "test(ocr): integration test with Java skipIf guard (needs PIANOSCORE_AUDIVERIS_JAR)"
```

---

## Task 12: 全量验收

- [ ] **Step 1: 全量测试 + typecheck**

Run: `cd server && npm test && npm run typecheck`
Expected: 全部通过（集成测试 skip）

- [ ] **Step 2: drizzle-kit 同步 schema 到真实 db**

Run: `cd server && npm run db:push`
Expected: drizzle-kit 检测到 ocr_tasks 新表，提示确认，推送

- [ ] **Step 3: 手动验收（需本机 Java + jar）**

设置环境变量并启动：
```bash
# 仓库根放 audiveris.jar（或设环境变量指向任意路径）
export PIANOSCORE_AUDIVERIS_JAR=/path/to/audiveris.jar
cd server && npm run dev
```

另开终端用 curl 验收：
```bash
# 1. health
curl http://localhost:8000/api/health
# 期望: {"status":"healthy","ocr":{"available":true}}

# 2. 创建识别任务（用一份真实乐谱 PDF）
curl -X POST http://localhost:8000/api/ocr \
  -F "file=@/path/to/score.pdf"
# 期望: {"taskId":"...","status":"pending"}

# 3. 轮询
curl http://localhost:8000/api/ocr/<taskId>
# done: {"status":"done","scoreId":"..."}

# 4. 验证 score 入库（sourceFormat=ocr）
curl http://localhost:8000/api/scores
# 期望返回的 score 含 "sourceFormat":"ocr"
```

- [ ] **Step 4: 最终 commit（如有验收发现的修复）**

```bash
git add -A
git commit -m "chore: phase A verification complete"
```

---

## Self-Review checklist

完成所有 task 后对照检查：

- [ ] spec 第 3 节（ocr_tasks 表）→ Task 2 ✓
- [ ] spec 第 3.2-3.3 节（sourceFormat 链路）→ Task 2 ✓
- [ ] spec 第 4 节（3 端点 + health + 409）→ Task 8 + 9 ✓
- [ ] spec 第 6 节（OcrEngine + recognize + 5 错误码）→ Task 5 + 6 ✓
- [ ] spec 第 6.4 节（OcrRunner 状态机）→ Task 7 ✓
- [ ] spec 第 9 节（AGPL 合规）→ Task 10 ✓
- [ ] spec 第 10.2 节（集成测试）→ Task 11 ✓
- [ ] Open Question（extractMetadata 导出）→ Task 1 ✓
