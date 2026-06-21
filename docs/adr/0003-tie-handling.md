# ADR 0003: 连音线 (Tie) 在提取层消解

## 状态

已接受 (2026-05-31)

## 背景

被连音线 (Tie) 连接的两个相同音高音符，乐理上是**同一个声音、只敲击一次**，持续两个音符时值之和。但 `extractTargets.ts` 在 OSMD cursor 的每一个 onset 都生成一个 `ScoringTarget`，从不检查 tie。

结果（用户实际观察到的）：听音/跟练播放时，连音线的延续音被**重新敲响**了一次——`buildNoteEvents` 为它生成了第二个 `noteOn`。这违反乐理。连带问题：自由练习模式下用户被迫重新弹一次才能推进，`pitchAccuracy` 分母被幽灵 target 撑大。

OSMD 暴露了所需数据（已查证 bundle 实现）：

- `Note.NoteTie` — 仅被连音的音才有，区别于圆滑线 `Note.NoteSlurs`
- `Tie.StartNote` — 唯一被敲击的音（= `Tie.Notes[0]`）；链上所有音的 `NoteTie` 指向同一 Tie 对象
- `Tie.Duration` — `get Duration(){ for(e of notes) t.Add(e.Length) }`，累加整条链所有成员的合并时值

## 决策

**在提取层 `extractTargets.ts`（纯函数）消解连音线**，使领域不变量精确为：

> 一个 `ScoringTarget` = 在某 onset 上需要**重新起音**的一组音高。延续音不是起音，不进模型。

### 关键规则

1. **延续音判定靠身份，不靠音高**：`isContinuation = !!note.NoteTie && note !== note.NoteTie.StartNote`。延续音不进 `midiNotes`/`hands`/`noteDurations`。靠音高判定会把"同音反复"（无连线、各自敲击）误杀。
2. **起音承载合并时值**：起音音的 `noteDurations` 槽位用 `NoteTie.Duration.RealValue × 4`。因为 `buildNoteEvents` 用每音自己的 `noteDurations[i]` 定 `noteOff`、不看 gap——否则声音在第一段就断，连音尾段静音。
3. **逐音粒度**：部分连音和弦 `[C(连)+E+G]` → 目标 `[E,G]`，延续的 C 仅保留 gNote 着色。
4. **纯延续位置 → 空占位目标**：剔除后无新起音时返回 `midiNotes=[]`，复用现有休止符机制（`skipRestTargets` 自动跳过，timeline 保留间隙）。

下游（评分引擎、音频、光标、上色）**零改动**——单一翻译边界。

## 考虑过的方案

### 方案 A：在评分引擎里特判延续音

延续音若已在 `heldNotes` 则自动判过。

**否决原因**：破坏引擎纯粹性（引擎不应懂"连音线"）；依赖 `heldNotes` 精确反映 sustain，虚拟键盘和中途松手会崩；`pitchAccuracy` 分母仍需另外修。

### 方案 B：打 `isTieContinuation` 标记，每个消费者各自判断

**否决原因**：每个消费者都得记得检查，漏一个就出 bug。"这条数据的含义是'别把它当数据'"本身是坏味道。

## 后果

- `CursorNote` 接口扩可选字段 `NoteTie?`，保持纯函数可脱离 OSMD 单测。
- `osmd.ts` 无运行时改动（OSMD `Note` 原生带 `NoteTie`，沿用现有类型转换）。
- 圆滑线 (Slur) 明确为评分 no-op，每音照常各自起音、各自计分。
- 计分对颤音/琶音等**演奏润饰**不展开（认主音/柱式和弦）——本 ADR 只处理"音高+起音结构"忠实，润饰类计分严格度留待后续。
- 新增 `services/extractTargets.test.ts`（6 测试）覆盖：合并时值、延续音剔除、空占位、3 音连音链、部分连音和弦、同音反复不误判。
