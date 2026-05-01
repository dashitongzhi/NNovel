<div align="center">

<img src="public/icon.png" width="120" alt="NNovel Logo" />

# NNovel

### ✨ AI 长篇小说创作桌面应用 ✨

**让每一个故事，都被完整讲述。**

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-yellow.svg)](https://www.python.org/)
[![Node](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-40-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)

[中文文档](README.zh-CN.md) · [English](README.en.md) · [报告 Bug](https://github.com/dashitongzhi/NNovel/issues) · [功能建议](https://github.com/dashitongzhi/NNovel/issues)

---

</div>

## 🎯 这是什么？

**NNovel** 是一款开源的桌面长篇小说创作工具，专为网文作者设计。

通过 **多引擎协作 + 结构化记忆 + 分章管理** 的架构，让你可以安心连载数百章，保持故事的一致性和连贯性。

---

## 🌟 核心亮点

### 🖊️ 多引擎自由切换

同时接入 5 大 AI 引擎，按需选择，不被任何一家锁定：

| 引擎 | 模式 | 说明 |
|------|------|------|
| **ChatGPT** | CLI / API | OpenAI 系列，推理能力强 |
| **Gemini** | CLI / API | Google 系列，长上下文窗口 |
| **Claude** | CLI / API | Anthropic 系列，文学性出色 |
| **豆包 (Doubao)** | API | 字节跳动，中文优化，速度快 |
| **自定义** | API | 任意 OpenAI 兼容接口 |

### 📖 完整写作链路

```
构思大纲 → 逐章生成 → 暂停/续写 → 接受草稿 → 润色优化 → 分章保存
     ↑                                                    │
     └──────────── 记忆反馈 + 一致性检查 ←─────────────────┘
```

- **实时生成** — 看着文字一行行出现，随时暂停、继续、停止
- **智能润色** — 一键优化文笔，保留原意
- **分章管理** — 自动/手动分章，独立存储每章内容
- **草稿审核** — 接受前可反复修改，不满意就重新生成

### 📚 书籍库管理

- 新建、切换、删除书籍项目
- 每本书独立存储：大纲、章节、角色、设定
- 项目数据完整备份与恢复

### 🎨 液态玻璃 UI

采用 Apple Liquid Glass 设计语言，界面通透灵动：

- 自定义主题外观、字体、背景图片
- 完全复刻模式开关（精确还原设计稿）
- 沉浸式写作体验，减少视觉干扰

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 桌面容器                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │              React + TypeScript + Vite             │  │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ 写作编辑 │ │ 书籍库   │ │ 设置中心          │  │  │
│  │  │ 器面板   │ │ 管理器   │ │ (主题/引擎/代理)  │  │  │
│  │  └────┬────┘ └────┬─────┘ └────────┬──────────┘  │  │
│  │       │           │                │              │  │
│  │  ┌────▼───────────▼────────────────▼──────────┐   │  │
│  │  │           Zustand 状态管理                   │   │  │
│  │  └─────────────────┬──────────────────────────┘   │  │
│  └────────────────────┼──────────────────────────────┘  │
│                       │ HTTP API                        │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │              Flask 后端 (Python)                    │  │
│  │  ┌──────────┐ ┌─────────────┐ ┌───────────────┐   │  │
│  │  │ 多引擎   │ │ 章节管理器   │ │ 项目数据存储  │   │  │
│  │  │ 调度器   │ │ (拆分/合并)  │ │ (JSON/文件)   │   │  │
│  │  └────┬─────┘ └─────────────┘ └───────────────┘   │  │
│  │       │                                            │  │
│  │  ┌────▼─────────────────────────────────────────┐  │  │
│  │  │  ChatGPT · Gemini · Claude · 豆包 · 自定义   │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**技术栈：**

- **前端：** React 19 · TypeScript 5.9 · Vite 7 · Zustand 5 · Tailwind CSS
- **桌面端：** Electron 40
- **后端：** Flask (Python 3.10+)
- **UI 特效：** liquid-glass-react (Apple Liquid Glass)
- **工程化：** ESLint · Prettier · PostCSS

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.10（推荐 3.11+）
- **npm** >= 9

### 安装

```bash
# 克隆项目
git clone https://github.com/dashitongzhi/NNovel.git
cd NNovel

# 安装前端依赖
npm install

# 安装后端依赖
pip install flask
```

### 启动

```bash
# 标准启动（Flask + Vite + Electron 同时启动）
npm run dev

# 仅浏览器模式（调试前端用）
npm run dev:browser
```

启动后会自动打开桌面应用，在设置中心配置你的 AI 引擎 API Key 即可开始创作。

### 打包分发

```bash
# Windows 安装包
npm run dist:win

# Windows 便携版
npm run dist:win:portable
```

---

## 📋 功能清单

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 多引擎写作 | ✅ | ChatGPT / Gemini / Claude / 豆包 / 自定义 |
| 实时生成 + 暂停/续写 | ✅ | 流式输出，随时控制 |
| 智能润色 | ✅ | 一键优化文笔 |
| 分章管理 | ✅ | 自动/手动分章，独立存储 |
| 书籍库 | ✅ | 多项目管理，一键切换 |
| 设置中心 | ✅ | 主题、字体、背景、引擎、代理 |
| 液态玻璃 UI | ✅ | Apple 设计语言 |
| GPU 加速 | ✅ | 多种硬件加速模式 |
| 角色记忆系统 | 🔜 | 长篇连载角色一致性 |
| 世界观规则库 | 🔜 | 设定冲突自动检测 |
| 剧情伏笔追踪 | 🔜 | 前后文关联与提醒 |
| 一致性审查 | 🔜 | AI 自动检查逻辑矛盾 |
| RAG 检索增强 | 🔜 | 基于向量的上下文召回 |
| 可视化面板 | 🔜 | 故事状态、角色关系图谱 |

---

## 🗺️ 路线图

### Phase 1 — 核心写作 ✅
- [x] 多引擎接入
- [x] 完整写作链路
- [x] 分章管理
- [x] 书籍库

### Phase 2 — 智能记忆 🚧
- [ ] 角色设定管理（性格、关系、成长弧线）
- [ ] 世界观规则库（设定、地理、势力、历史）
- [ ] 剧情伏笔追踪（埋伏笔 → 回收 → 提醒）
- [ ] 长期记忆注入（写前自动加载相关上下文）

### Phase 3 — 质量保障
- [ ] 一致性审查系统（逻辑矛盾、角色 OOC、设定冲突）
- [ ] 题材模板库（玄幻、都市、科幻、言情等 30+ 模板）
- [ ] 追读力分析（Hook 点、爽点、微兑现追踪）
- [ ] RAG 检索增强（向量相似度 + 关键词混合召回）

### Phase 4 — 协作与生态
- [ ] 可视化 Dashboard（角色关系图谱、剧情时间线）
- [ ] 云端同步（多设备协作）
- [ ] 插件系统（自定义写作助手）
- [ ] 社区模板分享

---

## 📁 项目结构

```
NNovel/
├── app.py                 # Flask 后端入口
├── codex_engine.py        # 多引擎调度核心
├── chapter_manager.py     # 章节管理（拆分/合并/存储）
├── config.py              # 配置管理
├── data_store.py          # 项目数据持久化
├── electron/              # Electron 桌面容器
│   ├── dev-runner.cjs     # 开发模式启动器
│   └── backend-runner.cjs # 后端进程管理
├── src/                   # React 前端源码
│   ├── App.tsx            # 应用入口
│   ├── components/        # UI 组件
│   │   ├── layout/        # 布局组件
│   │   ├── modals/        # 弹窗组件
│   │   └── shared/        # 通用组件
│   ├── stores/            # Zustand 状态管理
│   ├── services/          # API 服务层
│   └── styles/            # 样式文件
├── templates/             # Flask 模板
├── static/                # 静态资源
├── background/            # 背景图片资源
└── scripts/               # 构建脚本
```

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

```bash
# Fork 并克隆
git clone https://github.com/your-username/NNovel.git
cd NNovel

# 创建功能分支
git checkout -b feature/amazing-feature

# 提交更改
git commit -m "feat: add amazing feature"

# 推送并创建 PR
git push origin feature/amazing-feature
```

---

## 📄 开源协议

本项目使用 [GPL v3](LICENSE) 协议。

---

## 🙏 致谢

- [liquid-glass-react](https://github.com/rdev/liquid-glass-react) — Apple Liquid Glass UI 实现
- 所有 AI 引擎提供商：OpenAI · Google · Anthropic · 字节跳动

---

<div align="center">

**如果 NNovel 对你有帮助，请给一个 ⭐ Star 支持一下！**

Made with ❤️ by [dashitongzhi](https://github.com/dashitongzhi)

</div>
