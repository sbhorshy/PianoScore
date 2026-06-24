# PDF/图片乐谱识别（OMR）整合设计 Review 修改意见

## Findings

### P0: Audiveris CLI 契约可能不可执行

文档中的命令使用了 `-input`：

```bash
java -jar audiveris.jar -batch -export -input input.pdf -output out/
```

但 Audiveris 官方 CLI 将输入文件定义为 positional `INPUT_FILES`，没有 `-input` 参数；完整识别通常还需要 `-transcribe`。同时文档只扫描 `*.xml`，而 Audiveris 默认 MusicXML 输出是 `.mxl`，`.xml` 需要显式关闭压缩。

建议改为类似：

```bash
java -jar audiveris.jar \
  -batch \
  -transcribe \
  -export \
  -output <outDir> \
  -- <inputFile>
```

并让 `OcrEngine` 支持读取 `.mxl`，或显式设置 Audiveris 不压缩输出。

参考：

- [Audiveris CLI](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/)
- [Audiveris .mxl 输出](https://audiveris.github.io/audiveris/_pages/reference/outputs/mxl/)

---

### P1: `insertScore` 目前无法写入 `sourceFormat='ocr'`

设计中多处说明 OCR 入库时复用 `insertScore`，并写入：

```ts
sourceFormat: 'ocr'
```

但当前 `server/src/db/repo.ts` 中的 `insertScore()` 硬编码为：

```ts
sourceFormat: 'musicxml'
```

这会导致 OCR 导入的乐谱仍然被标记为 MusicXML，Library 标签也无法生效。

建议二选一：

1. 扩展 `insertScore(db, parsed, options?: { sourceFormat?: string })`
2. 新增 `insertRecognizedScore(db, parsed)` 专门用于 OCR 入库

---

### P1: LibraryPage 标签缺少 API 契约支撑

设计要求 LibraryPage 对 `sourceFormat='ocr'` 的曲谱显示「扫描识别」标签，但当前数据链路没有返回 `sourceFormat`。

需要同步修改：

- `server/src/db/repo.ts`
  - `ScoreSummary` 增加 `sourceFormat`
  - `listScores()` 返回 `sourceFormat`
  - 如需要，`FullScore` 也增加该字段
- `server/src/routes/scores.ts`
  - 保持返回结构包含 `sourceFormat`
- `app/src/lib/api.ts`
  - `ScoreSummary` 增加 `sourceFormat`
  - `ScoreData` 如页面需要也增加
- `app/src/pages/LibraryPage.tsx`
  - 基于 `score.sourceFormat === 'ocr'` 渲染标签

否则只改 LibraryPage 不够。

---

### P2: “只取第一页”不会节省处理时间

文档说多页 PDF MVP 只取第一个 XML，但如果 Audiveris 命令没有限制 sheet，它仍可能处理所有页，最后再由应用丢弃后续输出。

建议在 CLI 层限制第一页：

```bash
-sheets 1
```

否则多页 PDF 仍会带来不必要的 CPU 时间和等待时间。

---

### P2: “MVP 串行”缺少后端约束

文档说 MVP 一次只跑一个 OCR 任务，但当前设计只在前端限制一个任务卡片。后端 `POST /api/ocr` 和 `OcrRunner.start()` 没有队列、锁或拒绝策略。

建议明确其中一种后端策略：

1. 单任务锁：已有 running/pending 时返回 `409`
2. 内存队列：任务按顺序执行
3. DB 队列：pending 任务由 worker 串行消费

只靠前端限制无法防止双击、刷新恢复、并发请求或直接 API 调用。

---

### P2: 打包 Audiveris 需要补 OSS 合规说明

文档计划把 Audiveris jar 随 Tauri App 分发。Audiveris 使用 AGPL-3.0 license，设计文档目前没有覆盖发布合规风险。

建议增加一节：

- Audiveris license 声明
- 第三方依赖 notice
- 是否修改 Audiveris
- 如何提供对应源码/构建说明
- 是否接受 AGPL 对分发形态的影响

参考：

- [Audiveris GitHub](https://github.com/Audiveris/audiveris)

---

## Open Questions

### 是否导出并复用 `MusicXmlParser` 的元数据提取逻辑？

文档说 OcrEngine 复用现有 MusicXML 元数据提取逻辑，但当前 `extractMetadata()` 是 `musicxml.ts` 文件内私有函数。

另外，文档写 OCR 标题 fallback 为“文件名去扩展名”，但当前 `MusicXmlParser` fallback 是：

```ts
'Untitled'
```

建议明确：

1. 是否把 `extractMetadata()` 导出为公共 helper
2. 是否为 OCR 单独覆盖 title fallback
3. 是否统一 MusicXML 与 OCR 的 fallback 规则

---

## 建议调整优先级

1. 先修正 Audiveris CLI 和输出格式契约
2. 再修正 `sourceFormat` 的入库与 API 数据流
3. 明确后端串行策略
4. 补充 OSS 合规章节
5. 最后再细化 UI 和测试策略
