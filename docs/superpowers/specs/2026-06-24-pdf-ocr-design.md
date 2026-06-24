# PDF/图片乐谱识别（OMR）整合设计

> **日期**：2026-06-24
> **状态**：待评审
> **目标**：将开源 OMR 引擎 [Audiveris](https://github.com/Audiveris/audiveris) 整合进 PianoScore，新增 PDF/图片 → MusicXML → 练习的完整流程。

---

## 1. 背景与约束

### 1.1 现状

PianoScore 当前的乐谱导入只支持 MusicXML：

```
MusicXML 上传 → POST /api/import → MusicXmlParser → SQLite（存 sourceXml）
                                                       ↓
                                          PracticePage → OSMD 渲染 + 评分
```

- 后端 `ParserRegistry`（`server/src/parsing/parser.ts`）按开闭原则设计，已有 `MusicXmlParser` 一个实现。
- `scores` 表存原始 `sourceXml`，练习目标运行时由 OSMD cursor 提取。
- Tauri 桌面端（`src-tauri/`）目前是**空壳**：`main.rs` 只有 18 行，仅起 webview 指向 vite dev server，不打包后端。

### 1.2 Audiveris 的技术现实

Audiveris 是 **Java 桌面级 OMR 引擎**，整合面临三个硬约束：

1. **需要 JVM + Tesseract OCR**（JNI 原生库），**无法跑在浏览器/WASM**。识别必须在有 Java 环境的本地进程完成。
2. **体积大**：jar ~100MB，JRE ~50-70MB（精简后），tessdata ~15MB。
3. **耗时**：单页 2-5s，多页 10-30s，是 CPU 密集型同步阻塞进程。

### 1.3 已确认的决策

经 brainstorming 与用户确认：

| 决策点 | 结论 |
|--------|------|
| 形态 | 桌面 App 全功能；网页端**共用同一接口**，条件可用 |
| 后端部署 | 跑在用户自己的设备上 |
| Java/jar 分发 | **JRE + Audiveris jar + Tesseract 全随 Tauri App 打包**（零配置） |
| 网页端范围 | 桌面全面，网页**条件可用**（用户本机后端有 Java 才能用，否则降级提示） |
| 识别时机 | **异步任务 + 1.5s 轮询** |
| 识别结果处理 | **任务完成直接入库**（不做预览页，识别错误靠删除重识别） |
| MVP 输入格式 | **PDF + PNG/JPG 图片** |

---

## 2. 整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (app/, 桌面与网页共用同一份代码)                          │
│                                                              │
│  LibraryPage        ImportPage（分区增强）                     │
│       │                  │                                   │
│       │           ┌──────┴───────┐                           │
│       │           ▼              ▼                            │
│       │    MusicXML 上传    PDF/图片上传                       │
│       │    (现有，秒入)      (新增，异步)                       │
│       │                        │                             │
│       │              api.createOcrTask(file) → taskId        │
│       │              useOcrTask(taskId) 轮询                  │
│       │              done → navigate /practice/:id           │
│       │              failed → 显示错误 + 重试/放弃             │
│       └──────────────────────────────────────────────────────│
└──────────────────────────┬───────────────────────────────────┘
                           │ fetch /api
┌──────────────────────────┼───────────────────────────────────┐
│  后端 (server/, Hono + SQLite)                               │
│                           │                                  │
│   POST   /api/ocr         ─→ 建任务行 + 异步启动识别           │
│   GET    /api/ocr/:id     ─→ 轮询状态                         │
│   DELETE /api/ocr/:id     ─→ kill 进程 + 清理临时文件 + 删行    │
│   GET    /api/health      ─→ 后端存活 + OCR 引擎可用性         │
│                           │                                  │
│   OcrRunner（任务编排）   │  OcrEngine（进程调用）             │
│     pending→running→done  │    spawn('java -jar audiveris')   │
│              ↘ failed     │    解析输出 / 映射错误码            │
│                           │                                  │
│   done 时：insertScore（复用现有 repo，sourceFormat='ocr'）   │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼（桌面 App 打包后，这些都在用户机器上）
┌──────────────────────────────────────────────────────────────┐
│  Tauri App（改造重点）                                        │
│   ├─ Rust 启动时 spawn 后端 Node 进程（sidecar）              │
│   ├─ resources/server/  ：后端 bundle + better-sqlite3.node    │
│   ├─ resources/jre/     ：jlink 精简运行时（含 java.desktop）   │
│   ├─ resources/audiveris/：audiveris.jar + tessdata/           │
│   └─ 环境变量 PIANOSCORE_* 让后端定位上述资源                   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 核心架构决策

1. **OcrEngine 独立，不复用 `ScoreParser` 接口**。OMR 是长时间异步进程（5-30s），且产出经状态机管理，生命周期与同步的 `parse(bytes): Promise<ParsedScore>` 完全不同。强行塞进 `ScoreParser` 会污染接口语义。但**入库时复用 `insertScore`**，持久化层不变。

2. **桌面与网页的差异全部收敛到后端 Java 环境**。前端代码零分支（同一套 `createOcrTask` / `pollOcrTask` / `cancelOcrTask`）。差异只在：桌面 App 自带 JRE（随包），网页用户得自己本机有 Java。后端启动时跑 `healthCheck()`，结果通过 `/api/health` 暴露。

3. **任务 done 直接入库，不做预览页**（用户确认的修改）。识别错误靠在 Library 删除该 score 重新识别。

4. **Tauri 打包后端是前置工程**。当前 Tauri 是空壳，要兑现"桌面零配置"，必须让 Rust 在 App 启动时拉起后端 Node 进程，并把 JRE/jar/tessdata 放进 resources。这是独立可验证的工作（不依赖 OMR，做完桌面 App 就自带后端）。

---

## 3. 数据模型

### 3.1 新增 `ocr_tasks` 表

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | text PK | UUID（任务 ID） |
| `status` | text NOT NULL | `pending` → `running` → `done` \| `failed` |
| `inputFormat` | text NOT NULL | `pdf` \| `png` \| `jpg` \| `jpeg` |
| `inputFileName` | text NOT NULL | 原始文件名（用于展示） |
| `inputPath` | text | 临时文件绝对路径（运行时清理用） |
| `scoreId` | text | 成功时指向 `scores.id`（软关联，不加 FK） |
| `errorCode` | text | 失败原因码（见 6.5） |
| `errorDetail` | text | 详细错误（stderr 摘要等） |
| `createdAt` | integer | `unixepoch()` |
| `startedAt` | integer | 进入 `running` 的时间 |
| `completedAt` | integer | 进入 `done`/`failed` 的时间 |

Drizzle schema（`server/src/db/schema.ts` 追加）：

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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

**设计要点：**

- **`scoreId` 软关联不加 FK**：任务失败时无 score（FK 不成立）；用户删 score 时任务记录变孤儿，无害（不级联删任务，保留识别历史）。
- **`status` 是状态机单一字段**：轮询接口直接读，前端据此渲染。
- **`errorCode` 用枚举码而非自由文本**：前端能据此显示本地化提示；`errorDetail` 才是给排查用的自由文本。

**数据库迁移**：新增表通过 `drizzle-kit generate` 生成迁移 SQL（项目已有 `drizzle.config.ts`），`npm run db:push` 推送到 `db.sqlite`。现有 scores/sessions 表不变，向后兼容。打包后 App 首次启动时，若 `appDataDir/db.sqlite` 不存在则从模板复制（schema 已含新表）；已存在旧库的情况，MVP 阶段用户量小，可接受手动重新初始化（不实现自动 migration runner）。

### 3.2 复用 `scores` 表（schema 不变，但入库函数需改）

现有 `scores.sourceFormat`（default `'musicxml'`）列直接复用：识别入库时标 `sourceFormat = 'ocr'`。

**问题：当前 `insertScore` 硬编码 `sourceFormat: 'musicxml'`**（`repo.ts:26`），无法写入 `'ocr'`。需扩展签名：

```typescript
// 扩展为可选参数，向后兼容（现有 MusicXmlParser 调用不变）
export function insertScore(
  db: Db,
  parsed: ParsedScore,
  options?: { sourceFormat?: string },
): string {
  // ...
  sourceFormat: options?.sourceFormat ?? 'musicxml',
  // ...
}
```

OCR 入库调用：`insertScore(db, parsed, { sourceFormat: 'ocr' })`。

### 3.3 `sourceFormat` 全链路打通（review P1）

当前 `sourceFormat` 存在 DB 但**整条返回链路都不返回它**，前端 LibraryPage 拿不到。需同步修改四层：

| 层 | 文件 | 改动 |
|----|------|------|
| repo | `server/src/db/repo.ts` | `ScoreSummary` 接口加 `sourceFormat: string`；`listScores()` 返回该字段；`getFullScore()` 的 `FullScore` 同样加 |
| route | `server/src/routes/scores.ts` | 无需改（透传 repo 返回） |
| api 客户端 | `app/src/lib/api.ts` | `ScoreSummary` 接口加 `sourceFormat: string`；`ScoreData` 同样加 |
| 页面 | `app/src/pages/LibraryPage.tsx` | 基于 `score.sourceFormat === 'ocr'` 渲染「📷 扫描识别」标签 |

**元数据回退策略**（见下方 Open Question 的统一规则）：标题 fallback 取文件名去扩展名（OCR 独有规则，因为扫描谱常无标题），作曲家为空，tempo 默认 120。

---

## 4. API 接口契约

复用现有 Hono 路由工厂模式（`createImportRoute(db)`），新增 `createOcrRoute(db)`。所有路径前缀 `/api/ocr`。

### 4.1 创建任务

```
POST /api/ocr
Content-Type: multipart/form-data
  file: <PDF/PNG/JPG, ≤20MB>

→ 201
{ "taskId": "uuid", "status": "pending" }
```

- 校验扩展名（`.pdf/.png/.jpg/.jpeg`）和大小（≤20MB）。
- **串行约束（后端强制，非仅前端限制）**：查询是否有 `status IN ('pending','running')` 的任务。若有，返回 `409 { error: 'An OCR task is already running', activeTaskId }`。这防止双击、页面刷新恢复、直接 API 调用绕过前端限制。MVP 不做任务队列（409 即拒绝，用户需等当前任务完成或取消后再提交）。
- 写临时文件 → 建任务行 → **立即异步启动识别**（不 await，路由立刻返回 taskId）。
- **后端活着但缺 Java（healthCheck 不通过）时，仍返回 201 + pending**：把环境错误延迟到轮询时以 `errorCode: no_java` 暴露。这样前端流程统一（永远轮询），不为"环境检测失败"单独写分支。
- 注意：这条规则的前提是后端进程能接收请求。如果后端进程根本没启动（场景 3），`POST /api/ocr` 连接被拒，由前端的网络错误处理，不在此规则覆盖范围内。

### 4.2 轮询状态

```
GET /api/ocr/:taskId

→ 200 (pending/running)
{ "status": "running", "inputFileName": "...", "elapsedMs": 4200 }

→ 200 (done)
{ "status": "done", "scoreId": "abc-123" }

→ 200 (failed)
{ "status": "failed", "errorCode": "no_java",
  "errorDetail": "java executable not found in PATH" }

→ 404
{ "error": "Task not found" }
```

`elapsedMs = now - startedAt`（running 时计算，done/failed 不含）。

### 4.3 删除/取消

```
DELETE /api/ocr/:taskId

→ 200
{ "deleted": true }
```

- 终止运行中的进程（kill child via pid）→ 删临时文件 → 删任务行。
- 成功任务（已入库）：删任务行，**不动 scores**（score 由库页面单独删）。

### 4.4 健康检查

```
GET /api/health

→ 200
{ "ok": true, "ocr": { "available": true } }

→ 200（OCR 引擎不可用）
{ "ok": true, "ocr": { "available": false, "reason": "no_java" } }
```

后端启动时跑一次 `engine.healthCheck()`，缓存结果。前端 ImportPage 挂载时调一次：`ocr.available: false` → OCR 区块直接显示降级提示，**不让用户上传**（比上传完才发现 no_java 更友好）。这是"任务 failed 兜底"之外的**前置防线**。

**`reason` 字段与错误码统一**：health 端点返回的 `reason` 使用与 `errorCode`（见 6.5）完全相同的码集：`no_java` / `no_audiveris`。即 health 和任务失败用同一套诊断码，前端可复用同一张文案映射表。

### 4.5 前端 API 客户端扩展

`app/src/lib/api.ts` 追加（复用现有 `ApiError`）：

```typescript
createOcrTask(file: File): Promise<{ taskId: string; status: string }>
fetchOcrTask(taskId: string): Promise<OcrTaskStatus>
cancelOcrTask(taskId: string): Promise<void>
fetchHealth(): Promise<{ ok: boolean; ocr: { available: boolean; reason?: string } }>
```

---

## 5. 前端 UI 与降级策略

### 5.1 ImportPage 分区改造

现有 ImportPage 是单文件上传 MusicXML。改造为**分区布局**，MusicXML 区逻辑原样保留：

```
ImportPage
┌─────────────────────────────────────────┐
│  导入乐谱                                 │
│                                          │
│  ┌─ 🎼 已有乐谱文件 ─────────────────┐   │
│  │  [拖拽 .musicxml/.xml/.mxl]        │   │  ← 现有逻辑原样保留
│  │  上传后直接入库，跳转练习            │   │
│  └────────────────────────────────────┘   │
│                                          │
│  ┌─ 📷 扫描识别（PDF/图片）──────────┐   │
│  │  [拖拽 .pdf/.png/.jpg]            │   │  ← 新增
│  │  上传后开始识别，展示任务进度       │   │
│  │  <OcrTaskCard taskId=... />        │   │
│  └────────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**为什么分区而非合并**：两种导入生命周期完全不同——MusicXML 秒入秒出，PDF 是 5-30s 异步任务带状态。合并会让 UI 既要处理"上传完即跳转"又要处理"上传完进轮询"。分区让每种导入的状态机清晰独立。

### 5.2 新组件 OcrTaskCard

一个任务从创建到终态的完整展示：

```
┌─ OcrTaskCard (props: taskId, onRetry) ──────┐
│                                             │
│  [pending/running]                          │
│  📄 某曲谱.pdf                              │
│  ⟳ 识别中… 已耗时 8s                       │
│  [取消]                                     │
│                                             │
│  ─── 或 ───                                 │
│                                             │
│  [done]                                     │
│  ✓ 识别完成                                 │
│  正在跳转练习页…  (navigate /practice/:id)  │
│                                             │
│  ─── 或 ───                                 │
│                                             │
│  [failed]                                   │
│  ✗ 识别失败                                 │
│  ⚠ 未能识别出乐谱，请确认是清晰的五线谱。   │
│  [重试] [复制详情] [放弃]                   │
└─────────────────────────────────────────────┘
```

- **状态驱动渲染**：组件只接收 `taskId`，内部用 `useOcrTask(taskId)` 轮询，根据 `status` 切换三套 UI。done 时调 `navigate`，failed 时根据 `errorCode` 显示对应文案（见 6.5）。
- **重试语义**：点"重试"= 用原 `inputFileName` + 重新上传同一文件创建新任务。父组件 ImportPage 持有 File 引用，通过 `onRetry` 回调传给卡片。
- **放弃**：`cancelOcrTask` + 移除卡片。

### 5.3 useOcrTask hook

```typescript
// app/src/hooks/useOcrTask.ts
type OcrPollState =
  | { status: 'pending' | 'running'; inputFileName: string; elapsedMs: number }
  | { status: 'done'; scoreId: string }
  | { status: 'failed'; errorCode: ErrorCode; errorDetail: string }

function useOcrTask(taskId: string | null): {
  state: OcrPollState | null
  error: ApiError | null     // 网络层错误（区别于任务 failed）
  cancel: () => void
}
```

**实现要点：**
- `setInterval` 每 1500ms `fetchOcrTask(taskId)`。
- 收到 `done`/`failed` → 停轮询，setState。
- 组件卸载或 `taskId` 变 null → 清 interval。
- 网络 `ApiError`（502/超时）和任务 `failed` **分开存**：前者是"轮询本身失败"（自动重试 3 次），后者是"识别失败"（终态，不重试）。
- **轮询与导航的竞态**：done 后调 `navigate`，用 `isMountedRef` 守卫 setState（React 标准模式）。
- **不伪造进度百分比**：Audiveris stdout 无结构化进度，只展示"识别中 + 已耗时"旋转动画。

### 5.4 降级策略

**场景 1：`/api/health` 报告 OCR 不可用（前置防线）**
OCR 区块上方显示常驻提示，不让用户上传：

```
ℹ PDF 识别不可用
  本机后端未检测到 Java 环境。
  • 桌面版已内置 Java，开箱即用
  • Web 版需在本机安装 JDK 17+ 并启动后端
```

**场景 2：任务轮询拿到 `failed + errorCode: no_java`（兜底防线）**
即使前置防线漏判（如 health 缓存过期后环境变化），任务卡片显示对应 errorCode 文案。

**场景 3：后端进程根本没启动（fetch 502/connection refused）**
ImportPage 挂载时 ping `/api/health` 失败 → OCR 区块显示"PDF 识别需要本地后端运行。如果这是网页版，请确保 localhost:8000 已启动。" 网页版用户未跑后端、Tauri 开发期后端未拉起都属于此场景。注意：此时 `useOcrTask` 的 `error` 字段也会捕获，但前置的 health 预判能更早提示。

### 5.5 LibraryPage 标签

`sourceFormat = 'ocr'` 的曲谱卡片显示小角标「📷 扫描识别」。这是唯一需要改 LibraryPage 的地方，改动量极小。

---

## 6. OcrEngine 服务（工程难点）

### 6.1 Audiveris CLI 契约

Audiveris CLI 的输入是 **positional `INPUT_FILES`**（不是 `-input` 参数），通过 `--` 与选项分隔。完整识别需 `-transcribe`（符号检测→建谱）+ `-export`（写输出文件）。参考：[Audiveris CLI 文档](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/)。

```bash
java -jar audiveris.jar \
  -batch \                          # 无 GUI 模式（必须）
  -transcribe \                     # 运行 OMR 转录步骤（符号检测 → 建谱）
  -export \                         # 导出 .mrz + MusicXML
  -sheets 1 \                       # 只处理第一个 sheet（限制多页处理范围，见 8.8）
  -output /tmp/ocr/<taskId>/out/ \
  -- /tmp/ocr/<taskId>/input.pdf    # positional INPUT_FILES，-- 与选项分隔
```

- `-batch` 模式不弹 GUI，纯命令行——程序化调用的前提。
- `-sheets 1` 限制只处理第一页（sheet）。不带此参数时 Audiveris 处理所有页，浪费时间；带上后多页 PDF 也只识别首页，CPU/耗时与单页等价。
- Audiveris **必须给目录输出**（`-output`），在 `out/` 下生成 `input.mrz`、`input.mxl`（压缩 MusicXML）、`input.pdf`（叠加图）。
- **输出格式是 `.mxl`（压缩 ZIP），不是 `.xml`**：Audiveris 默认输出压缩 MusicXML（`.mxl`）。OcrEngine 必须能读 `.mxl`（ZIP 解压取内部 MusicXML）——直接复用现有 `musicxml.ts` 的 `extractMxl()`（已实现 ZIP 解压）。若需强制非压缩输出，可通过 `-constant Audiveris.output.xml.compressed=false` 配置（备选方案，但复用 `extractMxl` 更简单，不引入新配置）。
- OcrEngine 扫描 outDir 时应匹配 `*.mxl` **和** `*.xml`（兼容用户手动改配置的情况）。

### 6.2 OcrEngine 类设计

```typescript
// server/src/ocr/engine.ts
export class OcrEngine {
  private javaBin: string
  private jarPath: string
  private tesseractData?: string
  private isAvailable: boolean
  private missingReason?: ErrorCode

  constructor(config: OcrConfig) { ... }

  // 启动时调用：确认 java + jar 都在。失败不抛，置 isAvailable=false。
  healthCheck(): { ok: boolean; reason?: ErrorCode }

  // 核心方法：阻塞 Promise，进程级异步由 OcrRunner 包。
  async recognize(input: RecognizeInput): Promise<OcrResult>
}

type RecognizeInput = {
  taskId: string
  filePath: string
  format: 'pdf' | 'image'
}

type OcrResult = {
  musicXml: string
  meta: { title: string; composer?: string; tempo: number }
}
```

**为什么是阻塞 `recognize()` 而非事件流**：Audiveris stdout 是海量日志行，解析进度不可靠。让 `recognize()` 是朴素的 `Promise<OcrResult>`，进程级异步交给调用层。引擎本身可独立单测。

### 6.3 recognize 内部流程

```
recognize(input)
  │
  ├─ 1. if (!this.isAvailable) throw OcrError(missingReason)
  │
  ├─ 2. spawn('java', ['-jar', jarPath, '-batch', '-transcribe',
  │         '-export', '-sheets', '1', '-output', outDir,
  │         '--', input.filePath])
  │     spawnOptions = { env: { ...process.env,
  │       TESSDATA_PREFIX: this.tesseractData } }  ← 关键
  │
  ├─ 3. 收集 stdout/stderr 到 buffer（封顶 64KB，防 OOM）
  │     超时保护：setTimeout 90s → kill + throw engine_crash
  │
  ├─ 4. await child exit
  │     ├─ exit 0 → 继续
  │     ├─ exit 非 0 → throw OcrError('engine_crash', stderr 尾部)
  │     └─ timeout → throw OcrError('engine_crash', 'timeout 90s')
  │
  ├─ 5. 扫描 outDir，找第一个 *.mxl（优先）或 *.xml
  │     .mxl 是 ZIP → 复用 musicxml.ts 的 extractMxl() 解压取内部 XML
  │     找不到任何 .mxl/.xml → throw OcrError('no_output', outDir 内容列表)
  │
  ├─ 6. 读 XML → 校验根是 <score-partwise>
  │     空谱 / 无音符 → throw OcrError('low_confidence',
  │                               'Audiveris output has 0 notes')
  │
  └─ 7. 提取 meta（复用导出的 extractMusicXmlMetadata()，见下方 Open Question）
        return { musicXml, meta }
```

**两个工程细节：**

1. **`TESSDATA_PREFIX` 必须显式注入**：Tesseract 默认查系统路径（Linux `/usr/share/tessdata`），但我们打包的 tessdata 在 App resources 里。不注入会报"找不到 traineddata"。OMR 整合最常见坑。
2. **stderr buffer 封顶 64KB**：Audiveris 单次识别能吐几 MB 日志，不封顶会内存爆。封顶后只保留尾部（错误信息通常在最后）。

### 6.4 OcrRunner（异步任务编排）

`recognize()` 是阻塞 Promise，需要包成任务表里的异步生命周期：

```typescript
// server/src/ocr/runner.ts
export class OcrRunner {
  constructor(
    private db: Db,
    private engine: OcrEngine,
    private taskRepo: TaskRepo,
  ) {}

  // 由 POST /api/ocr 调用：建任务行，返回 taskId，不 await。
  start(input: { filePath: string; format: 'pdf' | 'image'; fileName: string }): string

  // runner 内部：状态机推进
  private async run(taskId: string): Promise<void>

  // 由 DELETE 调用：kill 进程 + 清理
  cancel(taskId: string): void
}
```

**`run()` 内部流程：**

```
update task: pending → running, startedAt = now
try:
  result = await engine.recognize(input)
  parsed = { ...result.meta, sourceXml: result.musicXml,
             sourceFormat: 'ocr' }
  scoreId = insertScore(db, parsed)   ← 复用现有 repo
  update task: running → done, scoreId, completedAt = now
  cleanup temp file
catch OcrError as e:
  update task: running → failed, errorCode = e.code, errorDetail = e.detail
  cleanup temp file
```

**`cancel()`**：spawn 时记 pid，维护 `Map<taskId, child>` 活动进程表，cancel 时 `process.kill(pid)`。

### 6.5 错误码映射（前端可见）

| `errorCode` | 触发条件 | 前端提示 |
|------|------|------|
| `no_java` | healthCheck 找不到 java | "未检测到 Java 运行环境。桌面版已内置，Web 版需本机安装 JDK。" |
| `no_audiveris` | jar 不存在 | "识别引擎文件缺失，请重新安装应用。" |
| `engine_crash` | 进程非 0 退出 / 超时 | "识别引擎异常退出，可能是 PDF 损坏或谱面过于复杂。" |
| `no_output` | Audiveris 跑完但没产出 XML | "未能识别出乐谱，请确认是清晰的五线谱 PDF。" |
| `low_confidence` | XML 有但 0 音符 | "识别结果为空，可能是扫描质量不足或非乐谱图像。" |

这 5 个码覆盖所有现实失败路径，前端无需解析 stderr。`errorDetail` 仅在"复制详情给开发者"按钮里用。

### 6.6 临时文件管理

```
<os.tmpdir()>/pianoscore-ocr/<taskId>/
  ├── input.<ext>        # 原始上传文件
  └── out/               # Audiveris 输出目录
      ├── input.mrz
      ├── input.xml      # 读这个
      └── input.pdf
```

任务终态（done/failed/cancelled）后**立即删整个 `<taskId>/` 目录**。失败也删——错误信息已进 DB。后端启动时扫一遍 `pianoscore-ocr/` 清理上次崩溃残留的孤儿目录。

---

## 7. Tauri 打包（兑现"全打包零配置"）

### 7.1 现状与目标差距

```
当前 Tauri App：                    目标 Tauri App：
┌──────────────────┐               ┌──────────────────────┐
│ webview → :5173  │               │ webview → 内嵌后端     │
│ (main.rs 18行)    │               │ Rust 拉起:            │
│                  │      ──→      │  ├─ Node 后端进程      │
│ 用户得自己开      │               │  │  (内置 :8000)      │
│ 两个终端跑前后端  │               │  ├─ java (JRE)        │
│                  │               │  └─ tessdata          │
└──────────────────┘               └──────────────────────┘
                                   用户双击即用
```

### 7.2 打包结构

Tauri v1 分两类资源：**externalBin**（可执行二进制作 sidecar）和 **resources**（数据文件，只读）。

```
PianoScore.app 安装后内含：
├─ PianoScore(.exe)           # Tauri 主程序 + webview
│
├─ resources/
│   ├─ server/
│   │   ├─ server.cjs          # 后端 esbuild bundle 产物
│   │   └─ better-sqlite3.node # 原生模块（每平台预编译）
│   │
│   ├─ jre/                    # jlink 精简运行时（每平台一份）
│   │   └─ bin/java(.exe)
│   │
│   ├─ audiveris/
│   │   ├─ audiveris.jar       # ~100MB
│   │   └─ tessdata/
│   │       └─ eng.traineddata # ~15MB（MVP 仅英语）
│   │
│   └─ db.sqlite               # 首次启动时复制到用户数据目录
│
└─ node（externalBin sidecar）
```

**关键：App 安装目录只读**，数据库不能写进去。启动时把 `db.sqlite` 模板复制到 `appDataDir`，后端指向那里。

### 7.3 后端进程打包（最难点）

后端是 TypeScript + better-sqlite3（原生 C++ 模块）。采用 **Node 二进制作 sidecar + bundle.js 作 resource**：

- Tauri `externalBin` 带 node 二进制（每平台一份）。
- esbuild 把后端 TS bundle 成单 `server.cjs`，作 resource。
- better-sqlite3 的 `.node` 文件单独作 resource（每平台预编译版）。
- Rust 启动时 `spawn(nodeBin, [serverPath])`，`server.cjs` 里 `process.dlopen` 加载 `.node`。

**为什么不选 Node SEA 单文件**：SEA 对原生模块（better-sqlite3 的 `.node`）支持差，需要 hacky 的 require override。sidecar + resource 是最可控方式。代价是 Node 二进制（~40MB）每平台一份，相比 JRE/Audiveris 不算大头。

**Rust 侧改造**（`main.rs` setup hook）：

```rust
.setup(|app| {
    // 1. 计算资源路径
    let resource_dir = app.path_resolver().resolve_resource("")?;
    let node_bin = resource_dir.join("node");        // 或 node.exe
    let server_js = resource_dir.join("server/server.cjs");

    // 2. 准备用户数据目录，复制空 db（首次）
    let app_data = app.path_resolver().app_data_dir()?;
    let db_path = app_data.join("db.sqlite");
    if !db_path.exists() {
        // 从 resource 复制模板
    }

    // 3. spawn 后端，注入路径环境变量
    Command::new(node_bin)
        .args([server_js.to_str().unwrap()])
        .env("PIANOSCORE_DB", db_path)
        .env("PIANOSCORE_JAVA", resource_dir.join("jre/bin/java"))
        .env("PIANOSCORE_AUDIVERIS_JAR", resource_dir.join("audiveris/audiveris.jar"))
        .env("PIANOSCORE_TESSDATA", resource_dir.join("audiveris/tessdata"))
        .spawn()?;

    Ok(())
})
```

**进程生命周期**：App 退出时杀掉后端（Rust `on_window_event` 或持有 child handle 的 `Drop`）。否则留孤儿进程。

### 7.4 JRE 打包（jlink 精简运行时）

不能用完整 JDK（~300MB），用 `jlink` 生成仅含所需模块的精简 JRE：

```bash
# 在构建机执行（每平台一份，必须在该平台跑）
jlink \
  --module-path $JAVA_HOME/jmods \
  --add-modules java.base,java.desktop,java.logging,java.management \
  --output build/jre \
  --no-header-files --no-man-pages --strip-debug \
  --compress=2
```

**为什么必须含 `java.desktop`**：Audiveris 即使 `-batch` 也依赖 AWT 的图像处理（BufferedImage 读 PDF/图片），缺这个模块直接崩。OMR 整合第二大坑。

精简后 JRE 约 50-70MB，每平台一份（Windows jre 不能给 macOS 用）。

### 7.5 资源定位契约（环境变量）

后端 `OcrEngine` 不硬编码任何路径，全部从环境变量读：

```typescript
// server/src/ocr/config.ts
export function loadOcrConfig(): OcrConfig {
  return {
    javaBin:     process.env.PIANOSCORE_JAVA
                 ?? 'java',                          // 开发模式 fallback PATH
    jarPath:     process.env.PIANOSCORE_AUDIVERIS_JAR
                 ?? './audiveris.jar',               // 开发模式本地 jar
    tessdataDir: process.env.PIANOSCORE_TESSDATA
                 ?? undefined,                        // undefined = 用系统 tessdata
    dbPath:      process.env.PIANOSCORE_DB
                 ?? './db.sqlite',
  }
}
```

**开发模式**：不设环境变量，fallback 到 PATH 的 `java` + 项目根 `audiveris.jar`，开发者自己装 JDK 放 jar。**生产模式**：Rust spawn 时注入，指向 App resources。

这个契约让后端对"是否在 Tauri 里"完全无感——只认环境变量。**网页版和桌面版跑同一份后端代码，零分支**。

### 7.6 跨平台策略

每平台一份构建产物，**不在 CI 做交叉编译**（JRE、node、better-sqlite3 都是平台特定的原生二进制）：

| 平台 | node | jre | better-sqlite3 | Tesseract |
|------|------|-----|----------------|-----------|
| Windows x64 | node.exe | jre/ (win) | .node (win build) | 随 jar 的 JNI |
| macOS (Intel+ARM) | node | jre/ (mac) ×2 | .node (mac build) | 随 jar |
| Linux x64 | node | jre/ (linux) | .node (linux build) | 随 jar |

**Tesseract 的好消息**：Audiveris jar 内已打包 Tesseract 的 Java 绑定（leptonica + tess4j），只需额外提供 `tessdata/*.traineddata`（纯数据，跨平台）。不用单独装系统 Tesseract。

**macOS 双架构**：Apple Silicon + Intel 要两份 JRE 和 node。MVP 先只支持一个架构（见 8.6）。

### 7.7 开发模式 vs 生产模式

| 方面 | 开发模式 | 生产模式（打包后） |
|------|---------|-------------------|
| 前端 | vite dev :5173 | webview 加载内嵌 dist |
| 后端 | 开发者手动 `npm run dev` | Rust spawn node sidecar |
| Java | PATH 里的系统 java | resources/jre/bin/java |
| Audiveris jar | 项目根手动放 | resources/audiveris/ |
| DB | server/db.sqlite | appDataDir/db.sqlite |
| 调用 OcrEngine | fallback 到 PATH | 环境变量指向 resources |

**关键设计**：开发模式**完全不需要 Tauri**——开发者跑 `npm run dev`（前后端）就能调试整个 OCR 流程，Tauri 只在打包发布时介入。这把"OMR 整合"和"Tauri 打包"解耦成两个独立可验证的阶段。

---

## 8. 已知限制（MVP 明确不做）

1. **仅英语 tessdata** —— `eng.traineddata` 约 15MB。钢琴谱主要识别音符（不依赖语言模型），英语够用。其他语言（声乐谱带歌词）后续支持。
2. **无识别参数调优** —— Audiveris 有大量开关（`-transcription`、`-specifications` 等），MVP 用默认。复杂谱面（手稿、低清扫描）识别率会下降，靠用户重试。
3. **无进度百分比** —— Audiveris stdout 无结构化进度，只展示"识别中 + 已耗时"。
4. **无批处理** —— 一次一个任务。多任务并发会同时跑多个 Java 进程吃 CPU，MVP 串行：**后端用 409 拒绝**（见 4.1），前端一次只渲染一个 OCR 卡片。不做任务队列（YAGNI）。
5. **预览页不提供手动修正** —— 任务 done 直接入库（用户确认），识别错误靠删除重识别，不做在线 MusicXML 编辑器。
6. **macOS 仅单架构** —— MVP 先支持一个架构（Intel 或 ARM 二选一），universal binary 后续。
7. **识别结果无质量评分展示** —— Audiveris 内部有信心度但不暴露到 MusicXML，前端无法据此提示。
8. **多页 PDF 只识别首页** —— 由 `-sheets 1` 在 CLI 层强制（见 6.1），不仅丢弃后续输出而是根本不处理，节省 CPU 和等待时间。多页合并需要乐谱拼接逻辑（拍号对齐、小节连续），复杂度高，后续迭代。

---

## 9. 许可证合规风险：AGPL-3.0（⚠ 需用户决策）

> **这一节是 review 提出的阻塞性问题，涉及项目整体许可证走向，必须由项目所有者（你）决策后才能固化。下面是事实陈述和选项分析。**

### 9.1 事实

- **Audiveris 采用 AGPL-3.0 许可证**（[GitHub](https://github.com/Audiveris/audiveris)）。
- **PianoScore 当前是 MIT 许可证**（README、LICENSE）。
- AGPL-3.0 比 GPL 更严格，有**网络条款**：用户即使通过网络远程访问（不只分发二进制），也必须能获得对应源码。

### 9.2 风险：copyleft 传染

将 Audiveris jar 整合进 PianoScore 并随 App 分发，会触发 AGPL 的 copyleft：

- **组合作品（derivative work）**：把 AGPL jar 打进 App，整个 PianoScore（含 React 前端、Hono 后端、Tauri 壳）会被要求以 AGPL-3.0 开源。
- **这与当前 MIT 许可证冲突**：MIT 是宽松许可，AGPL 是强 copyleft，两者组合时 AGPL 占主导（MIT 代码可被 AGPL 包含，但组合产物整体 AGPL）。
- **是否修改 Audiveris 不影响传染**：即使原样打包不修改，只要分发就需提供源码；若修改还需声明改动。

### 9.3 选项（需决策）

| 选项 | 做法 | 影响 |
|------|------|------|
| **A. 接受 AGPL，整个项目转 AGPL-3.0** | 把 PianoScore LICENSE 从 MIT 改为 AGPL-3.0，README 声明，提供 Audiveris 源码获取途径 | 合规最简单，但项目从 MIT 变 AGPL，影响后续商业使用和社区贡献 |
| **B. 进程隔离 + 保留 MIT** | Audiveris 作为**独立进程**通过命令行调用（本设计正是如此！），PianoScore 不链接 Audiveris 代码，理论上不构成组合作品 | **法律灰区**。多数律师认为"独立进程 + 命令行"不触发 copyleft（arm's length），但无判例保证。需在 README 声明 Audiveris 是独立 AGPL 组件，单独提供其源码 |
| **C. 不打包 jar，运行时下载** | App 不分发 jar，首次启动时从官方源下载 Audiveris jar 到用户机器 | 不构成"分发"，规避 copyleft。但违背"全打包零配置"目标，依赖网络，且 jar 下载源稳定性存疑 |
| **D. 放弃 Audiveris，找宽松许可的 OMR** | 寻找 MIT/Apache 许可的 OMR 引擎 | 绕开问题，但 Audiveris 是目前最成熟的开源 OMR，替代品（如 oemer）识别率/成熟度差距大 |

### 9.4 本设计对选项 B 的天然契合

**关键：本设计从一开始就是"进程隔离"架构**——后端用 `child_process.spawn('java', ...)` 调 Audiveris，PianoScore 代码**不 import 任何 Audiveris 类**，通过文件系统交换数据（输入 PDF / 输出 MusicXML）。这是 GPL/AGPL 社区公认的"不构成组合作品"的边界。

**但仍需法务确认**：进程隔离在司法上无判例。建议如果选 B，采取以下措施降低风险：
1. README 明确声明 Audiveris 是独立 AGPL 组件，其 jar 单独获取（即使打包也声明来源）。
2. 提供 Audiveris 源码获取方式（链接到官方 GitHub + 标明所用版本/commit）。
3. 不修改 Audiveris（用官方 release jar）。

### 9.5 待决策（阻塞 spec 固化）

**请选择 9.3 的 A / B / C / D 之一。** 在此之前，spec 的其他技术章节已按"假设选 B（进程隔离）"编写，因为这是本架构的天然形态。若选 A，则需追加 LICENSE 文件变更；若选 C，则需重写第 7 节打包策略；若选 D，则整个设计推翻重来。

---

## 10. 测试策略

### 10.1 第一层：纯函数单测（不依赖 Java，CI 必跑）

| 测试目标 | 怎么测 |
|---------|--------|
| `OcrEngine` 错误码映射 | mock child_process，让"进程返回非0"→ 断言抛 `engine_crash`；"outDir 无 .mxl/.xml"→ 断言 `no_output`；"XML 0 音符"→ `low_confidence` |
| `OcrRunner` 状态机 | mock OcrEngine，断言 task 表从 pending→running→done/failed 的字段流转，scoreId 回填正确 |
| `taskRepo` CRUD | 内存 SQLite，建任务/查状态/更新/删除 |
| 元数据回退 | 喂缺标题的 XML，断言标题取文件名、tempo=120 |
| API 端点 | `createTestApp()` 模式（现有 helpers），POST 创建→GET 轮询→DELETE 取消，mock 引擎 |

这层是回归保障，覆盖所有状态流转和错误分支，不需要真实 Java。复用现有 vitest + 内存 SQLite 模式。

### 10.2 第二层：集成测试（需要 Java，本地/可选 CI 跑）

`server/src/ocr/__tests__/integration.test.ts`，用 `describe.skipIf(!process.env.PIANOSCORE_AUDIVERIS_JAR)` 守卫：

- 准备一份**仓库内置的小型测试 PDF**（`test-score-ocr.pdf`，单页简单旋律，随仓库提交）。
- 真实跑 Audiveris，断言：产出 XML 根是 `<score-partwise>`、音符数 > 0、入库成功、task done + scoreId 回填。
- 一份**非乐谱 PDF**（纯文字页），断言：task failed + `errorCode` 是 `no_output` 或 `low_confidence`。

**测试 PDF 必须随仓库提交**，否则 CI/他人 clone 后跑不了。挑一份简单到 Audiveris 几乎不会认错的（单谱表四分音符 C 大调音阶），保证测试稳定。

### 10.3 第三层：E2E（Playwright，手动跑）

现有 `e2e/practice-flow.spec.ts` 加一个 case：

- 上传测试 PDF → 看到"识别中"→ 等待 done → 自动跳转 PracticePage → OSMD 渲染出 SVG 音符 → 断言渲染成功。
- 标记 `test.fixme` 在无 Java 环境下，避免 CI 红。

### 10.4 不测什么（YAGNI）

- 不测 Audiveris 本身的识别准确率（那是它项目的事）。
- 不测打包后的 App 安装流程（手动验收）。
- 不测跨平台（CI 只跑当前平台，跨平台靠人工 release）。

---

## 11. 分阶段实施

拆成四个独立可验证阶段，每阶段产出能独立运行，降低风险：

### 阶段 A：后端 OCR 核心（不碰 Tauri）

- 重构 `extractMetadata` → 导出 `extractMusicXmlMetadata(root, fallbackTitle)`
- `insertScore` 加可选 `sourceFormat` 参数；`ScoreSummary`/`FullScore`/`listScores`/`getFullScore` 打通 `sourceFormat` 链路
- 新建 `ocr_tasks` 表 + taskRepo
- 实现 `OcrEngine`（spawn java、解析 `.mxl`/`.xml` 输出、错误码）
- 实现 `OcrRunner`（状态机、insertScore 回填 sourceFormat='ocr'）
- 新建 `/api/ocr`（含 409 串行约束）、`/api/ocr/:id`、`DELETE /api/ocr/:id`、`/api/health` 路由
- 第一层 + 第二层测试
- **验收**：开发者本机装 Java + 放 jar，用 curl/Postman 跑通整个 OCR 流程（含 409 并发拒绝、.mxl 解析、sourceFormat='ocr' 入库）

### 阶段 B：前端接入（仍不碰 Tauri）

- `lib/api.ts` 加 `sourceFormat` 字段 + 3 个 OCR 方法 + health
- `useOcrTask` hook（区分网络 error 与任务 failed）
- `OcrTaskCard` 组件（三态 + 重试/放弃）
- ImportPage 分区改造（MusicXML 区 + 扫描识别区）；挂载时 ping `/api/health` 预判降级；处理 409
- LibraryPage sourceFormat 标签
- **验收**：浏览器开 dev server，上传测试 PDF，走完创建→轮询→跳转流程；后端不可达时显示降级提示；双击上传时第二个请求被 409 拒绝并提示

### 阶段 C：Tauri 后端进程打包

- esbuild bundle 后端为 `server.cjs`
- Rust main.rs 改造：spawn node sidecar、资源路径、DB 复制、进程清理
- `tauri.conf.json` 配 externalBin + resources
- **验收**：`npm run tauri-build` 出来的 App，双击启动能自动起后端，Library 能正常加载（此时还没 OCR 资源）

### 阶段 D：OCR 资源打包

- 构建 jlink JRE（含 java.desktop）
- 把 Audiveris jar + tessdata 放进 resources
- Rust spawn 后端时注入 `PIANOSCORE_*` 环境变量
- OcrEngine healthCheck 验证
- **验收**：打包后的 App，干净机器（无 Java）上双击，上传 PDF 能完成识别并跳转练习

**为什么这个顺序**：A 和 B 完全不依赖 Tauri，能最先验证最难的不确定性（Audiveris CLI 到底怎么调、输出长什么样）。C 是基础设施（打包后端），D 是把 OCR 资源塞进去。如果 A 阶段发现 Audiveris CLI 行为和预期不符（很可能），能在投入打包工作前就调整。**阶段 D 的验收是最终交付**：干净机器零配置完成 PDF→识别→练习。

---

## 12. 改动清单

### 后端（`server/src/`）

| 文件 | 操作 | 说明 |
|------|------|------|
| `db/schema.ts` | 修改 | 追加 `ocrTasks` 表定义 |
| `db/repo.ts` | 修改 | `insertScore` 加可选 `sourceFormat` 参数；`ScoreSummary`/`FullScore` 加 `sourceFormat` 字段；`listScores`/`getFullScore` 返回该字段；追加 taskRepo CRUD（或新建 `db/taskRepo.ts`） |
| `routes/scores.ts` | 无需改 | 透传 repo 返回（`sourceFormat` 已含） |
| `parsing/musicxml.ts` | 修改 | 将私有 `extractMetadata` 重构导出为 `extractMusicXmlMetadata(root, fallbackTitle)`，供 OcrEngine 复用；`MusicXmlParser` 传 `'Untitled'` 保持现状 |
| `parsing/musicxml.test.ts` | 修改 | 补 `extractMusicXmlMetadata` 的 fallback 参数测试 |
| `ocr/config.ts` | 新建 | `loadOcrConfig()` 从环境变量读路径 |
| `ocr/engine.ts` | 新建 | `OcrEngine` 类（spawn java、解析 `.mxl`/`.xml` 输出、错误码；复用 `extractMxl` + `extractMusicXmlMetadata`） |
| `ocr/runner.ts` | 新建 | `OcrRunner` 类（状态机、任务编排、insertScore 回填 sourceFormat='ocr'） |
| `routes/ocr.ts` | 新建 | `createOcrRoute(db)`：3 个 OCR 端点 + **409 串行约束**（查 pending/running 任务则拒绝） |
| `routes/health.ts` | 新建 | `/api/health` 端点（含 OCR 引擎可用性 + reason 码） |
| `index.ts` | 修改 | 挂载 ocr + health 路由，初始化 OcrEngine/Runner |
| `ocr/__tests__/*.test.ts` | 新建 | 第一层单测（含 409 串行、.mxl 解析、错误码映射） |
| `ocr/__tests__/integration.test.ts` | 新建 | 第二层集成测试（skipIf 守卫） |

### 前端（`app/src/`）

| 文件 | 操作 | 说明 |
|------|------|------|
| `lib/api.ts` | 修改 | `ScoreSummary`/`ScoreData` 加 `sourceFormat` 字段；加 `createOcrTask`/`fetchOcrTask`/`cancelOcrTask`/`fetchHealth` |
| `hooks/useOcrTask.ts` | 新建 | 轮询 hook（区分网络 error 与任务 failed） |
| `components/OcrTaskCard.tsx` | 新建 | 任务卡片组件（三态渲染：running/done/failed + 重试/放弃） |
| `pages/ImportPage.tsx` | 修改 | 分区改造：MusicXML 区 + 扫描识别区；挂载时 ping `/api/health` 预判降级；处理 409（已有任务运行中） |
| `pages/LibraryPage.tsx` | 修改 | 基于 `score.sourceFormat === 'ocr'` 渲染「📷 扫描识别」标签 |

### Tauri（`src-tauri/`）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main.rs` | 修改 | setup hook：spawn node sidecar、资源路径、DB 复制、进程清理 |
| `Cargo.toml` | 修改 | 加 tauri shell feature（已部分有） |
| `tauri.conf.json` | 修改 | 配 externalBin（node）+ resources（server/jre/audiveris） |
| `build.rs` 或打包脚本 | 新建 | jlink JRE 构建、esbuild bundle、better-sqlite3 预编译 |

### 测试资产

| 文件 | 操作 | 说明 |
|------|------|------|
| `test-score-ocr.pdf` | 新建 | 仓库内置测试 PDF（单页简单旋律） |
| `test-notscore.pdf` | 新建 | 非乐谱 PDF（纯文字，断言失败） |
| `e2e/practice-flow.spec.ts` | 修改 | 加 OCR 上传 case（fixme 守卫） |

---

## 13. 风险与未决问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| **AGPL-3.0 许可证传染**（review P2） | 整个项目可能需转 AGPL | **第 9 节已列选项，需用户决策 A/B/C/D。本设计天然进程隔离契合选项 B** |
| Audiveris CLI 实际参数与文档不符 | 阶段 A 卡住 | review P0 已修正为 positional + `-transcribe`；阶段 A 先命令行手动调通再写代码 |
| Audiveris 输出 `.mxl`（压缩）而非 `.xml` | 引擎读不到输出 | review P0 已修正，复用 `extractMxl()` 解压；扫描同时匹配 `.mxl`/`.xml` |
| better-sqlite3 `.node` 在 sidecar 模式加载失败 | 桌面 App 起不来 | 阶段 C 独立验证，必要时用 SQLite WASM 替换 |
| jlink 生成的 JRE 缺 Audiveris 所需模块 | 桌面识别崩 | 逐步加模块，`-add-modules` 按错误信息迭代；至少含 `java.desktop` |
| Tesseract 找不到 tessdata | 识别崩 | 7.5 的 `TESSDATA_PREFIX` 注入契约 |
| 安装包体积过大（>300MB）用户不接受 | 分发困难 | 可考虑首次启动时下载 JRE/Audiveris（但违背零配置）—— MVP 先全打包 |
| 多页 PDF 只取首页，用户期望全曲 | 体验缺陷 | 8.8 已声明限制（`-sheets 1` 强制），后续迭代 |

**未决问题（实施时再定，不阻塞 spec）：**

- macOS MVP 选 Intel 还是 ARM 作为首发架构（取决于目标用户）。
- 是否在 ImportPage 提供"识别参数"高级选项（MVP 不做，纯默认）。
- 任务历史是否在某个页面展示（MVP 不做，任务行仅作内部状态，done 后用户从 Library 看 score）。

**已解决的 Open Question（review 提出）：**

- **`extractMetadata` 私有 + fallback 不一致**：重构 `musicxml.ts`，将私有 `extractMetadata(root, sourceXml)` 改为导出 `extractMusicXmlMetadata(root, fallbackTitle)`，第二参数接受标题 fallback。
  - `MusicXmlParser` 调用：`extractMusicXmlMetadata(root, 'Untitled')`（保持现状行为）。
  - `OcrEngine` 调用：`extractMusicXmlMetadata(root, fileNameWithoutExt)`（OCR 独有规则：扫描谱常无标题，用文件名更有意义）。
  - 两者共用同一元数据提取逻辑（标题/作曲家/tempo），仅 fallback 来源不同，不重复代码也不破坏现有测试。
