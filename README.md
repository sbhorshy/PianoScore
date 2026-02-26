# PianoScore - 钢琴识谱练习 App

一个基于 **SwiftUI + Core MIDI** 的 iOS 识谱练习应用。

## MVP 功能
- MusicXML 乐谱导入（当前为最小解析占位实现）
- 高音谱表显示
- MIDI 键盘输入接口（状态管理）
- 单声部音符比对
- 正确 / 错误 / 漏弹反馈

## 目录结构
- `App/`：应用入口
- `Core/`：模型、引擎、MIDI、解析器、服务
- `Features/`：列表、查看、练习、设置模块
- `DesignSystem/`：主题色与视觉常量

## 运行要求
- iOS 15+
- 需要支持 Core MIDI 的设备
