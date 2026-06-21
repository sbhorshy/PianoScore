# PianoScore TODO

> 2026-05-31 grilling session 确认的功能规划和实现顺序。
> 架构决策详见 `docs/adr/0002-position-tracker-separation.md`。

## 当前进度总览（2026-06 更新）

| 阶段 | 内容 | 状态 |
|------|------|------|
| Step 0 | 重构 — Position Tracker 分离 | ✅ 完成（E2E 行为验证仍待补） |
| Step 1A | noteOff 追踪 + 虚拟键盘持音显示 | ✅ 完成 |
| Step 1B | 光标 + 时钟系统 | ✅ 完成 |
| Step 2A | 听音模式 | ✅ 完成 |
| Step 2B | 跟练模式 | ✅ 完成 |
| Step 3 | 小节范围选择 + 循环 | ✅ 完成（拖拽选择延后） |

**核心路线图已全部落地。** 下方"未来功能（未排期）"为下一步候选。详细实现与测试覆盖见 [CODEBASE_SUMMARY.md](./CODEBASE_SUMMARY.md)。

## 实现路线图

### Step 0: 重构 — Position Tracker 分离

**目标**：从 `ScoringState` 提取 `targetIndex` 为独立 Position Tracker，不改用户可见行为。

- [x] 新增 `PositionState` 接口和 `EventDrivenPosition` 实现
- [x] 重构 `engine.ts`：移除 `targetIndex`，`applyNoteOn` 改为 `judgeNoteOn`，接收 `currentTarget` 参数
- [x] 新增 `TargetTimeline`：从 `ScoringTarget[]` 预计算 onsets/durations
- [x] 重构 `usePractice`：Position State 和 Scoring State 分开管理
- [x] 所有现有 17 个 `engine.test.ts` 测试重写并继续通过
- [ ] E2E 测试验证行为不变

### Step 1A (并行): Feature 2 — noteOff 追踪 + 虚拟键盘持音显示

**目标**：追踪按住/松开状态，虚拟键盘分色显示左右手。

- [x] `ScoringState` 新增 `heldNotes: Map<number, Hand | null>`
- [x] 新增 `judgeNoteOff(state, note)` → 更新 heldNotes（同时修复 chord window bug）
- [x] `usePractice` 新增 `noteOff` reducer action
- [x] `PracticePage` 新增 useEffect 监听 noteOff 事件并 dispatch
- [x] `VirtualKeyboard` 重构为 6 状态渲染：
  1. 默认
  2. required-to-press（当前 target 音符）
  3. currently-pressed（用户正在按）
  4. holding-from-previous（前一个 target 的音还在按着）
  5. wrong-note（错音，红色）
  6. other-hand-reference（非活跃手的参考音，淡色）
- [x] 颜色方案：右手蓝、左手绿、错音红
- [x] 单手模式下非活跃手淡色显示（不隐藏）

### Step 1B (并行): Feature 4 — 光标 + 时钟系统

**目标**：乐谱上显示位置指示器，支持事件驱动和时钟驱动两种推进方式。

- [x] 新增 `TempoDrivenPosition`：`tempoTick()` 按时钟 + TargetTimeline 推进 targetIndex
- [x] 时钟/节拍器系统：`useClock` hook 基于 `requestAnimationFrame`
- [x] OSMD 光标显示：`showCursor()` / `hideCursor()` / `setCursorPosition()`
- [x] 音符颜色状态系统：
  - 未来：默认黑色
  - 当前 target：蓝色高亮
  - 已完成正确：绿色
  - 已完成错误：红色
  - 跟练 missed：灰色
  - 参考手：淡灰色
- [x] 自动滚动：`scrollIntoView({ behavior: 'smooth' })`，光标锚定在视口中心
- [x] 光标在自由练习模式：弹对即跳（事件驱动）
- [x] `tempoTick` 纯函数可用于跟练/听音模式（时钟驱动，卡拉OK式）

### Step 2A: Feature 1 — 听音模式

**目标**：自动播放乐曲，用户只听不弹。

- [x] 新增 `usePlayback` hook（独立于评分引擎）
- [x] `useMIDI` 扩展输出功能：`sendNoteOn` / `sendNoteOff` / `outputs` / `connectOutput`
- [x] 新增 `AudioOutput` 接口：
  - `MidiOutput`：发送 MIDI 消息到用户电钢琴
  - `ToneJsOutput`：使用 `@tonejs/piano` 浏览器内发声（懒加载 + 进度提示）
  - `WebAudioSynth`：备用合成器（纯 Web Audio API）
- [x] 音频选择逻辑：有 MIDI 设备 → 默认 MIDI out，否则 → Tone.js / WebAudioSynth
- [x] `@tonejs/piano` 懒加载：首次点"听音"时动态 import 加载
- [x] Service Worker 缓存：`public/sw.js` 缓存钢琴采样，离线可用
- [x] 听音模式 UI：PracticeStyle 选择器 (Free/Listen/Follow)
- [x] 听音模式使用 `TempoDrivenPosition` 推进光标
- [x] 速度控制：SettingsPage 存默认速度，PracticePage 可临时覆盖

### Step 2B: 跟练模式

**目标**：卡拉OK式跟弹，光标按乐谱时间线推进，用户跟上节拍。

- [x] 跟练模式使用 `TempoDrivenPosition`
- [x] 评分引擎在跟练模式的行为：
  - 时钟推进到新 target → 旧 target 结算（`settleTarget`）
  - 用户弹的音匹配当前 target → 标记命中
  - target 时间窗口过去后，未弹的音标记为 missed
  - 部分评分：记录 notesHit / notesExpected（如和弦弹了 2/3）
- [x] `ScoringState` 新增字段：`missed`, `notesHit`, `notesExpected`
- [x] 速度设置 UI：PracticePage 工具栏显示速度控制（仅在跟练/听音模式可见）
- [x] 默认速度：0.5x
- [x] 速度范围：0.3x – 1.8x

### Step 3: Feature 3 — 小节范围选择 + 循环

**目标**：用户可以选定练习/听音的小节范围。

- [x] `OsmdService` 新增小节级 DOM 属性（`data-pianoscore-measure`）
- [x] 小节范围输入方式（下拉框 MVP + 点击小节）：
  1. [x] 下拉框选择起始/结束小节号（MVP）
  2. [x] 点击两个小节设定范围
  3. [ ] 拖拽选择（高级 UX，后续迭代）
- [x] `rangeFilter.ts` 纯函数按 measureNumber 过滤 targets
- [x] 范围外小节灰显（OsmdScore reference color）
- [x] 循环行为：Repeat ON + 有范围 → 范围内循环，完全重置评分
- [x] 循环行为：Repeat ON + 无范围 → 全曲循环，完全重置评分
- [x] UI 位置：PracticePage 工具栏（小节选择器 + Repeat toggle）

## 未来功能（未排期）

### 节奏评分 (Rhythm Scoring)
- 利用 `applyNoteOff` 的时间戳计算用户弹奏的实际时值
- 与乐谱规定时值对比，给出节奏准确度评分
- 依赖：Step 1A（noteOff tracking）+ Step 1B（时钟系统）

### 练习历史统计
- Session 列表按模式筛选（自由/跟练/左右手）
- 跟练模式 session 记录速度设置
- 长期进度追踪

### 光标样式自定义
- 用户可选光标样式（细线/色带/渐变）
- 颜色主题设置

### ~~Service Worker 缓存 @tonejs/piano~~ (已在 Step 2A 实现)
- [x] `public/sw.js`：cache-first 策略缓存钢琴采样
- [x] `main.tsx` 中注册 Service Worker
- [x] 离线也能用听音模式

## 实现顺序依赖图

```
Step 0: 重构（Position Tracker 分离）
  ├── Step 1A: Feature 2 (noteOff + 虚拟键盘) ──┐
  └── Step 1B: Feature 4 (光标 + 时钟) ──────────┤
                                                   ├── 都不互为依赖
      Step 2A: 听音模式 ←──────── 依赖 1B ───────┤
      Step 2B: 跟练模式 ←──────── 依赖 1B ───────┤
                                                   │
      Step 3: 小节范围 ←────────── 依赖 1B ───────┘
```
