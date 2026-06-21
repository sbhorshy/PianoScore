# PianoScore

> 跨平台钢琴识谱练习应用 —— 导入 MusicXML 乐谱，用 MIDI 键盘或虚拟键盘跟弹，实时比对音高并评分。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#许可证)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-success.svg)](#桌面端tauri)
[![Frontend](https://img.shields.io/badge/frontend-React%2019-61dafb.svg)](https://react.dev)
[![Backend](https://img.shields.io/badge/backend-Hono%20%2B%20SQLite-orange.svg)](https://hono.dev)

PianoScore 把乐谱变成可交互的练习场：导入任意 MusicXML 钢琴谱，选择练习模式，跟随乐谱光标弹奏，应用实时判断音高正误、为音符上色、记录练习成绩。支持 Web 浏览器与 Tauri 桌面端两种部署形态。

> 📖 面向开发者的完整文档见 [CODEBASE_SUMMARY.md](./CODEBASE_SUMMARY.md)，AI 协作约定见 [CLAUDE.md](./CLAUDE.md)，领域术语精确定义见 [CONTEXT.md](./CONTEXT.md)。

## ✨ 功能特性

**乐谱与练习**
- 📥 导入 MusicXML 乐谱（服务端解析后仅存原始 `sourceXml`，练习目标运行时由 OSMD 提取）
- 🎯 实时音高比对与评分（纯函数评分引擎，支持和弦集合匹配）
- 🎹 双输入：MIDI 键盘 + 屏幕虚拟键盘（按键分色显示左右手与按压状态）
- 📍 乐谱光标 + 音符状态上色（当前 / 未来 / 正确 / 错误 / 漏弹 / 参考手）

**三种推进模式（与练习模式正交组合）**

| 模式 | 说明 |
|------|------|
| **自由练习 (Free)** | 事件驱动：弹对才推进，无时间压力 |
| **跟练模式 (Follow)** | 时钟驱动：光标按乐谱时间线推进（卡拉 OK 式），支持部分评分（如和弦命中 2/3）|
| **听音模式 (Listen)** | 自动播放全曲，用户只听不弹，可调速 |

**三种练习模式（手）**

| 模式 | 说明 |
|------|------|
| **右手 / 左手** | 双谱表完整显示，非活跃手以灰色参考显示，仅选中手参与评分 |
| **双手** | 所有音符参与评分（默认） |

**更多能力**
- 🔁 小节范围选择 + 循环练习（完全重置评分）
- ⏩ 速度控制（0.3x – 1.8x，默认 0.5x）
- 🔊 多音频输出：MIDI Out（电钢琴）/ Tone.js（浏览器内钢琴采样）/ WebAudio 合成器（兜底）
- 💾 Service Worker 缓存钢琴采样，离线可用听音模式
- 📊 练习历史记录（按 session 存储准确度、时长、模式）

## 🛠 技术栈

| 层 | 目录 | 技术 |
|----|------|------|
| 前端 | `app/` | React 19、Vite 7、TypeScript、OpenSheetMusicDisplay (OSMD)、shadcn/ui + Radix UI、Tailwind CSS、framer-motion、@tonejs/piano |
| 后端 | `server/` | Node、Hono、Drizzle ORM、SQLite (better-sqlite3)、fast-xml-parser、fflate |
| 桌面 | `src-tauri/` | Tauri v1 (Rust)，加载 `app/` 构建产物 |
| 测试 | — | Vitest（前端 + 后端单元/集成）、Playwright（E2E） |

## 📁 项目结构

```
PianoScore/
├── app/                # 前端（React 19 + Vite + OSMD）— 活跃
│   └── src/
│       ├── services/      # osmd.ts、extractTargets.ts、audio.ts、api.ts
│       ├── scoring/       # 纯函数评分引擎 + 位置追踪 + 时间线 + 范围过滤
│       ├── hooks/         # usePractice、usePlayback、useClock、useMIDI、useSettings
│       ├── components/    # OsmdScore、VirtualKeyboard、Navigation、ui/
│       ├── pages/         # Library / Practice / AIScan / Settings
│       └── lib/           # api.ts、utils.ts
├── server/             # 后端（Node + Hono + Drizzle）— 活跃
│   └── src/
│       ├── routes/        # scores、sessions、import
│       ├── parsing/       # ScoreParser 接口 + MusicXmlParser（可注册扩展）
│       └── db/            # Drizzle schema + repo
├── src-tauri/          # Tauri 桌面壳
├── e2e/                # Playwright E2E
├── docs/adr/           # 架构决策记录（ADR）
└── package.json        # 仅承载 Tauri CLI + Playwright 工具
```

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 20（Vite 7 / React 19 要求）
- **npm** ≥ 10
- 构建后端原生模块 `better-sqlite3` 需要本机 C++ 编译工具链（Windows: `npm i -g windows-build-tools` 或 VS Build Tools；macOS/Linux: Python + make + g++）
- **桌面端额外**：[Rust](https://rustup.rs/) 工具链 + Tauri v1 [系统依赖](https://tauri.app/v1/guides/getting-started/prerequisites)

### 安装与启动

```bash
# 1. 安装依赖（前端 + 后端分别安装）
cd app    && npm install      # 前端（含 OSMD、@tonejs/piano）
cd ../server && npm install   # 后端（含 better-sqlite3 原生模块）

# 2. 启动开发服务器（开两个终端，或后台运行）
cd server && npm run dev      # 后端  http://localhost:8000
cd app    && npm run dev      # 前端  http://localhost:5173 （/api 代理到 :8000）
```

打开 http://localhost:5173 即可使用。导入一份 MusicXML（仓库根目录有示例 `test-score.xml`）开始练习。

## 💻 开发命令

| 范围 | 命令 | 说明 |
|------|------|------|
| **前端** (`app/`) | `npm run dev` | Vite dev server :5173 |
| | `npm run build` | `tsc -b` + Vite 生产构建 |
| | `npm run lint` | ESLint |
| | `npx vitest run` | 全部前端测试 |
| | `npx vitest run src/scoring/engine.test.ts` | 单个测试文件 |
| **后端** (`server/`) | `npm run dev` | tsx watch :8000 |
| | `npm run typecheck` | `tsc --noEmit` |
| | `npm test` | vitest run（parser + 集成测试）|
| | `npm run db:push` | drizzle-kit 推送 schema |
| **E2E** (根目录) | `npm run e2e` | Playwright（需先启动前后端）|
| **桌面** (根目录) | `npm run tauri-dev` | Tauri 开发模式 |
| | `npm run tauri-build` | Tauri 生产构建 |

**完整校验一键命令：**

```bash
cd app && npm run build && npx vitest run \
  && cd ../server && npm run typecheck && npm test
```

> ⚠️ E2E 测试配置了 `reuseExistingServer: true`，运行前**必须手动启动**前后端 dev server。

## 🏗 架构概览

**核心数据流（练习）：**

```
MusicXML 上传 → POST /api/import → MusicXmlParser → SQLite（存原始 sourceXml）
                                                                ↓
PracticePage 加载 → fetch /api/scores/:id → OsmdService.load(xml)
    → OSMD 游标遍历 → extractTargets() → ScoringTarget[]
                                                                ↓
MIDI / 虚拟键盘 → NoteEvent → usePractice → scoring/engine.ts（纯函数比对）
    → UI 重渲染 + OSMD 着色 → 完成时 POST /api/scores/:id/sessions
```

**关键设计决策：**
- **练习目标不入库** —— 运行时由 OSMD 游标遍历从 MusicXML 提取，服务端只存原始 `sourceXml`，避免数据冗余与同步问题。
- **评分引擎纯函数化** —— 判定逻辑与 React / OSMD 完全解耦，更换规则只动 `app/src/scoring/`。
- **解析器可注册扩展** —— 新增乐谱格式只需实现 `ScoreParser` 接口并 `register()`，符合开闭原则。
- **Position Tracker 分离** —— 事件驱动（自由练习）与时钟驱动（跟练 / 听音）共用同一套 target 时间线。

完整的架构图解、API 端点、组件层次、数据库 Schema、测试覆盖详见 [CODEBASE_SUMMARY.md](./CODEBASE_SUMMARY.md)。架构决策记录见 [`docs/adr/`](./docs/adr/)。

## 🧩 桌面端（Tauri）

桌面端复用 `app/` 的构建产物，通过 Tauri v1 (Rust) 打包为原生应用：

```bash
npm run tauri-dev     # 开发模式（热重载）
npm run tauri-build   # 产出各平台安装包
```

> Tauri v1（非 v2）。Linux 需 `libgtk-3-dev libwebkit2gtk-4.0-dev libsoup2.4-dev librsvg2-dev`；macOS 需 Xcode Command Line Tools；Windows 需 WebView2 runtime（Win10/11 一般已内置）。

## 📚 相关文档

| 文档 | 内容 |
|------|------|
| [CODEBASE_SUMMARY.md](./CODEBASE_SUMMARY.md) | 完整代码库文档：架构图、API、组件层次、DB Schema、测试矩阵 |
| [CLAUDE.md](./CLAUDE.md) | AI 协作约定、命令清单、设计原则、已知问题 |
| [CONTEXT.md](./CONTEXT.md) | 领域术语精确定义（手 / 起音 / 连音线 / 推进模式 等）|
| [TODO.md](./TODO.md) | 功能路线图与实现进度 |
| [docs/adr/](./docs/adr/) | 架构决策记录（练习手模式、Position Tracker 分离、Tie 处理）|

## 🔗 相关项目

- [PianoScore (iOS)](https://github.com/sbhorshy/PianoScore) — Swift iOS 版本
- [PianoScoreWin](https://github.com/sbhorshy/PianoScoreWin) — C# WPF Windows 版本

## 🤝 贡献

欢迎提 Issue 与 Pull Request。提交前请跑一遍[完整校验命令](#-开发命令)确保 `build + lint + test` 全绿。TypeScript 配置较严格（`verbatimModuleSyntax` / `noUnusedLocals`），新增代码请遵循既有风格。

## 📄 许可证

[MIT](./LICENSE)
