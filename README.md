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
- `Tests/`：跨平台核心测试（可在 Windows 执行）

## 运行要求
- iOS 15+
- 需要支持 Core MIDI 的设备

## 在 Windows 上怎么运行？

### 结论（先说重点）
这个项目当前是 **iOS App（SwiftUI + Core MIDI）**，**不能在纯 Windows 环境直接编译和运行 iOS 界面**。
原因是：
- iOS 应用打包、签名、部署依赖 Xcode 工具链
- `CoreMIDI` 属于 Apple 平台框架

### 新增：Windows 端可执行的测试能力
本仓库已新增 `Swift Package` 测试入口：
- `Package.swift` 暴露 `PianoScoreCore` 跨平台核心模块
- `Tests/PianoScoreCoreTests` 包含核心逻辑单元测试（NoteEvent、ScoreEngine、ScoreLoader）
- 这些测试不依赖 SwiftUI / CoreMIDI，可在 Windows 上运行

### Windows 测试步骤
1. 安装 Swift（Windows 版本，建议 Swift 5.9+）
2. 在仓库根目录执行：
   ```bash
   swift test
   ```
3. 预期结果：`Executed 5 tests, with 0 failures`

### 可行开发方案
1. **使用一台 Mac（推荐）**
   - 安装 Xcode 15+
   - 打开项目（或按后续补充的 `.xcodeproj` / `.xcworkspace`）
   - 选择 iOS 模拟器或真机运行

2. **在 Windows 上远程连接 Mac**
   - 通过局域网/远程桌面连接到 Mac 进行编译运行
   - 代码可在 Windows 编辑，但构建/运行放在 Mac 执行

3. **云端 Mac 服务（CI 或云主机）**
   - 使用云端 macOS 环境拉取代码
   - 在云端执行构建与测试
