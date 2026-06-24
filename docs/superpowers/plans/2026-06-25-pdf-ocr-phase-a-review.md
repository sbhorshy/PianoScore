# PDF/图片乐谱识别（OMR）阶段 A 实现计划 Review 修改意见

## Findings

### P1: 无标题 OCR 乐谱会被命名成 `input`

计划用 `stripExt(input.filePath)` 做 fallback title，但路由保存的是临时路径 `.../input.pdf`。`inputFileName` 没有传进 `engine.recognize()`，所以无标题识别结果会被命名为 `input`，而不是用户上传的文件名。

建议 `RecognizeInput` 增加 `fallbackTitle` 或 `originalFileName`，由 runner 传入上传文件名去扩展名。

---

### P1: 409 串行约束存在并发竞态

当前计划先查 `findActive()`，但任务行直到 `runner.start()` 才创建，中间还有异步 `mkdir/writeFile`。两个并发 POST 可以同时通过 active 检查。

建议把“检查 active + 创建 pending 任务”做成一个同步/事务化 reservation，再写文件并启动 runner。

---

### P1: DELETE 没有真正取消识别进程，完成后也不清临时目录

`OcrRunner` 只有 wait helper，没有 `cancel()` 或 child process handle。DELETE 只删 DB 行和目录，运行中的 Java 仍可能继续完成并入库。

另外，成功/失败路径也没有 finally 清理 `inputPath` 所在目录。

建议：

1. 让 runner/engine 持有 child process
2. DELETE 调 `runner.cancel(id)`
3. 任务终态统一 cleanup 临时目录

---

### P1: `OcrEngine.recognize` 测试的 mock 输出目录和实现读取目录不一致

实现从 `path.dirname(input.filePath)/out` 读输出，但测试 helper 写到 `os.tmpdir()/pianoscore-ocr-test/out`，而测试传入的是 `/tmp/x/某曲谱.pdf`。

成功路径会读空目录或错误目录。

建议测试使用同一个 `tmpRoot/input.pdf`，或 mock `fs.readdir/readFile`。

---

### P1: `sourceFormat` API 测试断言了错误的响应结构

计划里的测试把 `GET /api/scores` 响应当数组用，但当前路由返回：

```ts
{ scores: listScores(db) }
```

应改成：

```ts
const body = await res.json()
expect(body.scores[0].sourceFormat).toBe('musicxml')
```

---

### P1: 多处示例会被当前 TypeScript 约束卡住

`server/tsconfig.json` 开了：

```json
"noUnusedLocals": true,
"noUnusedParameters": true,
"verbatimModuleSyntax": true
```

计划中存在会导致 typecheck 失败的示例：

- `isNull` 未使用，但计划说“保留也无妨”
- `extractMxl` 在测试中 import 后未使用
- `TEST_MUSICXML` / `ocrHelpers` 未使用
- `loadOcrConfig` 未使用
- `ocrHealth` 写了但没读
- 只作类型使用的 `OcrEngine` / `OcrRunner` 应使用 `import type`

建议逐段清掉 unused，并按 `verbatimModuleSyntax` 使用 type-only imports。

---

### P2: OCR route 测试计划前后矛盾，且 health 测试不会挂载

测试最初用 `createTestApp()`，后面又要求改成注入式 `createTestApp({ ... })`。同时 helper 修改只挂 `/api/ocr`，没有挂 `/api/health`，所以 health 测试仍会 404。

建议把 Task 8 测试片段重写成最终形态，或者把 health 测试移到 Task 9 并提供对应 test app。

---

### P2: 默认 `.mxl` 输出没有成功路径测试

计划承认 Audiveris 默认输出 `.mxl`，实现也优先找 `.mxl`；但 recognize 单测只覆盖 `input.xml`。

建议加一个真实 zip `.mxl` fixture，验证：

1. `extractMxl()`
2. XML 解析
3. 元数据提取
4. note count

这才覆盖 Audiveris 默认输出的主路径。

---

### P2: 集成测试在 ESM/Windows 下有路径问题

集成测试使用 `__dirname`，但 server 是 ESM，应使用：

```ts
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
```

另外，fixture 表写 `not-score.txt`，测试读 `not-score.pdf`，需要统一。

---

## Open Questions

### `LICENSE` 文件当前不存在

Task 10 说修改 `LICENSE`，但仓库当前没有 `LICENSE` 文件。这里应标成新建，或者先补一个项目 MIT license 文件。

### AGPL 文案建议降级为项目假设

AGPL 文案里“process isolation, keep MIT”的结论最好降级为项目假设/待法务确认，不要作为确定法律结论写死在提交信息里。

---

## 建议调整优先级

1. 先修正 fallback title 数据流，避免无标题 OCR 全叫 `input`
2. 重构任务 reservation/cancel/cleanup，解决并发和孤儿进程
3. 修正 route 与 engine 测试示例，保证按计划执行时能 typecheck
4. 加 `.mxl` 主路径测试
5. 再补集成测试路径和 AGPL 文案细节
