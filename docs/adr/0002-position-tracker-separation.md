# ADR 0002: 位置追踪与评分引擎分离

## 状态

已接受 (2026-05-31)

## 背景

PianoScore 计划新增跟练模式（tempo-driven）和听音模式。现有架构中，`targetIndex`（"当前在乐谱的第几个 target"）由评分引擎内部管理——`applyNoteOn()` 在弹对时调用 `advance()` 推进 `targetIndex`。

这导致两个问题：

1. **推进方式与判断逻辑耦合**：跟练模式需要按节拍自动推进 `targetIndex`，但现有引擎只在弹对时才推进。硬塞进引擎需要加 mode flag，使纯函数变成状态机。
2. **光标渲染依赖评分状态**：光标需要读取 `targetIndex`，但在听音模式下没有评分——光标位置没有来源。

## 决策

将 `targetIndex` 从 `ScoringState` 中提取为独立的 **Position Tracker** 概念。

### 架构

```
Position Tracker（管理 targetIndex）
  ├── EventDrivenPosition（自由练习：收到 correct judgment → 前进）
  └── TempoDrivenPosition（跟练/听音：时钟 tick → 按 timeline 前进）

Scoring Engine（只管判断）
  ├── judgeNoteOn(state, note, currentTarget) → judgment
  └── applyNoteOff(state, note) → state（更新 heldNotes）
```

### 关键变更

| 之前 | 之后 |
|------|------|
| `ScoringState` 包含 `targetIndex` | `targetIndex` 由 Position Tracker 管理 |
| `applyNoteOn` 返回新 state（含 targetIndex） | `judgeNoteOn` 接收 `currentTarget` 参数，返回 judgment |
| 评分引擎自己决定何时推进 | Position Tracker 根据模式决定何时推进 |
| 光标读 `ScoringState.targetIndex` | 光标读 `PositionState.targetIndex` |

### 新增概念：TargetTimeline

从 `ScoringTarget[]` 预计算每个 target 的节拍位置，供 `TempoDrivenPosition` 使用：

```ts
interface TargetTimeline {
  onsets: number[]       // 每个 target 在第几拍开始
  durations: number[]    // 每个 target 持续几拍
  totalBeats: number
}
```

## 考虑过的方案

### 方案 A：在评分引擎内加 mode flag

在 `applyNoteOn` 内加 `mode: 'free' | 'follow'` 参数，follow 模式下忽略推进逻辑。

**否决原因**：违反单一职责。评分引擎变成同时管判断和位置，跟练/听音模式的时钟逻辑会侵入纯函数。

### 方案 B：保持现有架构，跟练模式不经过评分引擎

跟练模式直接在 PracticePage 里管理 `targetIndex`，绕过 `usePractice`。

**否决原因**：评分逻辑分散在两处，无法共享 `heldNotes`、partial scoring 等基础设施。

## 后果

- 现有 17 个 `engine.test.ts` 测试需要重写：测试从"调用 `applyNoteOn` 检查新 state"变为"调用 `judgeNoteOn` 检查 judgment"。
- `usePractice` hook 需要重构：同时管理 `PositionState` 和 `ScoringState`。
- Feature 2（noteOff + heldNotes）和 Feature 4（光标 + 时钟）可以并行开发，因为它们修改不同的子系统。
