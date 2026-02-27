# PianoScore - 跨平台钢琴识谱练习应用

## 项目概述

PianoScore 是一个跨平台的钢琴识谱练习应用，支持 Web、桌面（Windows/macOS/Linux）和移动端。使用 TypeScript + React 前端，Python FastAPI 后端，集成 AI 识谱功能。

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                      前端层                              │
├─────────────────┬─────────────────┬─────────────────────┤
│   Web (React)   │ Tauri (桌面)    │ React Native (移动) │
│   TypeScript    │ TypeScript      │ TypeScript          │
└────────┬────────┴────────┬────────┴──────────┬──────────┘
         │                 │                   │
         └─────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   API 网关   │
                    │   (Nginx)   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │ 乐谱服务 │      │  AI 服务 │      │ 用户服务 │
    │ FastAPI │      │ FastAPI │      │ FastAPI │
    └────┬────┘      └────┬────┘      └────┬────┘
         │                │                │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │PostgreSQL│      │  GPU    │      │  Redis  │
    │ 乐谱存储 │      │ PyTorch │      │  缓存   │
    └─────────┘      │ ONNX    │      └─────────┘
                     └─────────┘
```

## 项目结构

```
pianoscore/
├── pianoscore-app/          # 前端应用 (TypeScript + React)
│   ├── src/
│   │   ├── components/      # UI 组件
│   │   │   ├── Staff.tsx    # 五线谱绘制
│   │   │   ├── Layout.tsx   # 布局组件
│   │   │   └── Navigation.tsx
│   │   ├── pages/           # 页面
│   │   │   ├── Library.tsx  # 乐谱库
│   │   │   ├── Practice.tsx # 练习模式
│   │   │   ├── AITranscribe.tsx # AI 识谱
│   │   │   └── Settings.tsx # 设置
│   │   ├── hooks/           # 自定义 Hooks
│   │   │   ├── useMIDI.ts   # Web MIDI API
│   │   │   ├── useScores.ts # 乐谱数据
│   │   │   └── usePractice.ts # 练习逻辑
│   │   ├── types/           # TypeScript 类型
│   │   │   └── music.ts     # 音乐相关类型
│   │   └── ...
│   ├── src-tauri/           # Tauri 桌面端配置
│   └── package.json
│
├── pianoscore-api/          # 后端 API (Python FastAPI)
│   ├── app/
│   │   ├── routers/         # API 路由
│   │   │   ├── scores.py    # 乐谱 CRUD
│   │   │   ├── ai.py        # AI 识谱
│   │   │   └── users.py     # 用户管理
│   │   ├── models/          # 数据模型
│   │   ├── services/        # 业务逻辑
│   │   │   └── ai_recognition.py
│   │   └── main.py          # 入口
│   └── requirements.txt
│
└── README.md
```

## 技术栈

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite
- **样式**: Tailwind CSS
- **状态管理**: Zustand + React Query
- **桌面端**: Tauri (Rust)
- **音频**: Web MIDI API, Tone.js

### 后端
- **框架**: FastAPI (Python)
- **AI/ML**: PyTorch, OpenCV
- **数据库**: PostgreSQL
- **缓存**: Redis

## 功能特性

### 已实现
- [x] 五线谱 Canvas 绘制
- [x] Web MIDI API 输入
- [x] 音符实时比对
- [x] 练习统计
- [x] 响应式 UI

### 待实现
- [ ] MusicXML 导入/导出
- [ ] AI 识谱 (PDF/Image → MusicXML)
- [ ] 用户系统
- [ ] 云端同步
- [ ] 移动端 App

## 快速开始

### 前端

```bash
cd pianoscore-app
npm install
npm run dev          # Web 开发
npm run tauri-dev    # 桌面端开发
```

### 后端

```bash
cd pianoscore-api
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 开发计划

| 阶段 | 内容 | 时间 |
|------|------|------|
| Phase 1 | 基础功能 (MIDI + 显示) | 2 周 |
| Phase 2 | AI 识谱 | 4 周 |
| Phase 3 | 用户系统 + 云端 | 2 周 |
| Phase 4 | 移动端 | 4 周 |

## 相关项目

- [PianoScore (iOS)](https://github.com/sbhorshy/PianoScore) - Swift iOS 版本
- [PianoScoreWin](https://github.com/sbhorshy/PianoScoreWin) - C# WPF Windows 版本

## 许可证

MIT
