# NNovel React Migration (react_test)

This project is an independent React + TypeScript + Vite migration workspace for NNovel.

## Goals

- Keep `E:\Project\NNovel` unchanged (read-only reference).
- Implement migrated frontend in `E:\Project\UI\react_test` only.
- Reuse existing Flask backend APIs from NNovel.

## Stack

- React 19
- TypeScript
- Vite
- Zustand
- ESLint + Prettier

## Run

In this directory:

```bash
npm install
npm run dev
```

`npm run dev` starts:
- Flask backend (`../../NNovel/app.py`, runtime root forced to this folder)
- Vite web (`127.0.0.1:5174`)
- Electron window

Default web URL: `http://127.0.0.1:5174`

## Environment

Copy `.env.example` to `.env` only if needed:

```bash
VITE_API_BASE_URL=
```

Dev mode uses Vite proxy (`/api -> http://127.0.0.1:5050`) and avoids CORS issues.

## Scripts

- `npm run dev` - start local development server
- `npm run build` - type-check and build production assets
- `npm run lint` - run ESLint
- `npm run format` - run Prettier

## Implemented Scope

- Base layout migration: Sidebar / Toolbar / Writing Desk
- API layer + typed endpoint wrappers
- Zustand stores: `configStore`, `draftStore`, `generationStore`, `discardedStore`, `uiStore`
- Writing core flow: start / stop / pause / resume polling / stage timeline / typewriter skip / auto-scroll
- Draft flow: autosave / accept / rewrite
- Chapter flow: title generation + chapter save + memory diff preview + consistency modal
- Discarded drafts: list / restore / delete
- Startup self-check modal
- Legacy stylesheet reused from NNovel (`src/styles/legacy.css`)

## Directory Map

- `src/services` - API client and endpoint wrappers
- `src/stores` - Zustand stores
- `src/components/layout` - main layout components
- `src/components/modals` - modal host and dialogs
- `src/types` - domain + API typings
- `src/styles` - legacy + React override styles

## Notes

- This migration project does not modify any file under `E:\Project\NNovel`.
- Runtime storage root is this folder (`E:\Project\UI\react_test`) when started by `npm run dev`.
- Generated data is written under `E:\Project\UI\react_test\data\...` (bookshelf/books/project/cache/chapters/novel output).
- Mobile (React Native) abstraction prep exists in shared types (`ProviderConfig`, `StoragePort`).
