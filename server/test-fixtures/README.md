# OCR 测试 Fixture

集成测试 `src/ocr/__tests__/integration.test.ts` 需要以下 fixture（**需手动准备**）：

## score-ocr.pdf
- **用途**：断言 Audiveris 能成功识别出 MusicXML
- **要求**：单谱表、C 大调四分音符音阶 4-8 个音符
- **关键**：简单到 Audiveris 几乎不会认错，保证测试稳定
- **准备方式**：用 MuseScore 导出 PDF，或从公开免版税乐谱截取单页

## not-score.pdf
- **用途**：断言非乐谱输入触发失败（no_output / low_confidence）
- **要求**：真实文字 PDF（不是改名文件——直接用一段纯文本通过浏览器/Word 打印为 PDF）
- **文件名**：统一 `.pdf` 扩展名

## 运行方式
集成测试带 `PIANOSCORE_AUDIVERIS_JAR` 守卫：
```bash
export PIANOSCORE_AUDIVERIS_JAR=/path/to/audiveris.jar
export PIANOSCORE_JAVA=/path/to/java          # 可选，默认 PATH
export PIANOSCORE_TESSDATA=/path/to/tessdata   # 可选
cd server && npx vitest run src/ocr/__tests__/integration.test.ts
```
无 `PIANOSCORE_AUDIVERIS_JAR` 时整个 describe 跳过，不依赖 fixture 存在。
