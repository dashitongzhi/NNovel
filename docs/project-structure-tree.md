# Project Structure Tree (Current)

```text
react_test/
├─ electron/
│  ├─ backend-runner.cjs
│  ├─ dev-runner.cjs
│  └─ main.cjs
├─ src/
│  ├─ components/
│  │  ├─ layout/
│  │  │  ├─ DiscardedPanel.tsx
│  │  │  ├─ DraftPanel.tsx
│  │  │  ├─ GenerationPanel.tsx
│  │  │  ├─ Sidebar.tsx
│  │  │  └─ Toolbar.tsx
│  │  ├─ modals/
│  │  │  └─ ModalHost.tsx
│  │  └─ shared/
│  │     ├─ ConfigSelect.tsx
│  │     ├─ LiquidGlassFrame.tsx
│  │     ├─ ModelIdListEditor.tsx
│  │     └─ ToastStack.tsx
│  ├─ config/
│  │  └─ defaults.ts
│  ├─ services/
│  │  ├─ apiClient.ts
│  │  └─ endpoints/
│  ├─ stores/
│  │  ├─ configStore.ts
│  │  ├─ discardedStore.ts
│  │  ├─ draftStore.ts
│  │  ├─ generationStore.ts
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
├─ tailwind.config.js
├─ postcss.config.js
├─ vite.config.ts
└─ package.json
```
