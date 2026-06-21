# ADR 0001: 单手/双手练习模式架构

## 状态

已接受 (2025-05-30)

## 背景

PianoScore 需要支持单手（左手或右手）和双手同时练习模式。用户可以选择只练习一只手的音符，另一只手的音符以灰色参考显示。

核心挑战：
1. 当前评分引擎和 NoteTarget 数据模型没有"手"的概念
2. 一个和弦（同一 onset）可能同时包含左右手的音符（跨手和弦）
3. 需要向后兼容已有的 midiNotes 数组结构

## 决策

### 1. 手分配数据来源：MusicXML `<staff>` 标签 + 音高回退

优先读取 MusicXML 中的 `<staff>` 元素（`1` = 右手/上谱表，`2` = 左手/下谱表）。当 `<staff>` 缺失时，按 MIDI 音高范围回退（≥ 60 → 右手，< 60 → 左手）。

**未选择方案**：
- 始终按音高推断：不可靠——左手完全可能弹到高音区
- 按 `<part>` 分配：钢琴曲通常只有一个 part

### 2. NoteTarget 数据模型：平行 `hands[]` 数组

```typescript
interface NoteTarget {
  midiNotes: number[]              // 保持不变
  hands: ('left' | 'right')[]     // 新增，与 midiNotes 一一对应
  // ...其余字段不变
}
```

**未选择方案**：
- 改 `midiNotes` 为 `{ midi, hand }[]` 对象数组：破坏所有遍历 midiNotes 的现有代码
- 分成 `rightHand[]` + `leftHand[]` 两个字段：和弦判断变复杂

### 3. 过滤层：PracticePage

过滤在 PracticePage 组件层执行，不改评分引擎。过滤后的 targets（只含选中手的 midiNotes）传给 usePractice。

**未选择方案**：
- 在评分引擎内过滤：破坏纯函数设计，引入"手"的概念
- 在 usePractice 内过滤：hook 不应知道业务领域概念

### 4. 跨手和弦处理：保留 target，过滤音符

跨手和弦（一个 target 同时包含左右手音符）在单手模式下保留为完整 target，但只传选中手的音符给评分引擎。

**未选择方案**：
- 跳过整个 target：太浪费，跨手和弦很常见
- 拆成两个独立 target：破坏 onset 一致性

## 影响

### 后端改动
- `score_notes` 表新增 `hand` 列（`'left' | 'right'`）
- MusicXmlParser 读取 `<staff>` 标签，解析时标记每条 note 的 hand
- `NoteTarget` 类型新增 `hands` 字段
- `sessions` 表新增 `practiceMode` 列

### 前端改动
- `PracticePage` 新增模式选择器 UI
- `PracticePage` 新增按手过滤 targets 的逻辑
- `Staff` 组件区分"目标音符"和"参考音符"颜色
- `VirtualKeyboard` 只高亮选中手的键
- `targetsToDisplayNotes` 利用 hands 数组分配谱表（替代纯音高 assignStaff）

### 不需要改动
- 评分引擎 (`scoring/engine.ts`) — 完全不变
- usePractice hook — 完全不变
- useMIDI hook — 完全不变
- API 客户端 — 只需新增 practiceMode 参数

## 实现注记（2026-06 补充）

> 以下记录本 ADR 写作时的计划与最终实现的偏差，正文保持原样以保留决策历史。

- **`score_notes` 表最终未创建**：`hand` 信息没有进入数据库。最终架构（详见 ADR 0003）让 targets 在前端运行时从 MusicXML 经 OSMD cursor walk 提取，`hands[]` 作为 `ScoringTarget` 的运行时字段存在，服务端只存原始 `sourceXml`。
- **MusicXmlParser 不提取 hand**：`<staff>` 标签的解析改在前端 `extractTargets.ts` 完成（staff 1 = right, staff 2 = left），后端解析器只负责元数据（title/composer/tempo）。
- **`sessions.practiceMode` 列**：按计划新增，已落地。
- **过滤层位置**：计划在 PracticePage，实际实现延续该决策（`rangeFilter.ts` + PracticePage 组合过滤）。
