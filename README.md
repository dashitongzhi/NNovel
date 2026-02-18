# NNovel React (Liquid Glass UI)

一个基于 `React + TypeScript + Electron + Flask` 的桌面写作应用工程。  
本文档中所有路径均以项目根目录 `react_test/` 为基准（即当前工作目录）。

## 项目目标

- 在不改变核心布局的前提下，提供高质量液态玻璃风格 UI。
- 支持多模型写作流程（ChatGPT / Gemini / Claude / 豆包 / 个人配置）。
- 提供 Electron 桌面运行、GPU 诊断与硬件加速启动模式。
- 后端 Flask 接口与数据存储全部内置于本项目目录。

## 核心功能

- 写作主流程：开始 / 暂停 / 继续 / 停止 / 恢复任务
- 草稿管理：接受生成、保存草稿、删除、废弃稿恢复
- 大纲生成与章节管理：自动标题、分章保存、章节列表与删除
- 书籍管理：新建书籍、切换作品、独立项目数据
- 模型状态与环境自检：连通性测试、运行状态、配置检查
- 主题外观：浅色/深色/跟随系统、背景图库与自定义背景
- 液态玻璃风格：普通模式 / 完全复刻 UI（除按钮尺寸）

## 技术栈

- 前端：React 19、TypeScript、Vite、Zustand
- 桌面端：Electron
- 后端：Flask（Python）
- UI 特效：`liquid-glass-react`
- 工具链：ESLint、Prettier、PostCSS、Tailwind（基础配置）

## 运行环境

- Node.js 18+
- npm 9+
- Python 3.10+（建议 3.11+）
- Windows（当前脚本和 GPU 策略主要面向 Windows）

## 快速开始

```bash
npm install
npm run dev
```

默认将同时启动：

- Flask 后端：`http://127.0.0.1:5050`
- Vite 前端：`http://127.0.0.1:5174`
- Electron 桌面窗口

仅浏览器调试：

```bash
npm run dev:browser
```

## 常用脚本

### 基础

- `npm run dev`：标准开发模式（后端 + 前端 + Electron）
- `npm run build`：TypeScript 构建 + Vite 打包
- `npm run lint`：ESLint 检查
- `npm run format`：Prettier 格式化

### GPU / 硬件加速相关

- `npm run dev:hw`：硬件加速（D3D11）
- `npm run dev:hw:compat`：兼容配置
- `npm run dev:hw:diag`：带 GPU 诊断日志
- `npm run dev:hw:gl`：ANGLE `gl` 后端
- `npm run dev:hw:d3d11on12`：ANGLE `d3d11on12` 后端
- `npm run dev:gpu:strict`：严格硬件模式（含诊断）
- `npm run dev:gpu:nosandbox`：关闭沙箱尝试硬件路径
- `npm run dev:gpu:desktop-gl`：桌面 GL 路径
- `npm run dev:gpu:verbose`：详细 GPU 日志（写入 `gpu-debug.log`）

## 配置与数据

### 前端/项目配置

- `settings.json`：项目全局配置（模型、代理、思考等级等）
- `settings.prev.json`：配置备份
- `auth.json`：本地密钥配置
- `auth.prev.json`：密钥备份

### 数据目录

运行期数据默认写入：

- `data/`：书籍、草稿、章节索引等结构化数据
- `novel/`（由后端按需创建）：章节输出文本

### 运行时提示

- 本项目后端入口为根目录 `app.py`，运行时不依赖外部工程目录。
- 若使用 `codex` CLI，`model_reasoning_effort` 建议使用 `low/medium/high`。

## 后端接口（摘要）

`app.py` 提供以下核心 API 分组：

- 配置/状态：`/api/config`、`/api/status`、`/api/self-check`
- 模型与引擎：`/api/engine/*`
- 写作流程：`/api/generate/*`
- 草稿与废弃稿：`/api/draft*`、`/api/discarded*`
- 章节与大纲：`/api/chapter/*`、`/api/chapters*`、`/api/outline/generate`
- 书籍：`/api/books*`

## 项目结构

```text
react_test/
├─ app.py
├─ codex_engine.py
├─ chapter_manager.py
├─ data_store.py
├─ config.py
├─ electron/
│  ├─ backend-runner.cjs
│  ├─ dev-runner.cjs
│  └─ main.cjs
├─ src/
│  ├─ components/
│  │  ├─ layout/
│  │  │  ├─ Sidebar.tsx
│  │  │  ├─ Toolbar.tsx
│  │  │  ├─ DraftPanel.tsx
│  │  │  ├─ GenerationPanel.tsx
│  │  │  └─ DiscardedPanel.tsx
│  │  ├─ modals/
│  │  │  └─ ModalHost.tsx
│  │  └─ shared/
│  │     ├─ ConfigSelect.tsx
│  │     ├─ LiquidGlassFrame.tsx
│  │     ├─ LiquidGlassShowcase.tsx
│  │     ├─ ModelIdListEditor.tsx
│  │     └─ ToastStack.tsx
│  ├─ config/
│  │  ├─ defaults.ts
│  │  ├─ backgroundLibrary.ts
│  │  └─ liquidGlassPresets.ts
│  ├─ services/
│  │  ├─ apiClient.ts
│  │  └─ endpoints/
│  ├─ stores/
│  │  ├─ configStore.ts
│  │  ├─ draftStore.ts
│  │  ├─ generationStore.ts
│  │  ├─ discardedStore.ts
│  │  └─ uiStore.ts
│  ├─ styles/
│  │  ├─ legacy.css
│  │  └─ react-overrides.css
│  ├─ types/
│  │  ├─ api.ts
│  │  └─ domain.ts
│  ├─ utils/
│  │  └─ memory.ts
│  ├─ App.tsx
│  ├─ index.css
│  └─ main.tsx
├─ background/
├─ data/
├─ docs/
├─ public/
├─ scripts/
│  └─ set-gpu-preference.cjs
├─ templates/
├─ static/
├─ package.json
└─ vite.config.ts
```

## 开发说明

- 样式主入口建议优先改 `src/styles/react-overrides.css`。
- 布局组件建议在 `src/components/layout` 中调整，避免散改。
- 液态玻璃壳组件统一走 `src/components/shared/LiquidGlassFrame.tsx`。
- 状态管理优先维护对应 store，避免在组件中堆叠跨域状态逻辑。

## 当前状态

- 已支持前后端一体化本地开发。
- 已具备 GPU 诊断链路与多种硬件模式启动脚本。
- 已支持背景图库、设置弹窗、写作主流程、章节与书籍管理。
