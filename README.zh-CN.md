# NNovel React (Liquid Glass UI)

> Paths in this document are relative to the project root: `react_test/`.
> 本文档中所有路径均以项目根目录 `react_test/` 为基准。

---

## 中文文档（CN）

### 1) 项目简介

`NNovel React` 是一个桌面小说写作应用，前端采用 `React + TypeScript + Vite`，桌面容器为 `Electron`，后端为 `Flask`。  

### 2) 项目结果（当前实现）

- 已实现前后端一体化开发运行：`Vite + Electron + Flask` 同时启动。
- 已实现多引擎写作：ChatGPT / Gemini / Claude / Doubao / Personal（个人配置）。
- 已实现完整写作链路：生成、暂停、继续、停止、恢复、接受草稿、润色、分章、保存章节。
- 已实现书籍库：新建书籍、切换书籍、按书籍独立存储项目数据和章节输出。
- 已实现设置中心：主题外观、字体、背景、辅助功能、接入方式、代理、配置文件编辑。
- 已实现液态玻璃 UI 与「完全复刻 UI（除按钮尺寸）」开关。
- 已实现 GPU 多启动模式、GPU 诊断日志、硬件加速状态可视化（Electron 控制台日志）。

### 3) 技术栈

- 前端：React 19、TypeScript、Vite、Zustand
- 桌面端：Electron 40
- 后端：Flask（Python）
- 样式与特效：CSS + `liquid-glass-react`
- 工程化：ESLint、Prettier、PostCSS、Tailwind（基础配置）

### 4) 依赖项（完整）

#### 4.1 运行环境依赖

- Node.js `>=18`
- npm `>=9`
- Python `>=3.10`（推荐 `3.11+`）
- Windows（GPU 启动脚本与注册表偏好脚本主要面向 Windows）

#### 4.2 Node 运行时依赖（`dependencies`）

| 包名 | 版本 |
| --- | --- |
| balanced-match | ^4.0.2 |
| liquid-glass-react | file:../../git clone/liquid-glass-react |
| react | ^19.2.0 |
| react-dom | ^19.2.0 |
| zustand | ^5.0.11 |

#### 4.3 Node 开发依赖（`devDependencies`）

| 包名 | 版本 |
| --- | --- |
| @eslint/js | ^9.39.1 |
| @types/node | ^24.10.1 |
| @types/react | ^19.2.7 |
| @types/react-dom | ^19.2.3 |
| @vitejs/plugin-react | ^5.1.1 |
| concurrently | ^9.2.1 |
| cross-env | ^10.1.0 |
| electron | ^40.4.1 |
| eslint | ^9.39.1 |
| eslint-config-prettier | ^10.1.8 |
| eslint-plugin-react-hooks | ^7.0.1 |
| eslint-plugin-react-refresh | ^0.4.24 |
| globals | ^16.5.0 |
| autoprefixer | ^10.4.22 |
| postcss | ^8.5.6 |
| prettier | ^3.8.1 |
| tailwindcss | ^3.4.17 |
| typescript | ~5.9.3 |
| typescript-eslint | ^8.48.0 |
| vite | ^7.3.1 |
| wait-on | ^9.0.4 |

#### 4.4 Python 依赖

- 必需：`flask`
- 可选：
  - `pypinyin`（用于中文书名 slug 转换）
  - `tomli`（仅 Python `<3.11` 需要，`tomllib` 回退）

#### 4.5 外部 CLI（按模式可选）

- ChatGPT CLI：`codex`（CLI 模式）
- Gemini CLI：`gemini`（CLI 模式）
- Claude CLI：`claude`（CLI 模式）
- 若使用 API 模式，则可不安装对应 CLI，但需配置相应 API Key。

### 5) 安装与启动

#### 5.1 安装

```bash
npm install
```

后端 Python 依赖示例：

```bash
pip install flask
```

#### 5.2 标准开发启动

```bash
npm run dev
```

将同时启动：

- Flask：`http://127.0.0.1:5050`
- Vite：`http://127.0.0.1:5174`
- Electron 窗口

#### 5.3 仅浏览器模式

```bash
npm run dev:browser
```

### 6) NPM 脚本说明（完整）

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动后端、前端、Electron |
| `npm run build` | TypeScript 构建 + Vite 打包 |
| `npm run lint` | ESLint 检查 |
| `npm run preview` | 预览打包结果 |
| `npm run format` | Prettier 全量格式化 |
| `npm run dev:backend` | 启动 Flask 后端（通过 Electron runner） |
| `npm run dev:web` | 启动 Vite 前端 |
| `npm run dev:electron` | 启动 Electron 进程 |
| `npm run dev:hw` | 硬件模式（D3D11） |
| `npm run dev:hw:diag` | 硬件模式 + 诊断 |
| `npm run dev:hw:compat` | 兼容硬件配置 |
| `npm run dev:hw:strict` | 严格硬件模式 |
| `npm run dev:gpu:strict` | 严格硬件 + no-sandbox + 诊断 |
| `npm run dev:hw:gl` | ANGLE=gl |
| `npm run dev:hw:d3d11on12` | ANGLE=d3d11on12 |
| `npm run dev:gpu:nosandbox` | no-sandbox + GPU 诊断 |
| `npm run dev:gpu:desktop-gl` | desktop GL 尝试 |
| `npm run dev:gpu:verbose` | GPU 详细日志（写入 `gpu-debug.log`） |
| `npm run dev:browser` | 仅 Vite 前端调试 |

### 7) 功能总览（全量）

#### 7.1 写作工作区

- 开始/继续、暂停、停止生成
- 生成中进度与状态展示
- 草稿实时显示与缓存
- 草稿接受入正文、删除、恢复
- 草稿润色（调用当前模型）

#### 7.2 侧边栏配置区

- 故事大纲
- 参考文本（支持文件导入）
- 写作要求
- 字数设定（`word_target`）
- 补充设定
- 全局记忆
- 引擎选择与模型 ID 选择
- 思考强度选择（low / medium / high）
- 参考文本一键总结优化（`/api/reference/optimize`）

#### 7.3 大纲与章节

- 生成大纲弹窗（类型定位、结构逻辑、人物系统、设定规则、语言风格、情绪曲线、爽点机制、主题价值观、量化参数）
- 分章建议
- 自动章节标题
- 分章保存
- 章节列表管理（查看/删除）
- 章节内容预览

#### 7.4 书籍管理

- 新建书籍
- 书架打开与切换作品
- 各书籍独立 `project.json`、`chapters.json`、`novel/` 输出

#### 7.5 模型与引擎

- 引擎：ChatGPT / Gemini / Claude / Doubao / Personal
- 访问模式：CLI 或 API（ChatGPT/Gemini/Claude）
- Doubao 模型列表与当前模型配置
- Personal 模型列表、Base URL、API Key
- 环境自检与引擎连通性测试
- 模型健康面板（成功率、耗时、冷却）

#### 7.6 UI 与交互

- 液态玻璃风格
- 完全复刻 UI（除按钮尺寸）开关
- 背景图库 + 本地添加图片
- 主题模式：浅色/深色/跟随系统
- 字体方案、字号、全局加粗、自定义文字颜色
- 设置弹窗分层子页面（外观、字体、背景、辅助、接入方式）

### 8) 设置项全量说明

#### 8.1 系统设置主面板

- 主题外观（进入二级页）
- 打字机速度（滑杆）
- 打字机动画开关
- 代理端口（Gemini/Claude/ChatGPT 执行时临时代理）
- Doubao 配置（进入二级页）
- 辅助功能（进入二级页）
- 接入方式（进入二级页）
- 打开 `settings.json`
- 打开 `auth.json`

#### 8.2 主题外观

- 模式切换：浅色 / 深色 / 跟随系统
- 字体设置入口
- 背景设置入口

#### 8.3 字体设置

- 字体方案（preset）
- 字体大小（连续滑杆）
- 全局字体加粗（iOS 风格开关）
- 自定义文字颜色开关与颜色选择器

#### 8.4 背景设置

- 背景缩略图预览
- 一键设为背景
- 本地添加图片（JPG/PNG/WebP/AVIF/GIF）

#### 8.5 辅助功能

- 启用缓存区
- 显示阶段时间线
- 完全复刻 UI（除按钮尺寸）

#### 8.6 接入方式

- ChatGPT：CLI/API + API Key
- Gemini：CLI/API + API Key
- Claude：CLI/API + API Key

#### 8.7 Doubao 配置

- 当前模型
- 思考等级（low/medium/high）
- 模型列表编辑（多行）

#### 8.8 Personal 配置

- 当前模型
- Base URL
- API Key
- 模型列表

### 9) GPU 与性能（使用方法）

#### 9.1 推荐启动命令

```bash
npm run dev:gpu:strict
```

#### 9.2 关键环境变量（渲染相关）

| 变量 | 说明 |
| --- | --- |
| `NNOVEL_FORCE_HARDWARE` | 强制硬件路径 |
| `NNOVEL_STRICT_HARDWARE` | 严格硬件（失败则退出） |
| `NNOVEL_NO_SANDBOX` | 关闭沙箱（特定机器兼容） |
| `NNOVEL_ANGLE_BACKEND` | ANGLE 后端：`d3d11` / `gl` / `d3d11on12` |
| `NNOVEL_GPU_PROFILE` | GPU 配置档位（如 `compat`） |
| `NNOVEL_GPU_DIAG` | 输出 GPU 诊断信息 |
| `NNOVEL_GPU_VERBOSE` | 输出 Chromium 详细 GPU 日志 |

#### 9.3 如何确认是否硬件渲染

观察 Electron 日志中的关键项：

- `GPU feature status (after GPU init)` 中 `gpu_compositing: enabled`
- `renderer gpu hint: mode: 'hardware'`
- `GPU info (complete) — renderer: ANGLE (NVIDIA ... D3D11...)`

### 10) 环境变量（服务/引擎）

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | 前端 API 基地址（默认空，dev 走代理） |
| `NNOVEL_BACKEND_PORT` | 后端端口（runner 默认 5050） |
| `NNOVEL_RUNTIME_ROOT` | 运行时根目录覆盖 |
| `OPENAI_API_KEY` | ChatGPT API Key |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini API Key |
| `ANTHROPIC_API_KEY` | Claude API Key |
| `DOUBAO_API_KEY` / `ARK_API_KEY` | Doubao Key |
| `PERSONAL_API_KEY` | Personal 模式 API Key |
| `PERSONAL_BASE_URL` | Personal 模式 Base URL |
| `GEMINI_TIMEOUT` | Gemini/Claude API 超时（秒） |
| `CHARS_PER_BATCH` | 单次写作目标字数（默认 2000） |
| `MODEL_HEALTH_WINDOW` | 模型健康统计窗口大小 |
| `DOUBAO_TIMEOUT` | Doubao 请求超时 |
| `DOUBAO_RETRIES` | Doubao 重试次数 |
| `DOUBAO_DISABLE_PROXY` | Doubao 请求是否禁用代理 |

### 11) 后端 API（完整路由）

#### 11.1 配置/状态/自检

- `GET /api/config`
- `POST /api/config`
- `POST /api/config/proxy`
- `GET /api/status`
- `GET /api/self-check`
- `POST /api/engine/test-connectivity`
- `POST /api/engine/prewarm`

#### 11.2 设置与认证文件

- `GET /api/settings/file`
- `POST /api/settings/file`
- `POST /api/settings/file/restore`
- `POST /api/settings/open`
- `GET /api/auth/file`
- `POST /api/auth/file`
- `POST /api/auth/file/restore`
- `POST /api/auth/open`

#### 11.3 书籍

- `GET /api/books`
- `POST /api/books`
- `POST /api/books/switch`

#### 11.4 大纲/优化

- `POST /api/outline/generate`
- `POST /api/draft/polish`
- `POST /api/reference/optimize`

#### 11.5 生成流程

- `POST /api/generate`
- `GET /api/generate/status/<task_id>`
- `POST /api/generate/pause/<task_id>`
- `GET /api/generate/recovery`
- `POST /api/generate/pause-snapshot`
- `POST /api/generate/resume`
- `POST /api/generate/stop/<task_id>`

#### 11.6 草稿与废弃稿

- `POST /api/draft/accept`
- `POST /api/draft/save`
- `POST /api/draft/delete`
- `GET /api/draft`
- `GET /api/discarded`
- `POST /api/discarded/restore`
- `DELETE /api/discarded/<int:item_id>`

#### 11.7 上传与章节

- `POST /api/upload-file`
- `POST /api/chapter/split`
- `POST /api/chapter/generate-title`
- `POST /api/chapter/save`
- `GET /api/chapters`
- `GET /api/chapters/<int:chapter_id>`
- `DELETE /api/chapters/<int:chapter_id>`

### 12) 项目结构（以 `react_test/` 为根）

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
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ index.css
│  ├─ components/
│  │  ├─ layout/
│  │  ├─ modals/
│  │  └─ shared/
│  ├─ config/
│  ├─ services/
│  │  └─ endpoints/
│  ├─ stores/
│  ├─ styles/
│  ├─ types/
│  └─ utils/
├─ background/
├─ data/
│  ├─ library.json
│  └─ books/<book-folder>/
│     ├─ project.json
│     ├─ chapters.json
│     └─ novel/
├─ templates/
├─ static/
├─ scripts/
│  └─ set-gpu-preference.cjs
├─ docs/
├─ package.json
├─ settings.json
└─ auth.json
```

### 13) 常见问题

- Q: Electron 关闭按钮后 `npm run dev` 仍未退出？
  - A: `concurrently` 会等待子进程退出，开发模式下可用 `Ctrl + C` 结束全部进程。
- Q: 日志里前期显示 software，后期变 hardware 是否正常？
  - A: 正常。GPU 初始化前后会打印两次状态，最终以 `after GPU init` 为准。
- Q: API Key 放哪里？
  - A: 推荐放 `auth.json` 或环境变量，不建议硬编码到源码。

### 14) 鸣谢

- 感谢开源项目 [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)，本项目在液态玻璃风格与交互实现上借鉴了其设计思路。
- 借鉴范围仅限视觉风格与交互表现，不包含业务逻辑、数据结构与后端实现。

---
