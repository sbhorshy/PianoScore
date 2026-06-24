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
| `LICENSE` | 新建 | 项目 MIT 许可证 + 第三方指引（仓库当前无 LICENSE 文件，本任务一并补建） |

---

## Task 1: 导出 musicxml.ts 的复用函数

OcrEngine 读 Audiveris 的 `.mxl` 输出需要复用现有的 ZIP 解压和元数据提取逻辑。目前 `extractMxl`、`isZip`、`extractMetadata` 都是私有函数。

**Files:**
- Modify: `server/src/parsing/musicxml.ts:23-94`
- Test: `server/src/parsing/musicxml.test.ts`

- [ ] **Step 1: 写失败测试 —— extractMxl/isZip 可导入且行为不变**

在 `musicxml.test.ts` 顶部 import 区追加，并在 `describe('MusicXmlParser')` 块**之后**追加新 describe：

```typescript
import { isZip, extractMusicXmlMetadata } from './musicxml'

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
    const body = (await res.json()) as { scores: Array<Record<string, unknown>> }
    expect(body.scores[0]).toHaveProperty('sourceFormat')
    expect(body.scores[0].sourceFormat).toBe('musicxml')
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

  it('updates inputPath after creation', () => {
    const id = repo.create({ inputFormat: 'pdf', inputFileName: 'a.pdf' })
    expect(repo.get(id)!.inputPath).toBeNull()
    repo.updateInputPath(id, '/tmp/a.pdf')
    expect(repo.get(id)!.inputPath).toBe('/tmp/a.pdf')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/db/__tests__/ocrTaskRepo.test.ts`
Expected: FAIL — "Cannot find module '../ocrTaskRepo.js'"

- [ ] **Step 3: 实现 OcrTaskRepo**

```typescript
// server/src/db/ocrTaskRepo.ts
import { eq, or } from 'drizzle-orm'
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

  // reservation 后写完临时文件回填路径
  updateInputPath(id: string, inputPath: string): void {
    this.db.update(ocrTasks).set({ inputPath }).where(eq(ocrTasks.id, id)).run()
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
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { extractMxl, isZip, extractMusicXmlMetadata } from '../parsing/musicxml.js'
import { OcrError } from './errors.js'
import type { ErrorCode } from './errors.js'
import type { OcrConfig } from './config.js'

export interface RecognizeInput {
  taskId: string
  filePath: string
  format: 'pdf' | 'image'
  fallbackTitle: string  // 上传文件名去扩展名，用于无标题乐谱的元数据回退
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
  private currentChild: ChildProcess | null = null

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

    // 复用元数据提取，fallback 用调用方传入的上传文件名
    const meta = extractMusicXmlMetadata(root, xmlText, input.fallbackTitle)

    return { musicXml: xmlText, meta }
  }

  // 外部（OcrRunner.cancel）终止运行中的进程
  cancel(): void {
    this.currentChild?.kill('SIGKILL')
  }

  // 包裹 child 进程：超时 kill + exit code 校验 + stderr 封顶
  // 抽成方法便于子类/测试覆盖
  protected async runWithTimeout(child: ChildProcess): Promise<void> {
    this.currentChild = child
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
// outFiles 写到与 recognize 实现读取一致的目录：path.dirname(filePath)/out
async function mockSpawn(
  filePath: string,
  opts: {
    exitCode?: number
    outFiles?: Record<string, string | Buffer>  // fileName -> content
    delayMs?: number
  },
) {
  const child = new EventEmitter() as never as import('node:child_process').ChildProcess
  ;(child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter()
  ;(child as unknown as { kill: unknown }).kill = vi.fn()

  vi.mocked(childProcess.spawn).mockImplementation(() => child)

  setTimeout(async () => {
    if (opts.outFiles) {
      // 关键：写到实现实际读取的目录 dirname(filePath)/out
      const outDir = path.join(path.dirname(filePath), 'out')
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

  // 用唯一临时文件路径，确保 outDir 真实可写且 mock 与实现读到同一目录
  const filePath = path.join(os.tmpdir(), `pianoscore-engine-test/input.pdf`)

  it('parses .xml output and extracts meta', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined) // healthCheck jar
    await mockSpawn(filePath, { outFiles: { 'input.xml': NOTE_XML } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '某曲谱',
    })
    expect(result.meta.title).toBe('OCR Title')
    expect(result.musicXml).toContain('<score-partwise')
  })

  it('uses fallbackTitle when XML has no title', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const noTitleXml = NOTE_XML.replace(
      /<work>.*?<\/work>/, '',
    )
    await mockSpawn(filePath, { outFiles: { 'input.xml': noTitleXml } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '月光奏鸣曲',
    })
    expect(result.meta.title).toBe('月光奏鸣曲')
  })

  it('throws engine_crash on non-zero exit', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const child = await mockSpawn(filePath, { exitCode: 1 })
    ;((child as unknown as { stderr: EventEmitter }).stderr).emit('data', Buffer.from('boom'))

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toThrow(/engine_crash/)
  })

  it('throws no_output when outDir empty', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    await mockSpawn(filePath, { outFiles: {} })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toThrow(/no_output/)
  })

  it('throws low_confidence when XML has 0 notes', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    const emptyXml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes></measure></part>
</score-partwise>`
    await mockSpawn(filePath, { outFiles: { 'input.xml': emptyXml } })

    const engine = new OcrEngine(validConfig)
    await expect(engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: 'x',
    })).rejects.toThrow(/low_confidence/)
  })
})
```

- [ ] **Step 2: 跑测试确认通过（recognize 实现已在 Task 5 Step 3 完成）**

Run: `cd server && npx vitest run src/ocr/__tests__/engine.test.ts`
Expected: PASS — 全部 9 个测试（3 healthCheck + 6 recognize）

- [ ] **Step 2b: 加 .mxl 主路径测试（Audiveris 默认输出格式）**

`.mxl` 是压缩 MusicXML（ZIP）。测试需构造一个真实可被 `extractMxl()` 解压的 zip。用 fflate 的 `zipSync` 现场打包：

在 engine.test.ts 顶部 import 区追加：

```typescript
import { zipSync, strToU8 } from 'fflate'
```

在 `describe('OcrEngine.recognize')` 块末尾追加：

```typescript
  it('parses .mxl (zipped) output — Audiveris default format', async () => {
    vi.spyOn(fs, 'access').mockResolvedValue(undefined)
    // 构造符合 .mxl 规范的 zip：META-INF/container.xml + 根文档
    const containerXml = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`
    const zip = zipSync({
      'META-INF/container.xml': strToU8(containerXml),
      'score.xml': strToU8(NOTE_XML),
    })
    await mockSpawn(filePath, { outFiles: { 'input.mxl': Buffer.from(zip) } })

    const engine = new OcrEngine(validConfig)
    const result = await engine.recognize({
      taskId: 't1', filePath, format: 'pdf', fallbackTitle: '某曲谱',
    })
    expect(result.meta.title).toBe('OCR Title')
    expect(result.musicXml).toContain('<score-partwise')
    expect(result.musicXml).toContain('C</step>')  // note 解压后可读
  })
```

Run: `cd server && npx vitest run src/ocr/__tests__/engine.test.ts`
Expected: PASS — 10 个测试

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
  let db: ReturnType<typeof makeDb>['db']

  beforeEach(() => {
    const t = makeDb()
    db = t.db
    repo = new OcrTaskRepo(db)
    close = t.close
  })
  afterEach(() => { close() })

  // 路由 reservation 建好 pending 行后，用 taskId 启动 runner
  function startTask(runner: OcrRunner, fileName = 'a.pdf') {
    const taskId = repo.create({ inputFormat: 'pdf', inputFileName: fileName, inputPath: '/tmp/a.pdf' })
    runner.start({
      taskId,
      filePath: '/tmp/a.pdf',
      format: 'pdf',
      fallbackTitle: fileName.replace(/\.[^.]+$/, ''),
      inputFileName: fileName,
    })
    return taskId
  }

  it('happy path: pending → running → done with scoreId', async () => {
    const engine = mockEngine({ meta: { title: 'T', tempo: 100 }, musicXml: '<xml/>' })
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('done')
    expect(task.scoreId).toBeTruthy()
  })

  it('failure: marks failed with error code', async () => {
    const engine = mockEngine(new OcrError('engine_crash', 'boom', 'detail'))
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('engine_crash')
    expect(task.errorDetail).toBe('detail')
  })

  it('healthCheck failure → failed with no_java', async () => {
    const engine = {
      healthCheck: vi.fn().mockResolvedValue({ ok: false, reason: 'no_java' }),
      recognize: vi.fn(),
      cancel: vi.fn(),
    }
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    await runner.waitForTask(taskId)

    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorCode).toBe('no_java')
    expect(engine.recognize).not.toHaveBeenCalled()
  })

  it('cancel kills engine and marks failed', async () => {
    const engine = {
      healthCheck: vi.fn().mockResolvedValue({ ok: true }),
      recognize: vi.fn().mockImplementation(() => new Promise(() => {})), // 永不 resolve
      cancel: vi.fn(),
    }
    const runner = new OcrRunner(db, engine as never, repo)

    const taskId = startTask(runner)
    // 等一拍让 running 状态就绪
    await new Promise((r) => setTimeout(r, 10))
    runner.cancel(taskId)
    await runner.waitForTask(taskId)

    expect(engine.cancel).toHaveBeenCalled()
    const task = repo.get(taskId)!
    expect(task.status).toBe('failed')
    expect(task.errorDetail).toBe('cancelled by user')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/ocr/__tests__/runner.test.ts`
Expected: FAIL — "Cannot find module '../runner.js'"

- [ ] **Step 3: 实现 OcrRunner**

```typescript
// server/src/ocr/runner.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { insertScore } from '../db/repo.js'
import { OcrTaskRepo } from '../db/ocrTaskRepo.js'
import type { OcrEngine } from './engine.js'
import { OcrError } from './errors.js'
import type { Db } from '../db/client.js'

export interface StartInput {
  taskId: string          // 由路由 reservation 创建后传入
  filePath: string
  format: 'pdf' | 'image'
  fallbackTitle: string
  inputFileName: string
}

export class OcrRunner {
  // taskId -> resolve（测试用 waitForTask；也用于 cancel 后清理）
  private waiters = new Map<string, () => void>()

  constructor(
    private db: Db,
    private engine: OcrEngine,
    private repo: OcrTaskRepo,
  ) {}

  // 路由先 reservation（事务建 pending 行 + 409 检查）拿到 taskId，
  // 再写文件，最后调 start 启动异步识别。
  start(input: StartInput): void {
    this.run(input).catch((err) => {
      this.repo.markFailed(input.taskId, 'engine_crash', `unexpected: ${String(err)}`)
      this.cleanup(input.taskId, input.filePath)
      this.resolve(input.taskId)
    })
  }

  // 终止运行中的任务：kill 进程 + 标 failed + 清理。
  // 由 DELETE /api/ocr/:id 调用。
  cancel(taskId: string): void {
    this.engine.cancel()  // kill child（若在运行）
    const task = this.repo.get(taskId)
    if (task && (task.status === 'pending' || task.status === 'running')) {
      this.repo.markFailed(taskId, 'engine_crash', 'cancelled by user')
    }
    if (task?.inputPath) this.cleanup(taskId, task.inputPath)
    this.resolve(taskId)
  }

  // 测试用：等待任务到达终态
  async waitForTask(taskId: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.set(taskId, resolve)
    })
  }

  private async run(input: StartInput): Promise<void> {
    const { taskId, filePath, format, fallbackTitle } = input

    const health = await this.engine.healthCheck()
    if (!health.ok) {
      this.repo.markFailed(taskId, health.reason!, 'healthCheck failed')
      this.cleanup(taskId, filePath)
      this.resolve(taskId)
      return
    }

    this.repo.markRunning(taskId)
    try {
      const result = await this.engine.recognize({
        taskId, filePath, format, fallbackTitle,
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
      this.cleanup(taskId, filePath)
      this.resolve(taskId)
    }
  }

  // 删除临时文件所在的任务目录（dirname(filePath)）
  private cleanup(taskId: string, filePath: string): void {
    const dir = path.dirname(filePath)
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  private resolve(taskId: string): void {
    this.waiters.get(taskId)?.()
    this.waiters.delete(taskId)
  }
}
```

注意 `cleanup` 用 fire-and-forget（不 await）—— 目录清理是尽力而为，不阻塞响应。任务终态（done/failed/cancelled）后统一清理。

**reservation 放在路由层而非 runner**：因为 409 检查 + 建 pending 行 + 写文件是请求处理的一部分，必须同步完成才能返回 201。runner 只负责已建好的 taskId 的异步执行。这样消除了 review 指出的"findActive 与 create 之间的竞态窗口"——reservation 在路由内是同步的事务化操作。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/ocr/__tests__/runner.test.ts`
Expected: PASS — 3 个测试

- [ ] **Step 5: typecheck + Commit**

Run: `cd server && npm run typecheck`

```bash
cd server
git add src/ocr/runner.ts src/ocr/__tests__/runner.test.ts
git commit -m "feat(ocr): OcrRunner state machine + cancel + cleanup (pending→running→done/failed)"
```

---

## Task 8: OCR 路由 + 409 串行

3 个端点 + 409 并发拒绝。

**Files:**
- Create: `server/src/routes/ocr.ts`
- Test: `server/src/routes/__tests__/ocr.test.ts`

- [ ] **Step 1: 写失败测试（最终形态，用真实 repo + mock runner）**

不用 `vi.mock` 模块级 mock（与 verbatimModuleSyntax 冲突风险），改用 helper 注入真实 OcrTaskRepo + 手工 mock runner。

```typescript
// server/src/routes/__tests__/ocr.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestApp } from './helpers.js'
import type { TestApp } from './helpers.js'
import { OcrEngine } from '../../ocr/engine.js'

// healthCheck 永远成功的真实 engine（配 fake path，不实际 spawn）
const fakeConfig = {
  javaBin: '/fake/java', jarPath: '/fake/audiveris.jar',
  tessdataDir: '/fake/tessdata', dbPath: ':memory:',
}

function makeMockRunner() {
  return {
    start: vi.fn(),
    cancel: vi.fn(),
  }
}

describe('OCR API', () => {
  let test: TestApp
  beforeEach(() => {
    const engine = new OcrEngine(fakeConfig)
    // 让 healthCheck 返回 ok=true（绕过真实 java 检测）
    vi.spyOn(engine, 'healthCheck').mockResolvedValue({ ok: true })
    test = createTestApp({ engine, runner: makeMockRunner() })
  })
  afterEach(() => { test.close(); vi.restoreAllMocks() })

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
    fd.append('file', new File([new Uint8Array([0x25, 0x50])], 'score.pdf', { type: 'application/pdf' }))
    const res = await test.app.request('/api/ocr', { method: 'POST', body: fd })
    expect(res.status).toBe(201)
    const body = await res.json() as { taskId: string; status: string }
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
    const body = await res.json() as { ocr: { available: boolean } }
    expect(body.ocr).toBeDefined()
    expect(body.ocr.available).toBe(true) // healthCheck 被 mock 为 ok
  })

  it('DELETE /api/ocr/:id calls runner.cancel', async () => {
    const engine = new OcrEngine(fakeConfig)
    vi.spyOn(engine, 'healthCheck').mockResolvedValue({ ok: true })
    const runner = makeMockRunner()
    // 这个测试用自己的 engine/runner 实例，绕过 beforeEach 的 test app
    const localTest = createTestApp({ engine, runner })

    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([0x25, 0x50])], 'a.pdf', { type: 'application/pdf' }))
    const createRes = await localTest.app.request('/api/ocr', { method: 'POST', body: fd })
    const { taskId } = await createRes.json() as { taskId: string }

    const res = await localTest.app.request(`/api/ocr/${taskId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(runner.cancel).toHaveBeenCalledWith(taskId)
    localTest.close()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/routes/__tests__/ocr.test.ts`
Expected: FAIL — `createTestApp` 不接受参数 / ocr + health 路由未挂载

- [ ] **Step 3: 实现 ocr 路由（含 reservation）**

关键：reservation 把"409 检查 + 建 pending 行"做成同步操作，消除竞态窗口。先 reservation 拿 taskId，再写文件，再 start runner。

```typescript
// server/src/routes/ocr.ts
import { Hono } from 'hono'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Db } from '../db/client.js'
import { OcrTaskRepo } from '../db/ocrTaskRepo.js'
import type { OcrEngine } from '../ocr/engine.js'
import type { OcrRunner } from '../ocr/runner.js'

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

    // === Reservation：同步事务化，消除 findActive/create 竞态 ===
    // SQLite better-sqlite3 本身同步，findActive + create 在同一事件循环 tick 内完成，
    // 不会有其他请求插入。先检查再创建。
    const active = repo.findActive()
    if (active) {
      return c.json({ error: 'An OCR task is already running', activeTaskId: active.id }, 409)
    }
    const ext = path.extname(file.name)
    const taskId = repo.create({
      inputFormat: matched[1] === 'pdf' ? 'pdf' : ext.slice(1),
      inputFileName: file.name,
    })
    // reservation 完成，后续异步操作不影响并发判断

    // 写临时文件
    const taskDir = path.join(os.tmpdir(), 'pianoscore-ocr', taskId)
    const inputPath = path.join(taskDir, `input${ext}`)
    try {
      await fs.mkdir(taskDir, { recursive: true })
      await fs.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      // 写文件失败：回滚任务
      repo.markFailed(taskId, 'engine_crash', `failed to write temp file: ${String(err)}`)
      return c.json({ taskId, status: 'failed', errorCode: 'engine_crash' }, 201)
    }

    // 回填 inputPath 并启动 runner
    repo.updateInputPath(taskId, inputPath)
    runner.start({
      taskId,
      filePath: inputPath,
      format: matched[1],
      fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
      inputFileName: file.name,
    })

    return c.json({ taskId, status: 'pending' }, 201)
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
    // runner.cancel 负责 kill 进程 + 标 failed + 清理目录
    runner.cancel(id)
    const deleted = repo.delete(id)
    return c.json({ deleted })
  })

  return route
}
```

注意新增 `repo.updateInputPath(taskId, inputPath)` —— 在 OcrTaskRepo 加一个方法：

```typescript
// 在 OcrTaskRepo（Task 3）追加
updateInputPath(id: string, inputPath: string): void {
  this.db.update(ocrTasks).set({ inputPath }).where(eq(ocrTasks.id, id)).run()
}
```

需在 Task 3 补一个对应单测。

- [ ] **Step 4: 修改 helpers.ts 挂载 ocr + health 路由**

`createTestApp` 改为接受可选 ocr 注入，并挂载 `/api/ocr` 和 `/api/health`：

```typescript
// helpers.ts 顶部 import 区追加
import { createOcrRoute } from '../ocr.js'
import type { OcrEngine } from '../../ocr/engine.js'
import type { OcrRunner } from '../../ocr/runner.js'

export interface TestApp {
  app: Hono
  db: Db
  close: () => void
}

export function createTestApp(ocr?: {
  engine: OcrEngine
  runner: OcrRunner
}): TestApp {
  // ... 原有建表 ...

  const app = new Hono()
  app.route('/api/scores', createScoresRoute(db))
  app.route('/api/scores', createSessionsRoute(db))
  app.route('/api/import', createImportRoute(db))

  // health：测试用同步返回，可用性由传入 engine 决定
  app.get('/api/health', async (c) => {
    if (ocr) {
      const h = await ocr.engine.healthCheck()
      return c.json({ status: 'healthy', ocr: { available: h.ok, reason: h.reason } })
    }
    return c.json({ status: 'healthy', ocr: { available: false, reason: 'no_audiveris' } })
  })

  if (ocr) {
    app.route('/api/ocr', createOcrRoute(db, ocr.engine, ocr.runner))
  }

  return { app, db, close: () => sqlite.close() }
}
```

这样 health 测试（在 Task 8）能挂载，且用注入的 engine 的 healthCheck 结果。DELETE 测试里 `runner.cancel` 是 mock，断言它被调用即可。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && npx vitest run src/routes/__tests__/ocr.test.ts`
Expected: PASS — 全部 6 个测试

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

// 启动时预热 healthCheck（结果缓存在 engine 内部，供 /api/health 复用）
ocrEngine.healthCheck().catch(() => {})

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
- Create: `LICENSE`（仓库当前不存在，新建 MIT 许可证 + 第三方指引声明）
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

- [ ] **Step 3: 新建 LICENSE（项目 MIT + 第三方声明）**

仓库当前没有 LICENSE 文件。新建一份完整的 MIT 许可证，顶部加第三方声明段：

```markdown
> PianoScore itself is licensed under the MIT License (below). Third-party
> components integrated as independent processes are listed in
> `LICENSE-THIRD-PARTY.md` and retain their original licenses.

MIT License

Copyright (c) 2026 sbhorshy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 注：copyright holder 与年份以 `git config user.name` 和当前年份为准（sbhorshy / 2026）。若项目已有其他版权声明约定，以实际为准。

- [ ] **Step 4: README.md 加"第三方组件"章节**

在 README 合适位置（如安装说明之后）加：

```markdown
## 第三方组件 (Third-Party Components)

PianoScore 通过子进程（`child_process.spawn`）方式集成以下 OMR 引擎，
作为独立工作调用，不修改其源码：

- **[Audiveris](https://github.com/Audiveris/audiveris)** (AGPL-3.0)：乐谱图像识别。
  PianoScore 不链接 Audiveris 代码，仅通过文件系统交换数据（输入 PDF → 输出 MusicXML）。
  许可证与源码获取详见 `LICENSE-THIRD-PARTY.md`。

> AGPL-3.0 是强 copyleft 许可证。本项目**假设**进程隔离不触发传染（GPL/AGPL 社区惯例），
> 从而保留 MIT 许可——但这属于项目假设而非确定法律结论，商业部署请咨询法务确认。
```

- [ ] **Step 5: Commit**

```bash
git add LICENSES/AGPL-3.0.txt LICENSE-THIRD-PARTY.md LICENSE README.md
git commit -m "docs(license): add MIT LICENSE + Audiveris AGPL third-party notice

Process-isolation integration model (per project assumption that this
avoids copyleft per GPL/AGPL community convention — not legal advice;
commercial deployments should verify with counsel)."
```

---

## Task 11: 第二层集成测试（带 Java 守卫）

真实跑 Audiveris 的集成测试，skipIf 守卫（无 jar 环境跳过）。

**Files:**
- Create: `server/src/ocr/__tests__/integration.test.ts`
- 需要测试资产：`server/test-fixtures/score-ocr.pdf`（小段简单旋律）、`server/test-fixtures/not-score.txt`（纯文字）

- [ ] **Step 1: 准备测试 fixture（需手动）**

这一步需要人工准备两份文件，放在 `server/test-fixtures/`：
- `score-ocr.pdf`：单谱表、C 大调四分音符音阶 4-8 个音符。可用 MuseScore 导出 PDF，或从公开免版税乐谱截取单页。**关键是简单到 Audiveris 几乎不会认错。**
- `not-score.pdf`：真实文字 PDF（不是改名文件——直接用一段纯文本通过浏览器/Word 打印为 PDF），用于断言 no_output/low_confidence。**文件名统一为 `.pdf`，测试读这个名字。**

在 README 或此处记录 fixture 来源。**若暂时无法准备，标记此 Task 为 blocked，先做 Task 12 验收。**

- [ ] **Step 2: 写集成测试**

注意：server 是 ESM，**不能用 `__dirname`**，需用 `import.meta.url` 派生。

```typescript
// server/src/ocr/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OcrEngine } from '../engine.js'

// ESM 下 __dirname 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(__dirname, '../../../test-fixtures')

const JAR = process.env.PIANOSCORE_AUDIVERIS_JAR

// 无 jar 则跳过整个 describe
const describeOrSkip = JAR ? describe : describe.skip

describeOrSkip('OcrEngine integration (real Audiveris)', () => {
  const engine = new OcrEngine({
    javaBin: process.env.PIANOSCORE_JAVA ?? 'java',
    jarPath: JAR!,
    tessdataDir: process.env.PIANOSCORE_TESSDATA,
    dbPath: ':memory:',
  })

  it('recognizes a simple score PDF', async () => {
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(path.join(FIXTURES_DIR, 'score-ocr.pdf'), inputPath)

    const result = await engine.recognize({
      taskId: 'it1', filePath: inputPath, format: 'pdf', fallbackTitle: 'score-ocr',
    })
    expect(result.musicXml).toContain('<score-partwise')
    expect(result.meta.tempo).toBeGreaterThan(0)

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000) // 60s 超时

  it('fails on non-score input', async () => {
    const taskDir = path.join(os.tmpdir(), `pianoscore-ocr-it-${Date.now()}`)
    const inputPath = path.join(taskDir, 'input.pdf')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.copyFile(path.join(FIXTURES_DIR, 'not-score.pdf'), inputPath)

    await expect(engine.recognize({
      taskId: 'it2', filePath: inputPath, format: 'pdf', fallbackTitle: 'not-score',
    })).rejects.toThrow()

    await fs.rm(taskDir, { recursive: true, force: true })
  }, 60_000)
})
```

移除了原 import 里未使用的 `OcrError`（noUnusedLocals）。`dbPath` 用 `:memory:`（better-sqlite3 内存库占位，集成测试不写 DB）。

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
