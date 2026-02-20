# NNovel

## English Documentation (EN)

### 1) Overview

`NNovel React` is a desktop novel-writing application built with `React + TypeScript + Vite` on the frontend, `Electron` as the desktop shell, and `Flask` for backend APIs.  

### 2) Project Outcomes (Current)

- Integrated development runtime (`Vite + Electron + Flask`) in one command.
- Multi-engine writing support: ChatGPT / Gemini / Claude / Doubao / Personal.
- Full writing lifecycle: generate, pause, resume, stop, recovery, draft accept, polish, split, chapter save.
- Bookshelf workflow: create book, switch active book, per-book isolated storage.
- Full settings center: appearance, fonts, backgrounds, accessibility helpers, access mode, proxy, settings file editor.
- Liquid-glass theme plus `Strict Clone UI (except button size)` toggle.
- Multiple GPU boot profiles and diagnostics with renderer/hardware hints in Electron logs.

### 3) Stack

- Frontend: React 19, TypeScript, Vite, Zustand
- Desktop: Electron 40
- Backend: Flask (Python)
- UI effects: `liquid-glass-react`
- Tooling: ESLint, Prettier, PostCSS, Tailwind (base config)

### 4) Dependencies (Complete)

#### 4.1 Runtime requirements

- Node.js `>=18`
- npm `>=9`
- Python `>=3.10` (recommended `3.11+`)
- Windows (GPU scripts and preference helper are Windows-oriented)

#### 4.2 Node runtime deps (`dependencies`)

| Package | Version |
| --- | --- |
| balanced-match | ^4.0.2 |
| liquid-glass-react | file:../../git clone/liquid-glass-react |
| react | ^19.2.0 |
| react-dom | ^19.2.0 |
| zustand | ^5.0.11 |

#### 4.3 Node dev deps (`devDependencies`)

| Package | Version |
| --- | --- |
| @eslint/js | ^9.39.1 |
| @types/node | ^24.10.1 |
| @types/react | ^19.2.7 |
| @types/react-dom | ^19.2.3 |
| @vitejs/plugin-react | ^5.1.1 |
| concurrently | ^9.2.1 |
| cross-env | ^10.1.0 |
| electron | ^40.4.1 |
| electron-builder | ^26.8.1 |
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

#### 4.4 Python deps

- Required: `flask`
- Optional:
  - `pypinyin` (Chinese title slug conversion)
  - `tomli` (fallback for Python `<3.11`)

#### 4.5 Optional external CLIs (mode-dependent)

- `codex` for ChatGPT CLI mode
- `gemini` for Gemini CLI mode
- `claude` for Claude CLI mode
- API mode can be used without these CLIs if API keys are configured.

### 5) Install and Run

#### 5.1 Install

```bash
npm install
```

Python backend dependency example:

```bash
pip install flask
```

#### 5.2 Standard dev mode

```bash
npm run dev
```

This starts:

- Flask backend at `http://127.0.0.1:5050`
- Vite frontend at `http://127.0.0.1:5174`
- Electron desktop window

#### 5.3 Browser-only mode

```bash
npm run dev:browser
```

### 6) Scripts (Complete)

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start backend + web + electron |
| `npm run build` | TypeScript build + Vite bundle |
| `npm run lint` | ESLint check |
| `npm run preview` | Preview production build |
| `npm run format` | Prettier formatting |
| `npm run dev:backend` | Start Flask backend |
| `npm run dev:web` | Start Vite web server |
| `npm run dev:electron` | Start Electron process |
| `npm run dev:hw` | Hardware mode (D3D11) |
| `npm run dev:hw:diag` | Hardware mode + diagnostics |
| `npm run dev:hw:compat` | Compatibility GPU profile |
| `npm run dev:hw:strict` | Strict hardware mode |
| `npm run dev:gpu:strict` | Strict hardware + no-sandbox + diagnostics |
| `npm run dev:hw:gl` | ANGLE backend = gl |
| `npm run dev:hw:d3d11on12` | ANGLE backend = d3d11on12 |
| `npm run dev:gpu:nosandbox` | no-sandbox + diagnostics |
| `npm run dev:gpu:desktop-gl` | desktop GL attempt |
| `npm run dev:gpu:verbose` | verbose GPU logs (`gpu-debug.log`) |
| `npm run dev:browser` | web-only debug |
| `npm run dist:check` | verify no unignored packaging artifacts |
| `npm run dist:win` | build Windows NSIS installer (`NNovel_setup.exe`) |
| `npm run dist:win:v1` | alias of `dist:win` |
| `npm run dist:win:portable` | build Windows portable package |

### 6.1 Windows Distribution Installer

Build command:

```bash
npm run dist:win
```

Output directory: `E:\Project\exe\v1.0`; installer name is fixed to `NNovel_setup.exe`.

Installer behavior:

- User-selectable install directory (works on any drive).
- Optional run-after-finish on the final page.
- Creates runtime `auth.json` template (key names only, no secret values).
- Backend scripts are shipped inside the app bundle and copied to user runtime directory on launch, so core Python sources are not exposed as plain files in install path.
- Detects Python and auto-attempts install via `winget` (`Python.Python.3.12`) when missing.
- Detects `codex / gemini / claude`; prompts user per CLI for optional install.

Official CLI install commands (wired into post-install script):

- OpenAI Codex CLI: `npm install -g @openai/codex`
- Google Gemini CLI: `npm install -g @google/gemini-cli`
- Anthropic Claude Code: `npm install -g @anthropic-ai/claude-code`

### 7) Feature Matrix (Complete)

#### 7.1 Writing workspace

- Start/resume, pause, stop generation
- Real-time generation state and progress
- Draft live cache
- Accept draft to editor, save, delete, restore discarded
- Draft polish with current model

#### 7.2 Sidebar inputs

- Outline
- Reference text (with file import)
- Requirements
- Word target (`word_target`)
- Extra settings
- Global memory
- Engine/model selection
- Reasoning effort selection (`low/medium/high`)
- Reference optimize action (`/api/reference/optimize`)

#### 7.3 Outline and chapters

- Structured outline generation modal
- Chapter split suggestion
- Chapter title generation
- Chapter save
- Chapter list management (view/delete)
- Chapter preview

#### 7.4 Bookshelf

- Create new book
- Switch active book
- Per-book isolated `project.json`, `chapters.json`, and `novel/` output

#### 7.5 Engines and connectivity

- Engines: ChatGPT / Gemini / Claude / Doubao / Personal
- Access mode: CLI or API (ChatGPT/Gemini/Claude)
- Doubao model list + active model
- Personal base URL + API key + model list
- Startup self-check and connectivity test
- Model health panel (success rate, latency, cooldown)

#### 7.6 UI and interaction

- Liquid-glass style
- Strict Clone UI (except button size)
- Background library + local image import
- Theme mode: light/dark/auto
- Font preset, size, global bold, custom text color
- Layered settings modals (appearance/font/background/assist/access)

### 8) Settings Reference (All Sections)

#### 8.1 Main settings modal

- Appearance (entry)
- Typewriter speed slider
- Typewriter animation toggle
- Proxy port
- Doubao config (entry)
- Assist settings (entry)
- Access settings (entry)
- Open `settings.json`
- Open `auth.json`

#### 8.2 Appearance

- Light / Dark / Auto theme
- Font settings entry
- Background settings entry

#### 8.3 Font settings

- Font preset
- Font size (continuous slider)
- Global bold toggle
- Custom text color toggle and picker

#### 8.4 Background settings

- Thumbnail preview
- Apply selected background
- Add local image (JPG/PNG/WebP/AVIF/GIF)

#### 8.5 Assist settings

- Enable cache panel
- Show stage timeline
- Strict Clone UI (except button size)

#### 8.6 Access settings

- ChatGPT CLI/API + key
- Gemini CLI/API + key
- Claude CLI/API + key

#### 8.7 Doubao settings

- Active model
- Reasoning effort (`low/medium/high`)
- Model list editing

#### 8.8 Personal settings

- Active model
- Base URL
- API Key
- Model list

### 9) GPU and Performance

#### 9.1 Recommended command

```bash
npm run dev:gpu:strict
```

#### 9.2 Rendering env vars

| Env | Description |
| --- | --- |
| `NNOVEL_FORCE_HARDWARE` | Force hardware rendering path |
| `NNOVEL_STRICT_HARDWARE` | Strict hardware requirement |
| `NNOVEL_NO_SANDBOX` | Disable sandbox (compatibility fallback) |
| `NNOVEL_ANGLE_BACKEND` | `d3d11` / `gl` / `d3d11on12` |
| `NNOVEL_GPU_PROFILE` | GPU profile (for example `compat`) |
| `NNOVEL_GPU_DIAG` | GPU diagnostics in logs |
| `NNOVEL_GPU_VERBOSE` | Verbose Chromium GPU logs |

#### 9.3 How to verify hardware rendering

Look for these in Electron logs:

- `GPU feature status (after GPU init)` with `gpu_compositing: enabled`
- `renderer gpu hint: mode: 'hardware'`
- `GPU info (complete) — renderer: ANGLE (... D3D11 ...)`

### 10) Environment Variables (Service/Engine)

| Env | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Frontend API base URL |
| `NNOVEL_BACKEND_PORT` | Backend port |
| `NNOVEL_RUNTIME_ROOT` | Override runtime root |
| `OPENAI_API_KEY` | ChatGPT API key |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini API key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `DOUBAO_API_KEY` / `ARK_API_KEY` | Doubao API key |
| `PERSONAL_API_KEY` | Personal mode API key |
| `PERSONAL_BASE_URL` | Personal mode base URL |
| `GEMINI_TIMEOUT` | Gemini/Claude timeout (sec) |
| `CHARS_PER_BATCH` | Target char batch per request |
| `MODEL_HEALTH_WINDOW` | Model health rolling window |
| `DOUBAO_TIMEOUT` | Doubao timeout |
| `DOUBAO_RETRIES` | Doubao retries |
| `DOUBAO_DISABLE_PROXY` | Disable proxy for Doubao HTTP requests |

### 11) Backend APIs (Complete Route List)

#### 11.1 Config/status/self-check

- `GET /api/config`
- `POST /api/config`
- `POST /api/config/proxy`
- `GET /api/status`
- `GET /api/self-check`
- `POST /api/engine/test-connectivity`
- `POST /api/engine/prewarm`

#### 11.2 Settings/auth files

- `GET /api/settings/file`
- `POST /api/settings/file`
- `POST /api/settings/file/restore`
- `POST /api/settings/open`
- `GET /api/auth/file`
- `POST /api/auth/file`
- `POST /api/auth/file/restore`
- `POST /api/auth/open`

#### 11.3 Books

- `GET /api/books`
- `POST /api/books`
- `POST /api/books/switch`

#### 11.4 Outline/optimization

- `POST /api/outline/generate`
- `POST /api/draft/polish`
- `POST /api/reference/optimize`

#### 11.5 Generation lifecycle

- `POST /api/generate`
- `GET /api/generate/status/<task_id>`
- `POST /api/generate/pause/<task_id>`
- `GET /api/generate/recovery`
- `POST /api/generate/pause-snapshot`
- `POST /api/generate/resume`
- `POST /api/generate/stop/<task_id>`

#### 11.6 Draft and discarded

- `POST /api/draft/accept`
- `POST /api/draft/save`
- `POST /api/draft/delete`
- `GET /api/draft`
- `GET /api/discarded`
- `POST /api/discarded/restore`
- `DELETE /api/discarded/<int:item_id>`

#### 11.7 Upload and chapters

- `POST /api/upload-file`
- `POST /api/chapter/split`
- `POST /api/chapter/generate-title`
- `POST /api/chapter/save`
- `GET /api/chapters`
- `GET /api/chapters/<int:chapter_id>`
- `DELETE /api/chapters/<int:chapter_id>`

### 12) Project Structure (project root)

```text
NNovel/
├─ app.py
├─ codex_engine.py
├─ chapter_manager.py
├─ data_store.py
├─ config.py
├─ electron/
├─ src/
│  ├─ components/
│  ├─ config/
│  ├─ services/
│  ├─ stores/
│  ├─ styles/
│  ├─ types/
│  ├─ utils/
│  ├─ App.tsx
│  └─ main.tsx
├─ background/
├─ data/
├─ templates/
├─ static/
├─ scripts/
├─ docs/
├─ package.json
├─ settings.json
└─ auth.json
```

### 13) Notes

- For production use, move secrets to environment variables and avoid committing key files.
- In dev mode, early GPU logs may show software before final hardware init; always trust the post-init status.

### 14) Acknowledgements

- Special thanks to [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react). This project borrows design ideas from that library for liquid-glass style and interactions.

