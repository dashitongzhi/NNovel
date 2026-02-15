import { useEffect, useRef, useState } from "react";
import { ENGINE_LABELS } from "@/config/defaults";
import type { AppConfig, StartupStatus } from "@/types/domain";

interface ToolbarProps {
  sidebarCollapsed: boolean;
  discardedVisible: boolean;
  interactionsLocked?: boolean;
  config: AppConfig;
  status: StartupStatus | null;
  statusOverride?: "" | "就绪" | "异常" | "成功";
  onToggleSidebar: () => void;
  onToggleDiscarded: () => void;
  onOpenSelfCheck: () => void;
  onOpenSettings: () => void;
  onOpenOutline: () => void;
  onOpenBookshelf: () => void;
  onOpenModelHealth: () => void;
  onOpenInfoBox: () => void;
  onOpenChapters: () => void;
  onCreateBookQuick: () => void;
  onSwitchEngine: (mode: AppConfig["engine_mode"]) => void;
}

function modeReadyFromStatus(status: StartupStatus | null, config: AppConfig): boolean {
  if (!status) return false;
  const mode = (config.engine_mode || "codex") as AppConfig["engine_mode"];
  if (mode === "gemini") {
    if (config.gemini_access_mode === "api") return status.gemini_api_ready !== false;
    return status.gemini_available !== false;
  }
  if (mode === "claude") {
    if (config.claude_access_mode === "api") return status.claude_api_ready !== false;
    return status.claude_available !== false;
  }
  if (mode === "doubao") return status.doubao_ready !== false;
  if (mode === "personal") return status.personal_ready !== false;
  if (config.codex_access_mode === "api") return status.codex_api_ready !== false;
  return status.codex_available !== false;
}

function modeDefaultModelFromStatus(status: StartupStatus | null, mode: AppConfig["engine_mode"]): string {
  if (!status) return "-";
  if (mode === "gemini") return String(status.gemini_model || "-");
  if (mode === "claude") return String(status.claude_model || "-");
  if (mode === "doubao") return String(status.doubao_model || "-");
  if (mode === "personal") return String(status.personal_model || "-");
  return String(status.codex_model || "-");
}

function modeDefaultModelFromConfig(config: AppConfig, mode: AppConfig["engine_mode"]): string {
  if (mode === "gemini") return String(config.gemini_model || "-");
  if (mode === "claude") return String(config.claude_model || "-");
  if (mode === "doubao") return String(config.doubao_model || "-");
  if (mode === "personal") return String(config.personal_model || "-");
  return String(config.codex_model || "-");
}

export function Toolbar(props: ToolbarProps) {
  const ICONS = {
    sidebar: "☰",
    outline:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    selfCheck: "🧪",
    newBook:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><path d="M12 7v6"></path><path d="M9 10h6"></path></svg>',
    bookshelf: "📚",
    chapters: "📖",
    health: "🩺",
    info: "🔔",
    discarded: "🗑️",
    settings: "⚙️",
  } as const;

  const engineMode = (props.config.engine_mode || "codex") as AppConfig["engine_mode"];
  const statusReady = modeReadyFromStatus(props.status, props.config);
  const engineStatusText = props.statusOverride || (statusReady ? "就绪" : "异常");
  const runtimeLastEngine = String(props.status?.runtime_last_engine || "").trim().toLowerCase();
  const runtimeLastModel = String(props.status?.runtime_last_model || "").trim();
  const configModel = modeDefaultModelFromConfig(props.config, engineMode);
  const statusModel = modeDefaultModelFromStatus(props.status, engineMode);
  const currentModel = configModel
    || ((runtimeLastModel && runtimeLastEngine === engineMode) ? runtimeLastModel : statusModel || "-");
  const interactionsLocked = Boolean(props.interactionsLocked);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const visibleEngineMenuOpen = engineMenuOpen && !interactionsLocked;
  const enginePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visibleEngineMenuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const root = enginePickerRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setEngineMenuOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEngineMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [visibleEngineMenuOpen]);

  const IconBtn = (p: { id?: string; title: string; active?: boolean; icon: string; onClick: () => void; disabled?: boolean }) => (
    <button
      id={p.id}
      className={`icon-btn toolbar-icon-btn glass-btn ${p.active ? "active" : ""}`}
      type="button"
      title={p.title}
      aria-label={p.title}
      disabled={Boolean(p.disabled)}
      onClick={p.onClick}
      dangerouslySetInnerHTML={{ __html: p.icon }}
    />
  );

  return (
    <section id="extra-settings">
      <div
        id="toolbar-container"
        className="section-header top-toolbar-row"
        style={{
          padding: "10px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div className="toolbar-group left" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {IconBtn({ title: props.sidebarCollapsed ? "展开侧栏" : "收起侧栏", icon: ICONS.sidebar, onClick: props.onToggleSidebar })}
          <div id="toolbar-status-bar" className="toolbar-status-bar">
            <span
              id="toolbar-status-engine"
              className={`toolbar-status-chip ${engineStatusText === "成功" ? "state-success" : engineStatusText === "就绪" ? "state-ready" : "state-error"}`}
            >
              状态: {engineStatusText}
            </span>
            <span id="toolbar-status-current-model" className="toolbar-status-chip">当前模型: {currentModel}</span>
          </div>
        </div>

        <div className="toolbar-group right" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {IconBtn({ title: "调用当前模型生成大纲", icon: ICONS.outline, onClick: props.onOpenOutline })}
          <div className="engine-picker" ref={enginePickerRef}>
            <button
              id="engine-picker-btn"
              className="engine-picker-btn glass-btn"
              type="button"
              title="切换模型供应商"
              disabled={interactionsLocked}
              onClick={() => {
                if (!interactionsLocked) setEngineMenuOpen((v) => !v);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </svg>
              <span>模型: {ENGINE_LABELS[engineMode] || "ChatGPT"}</span>
            </button>
            <div id="engine-picker-menu" className={`engine-picker-menu glass-panel ${visibleEngineMenuOpen ? "" : "hidden"}`}>
              {(["codex", "gemini", "claude", "doubao", "personal"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === engineMode ? "active" : ""}
                  onClick={() => {
                    props.onSwitchEngine(mode);
                    setEngineMenuOpen(false);
                  }}
                >
                  {ENGINE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
          {IconBtn({ id: "self-check-btn", title: "环境自检", icon: ICONS.selfCheck, onClick: props.onOpenSelfCheck })}
          {IconBtn({ id: "new-book-btn", title: "新建书籍", icon: ICONS.newBook, onClick: props.onCreateBookQuick })}
          {IconBtn({ id: "bookshelf-btn", title: "打开书架", icon: ICONS.bookshelf, onClick: props.onOpenBookshelf })}
          {IconBtn({ title: "章节管理", icon: ICONS.chapters, onClick: props.onOpenChapters })}
          {IconBtn({ title: "模型健康面板", icon: ICONS.health, onClick: props.onOpenModelHealth })}
          {IconBtn({ title: "打开信息箱", icon: ICONS.info, onClick: props.onOpenInfoBox })}
          {IconBtn({ title: "查看废弃稿件", icon: ICONS.discarded, active: props.discardedVisible, onClick: props.onToggleDiscarded })}
          {IconBtn({ title: "系统设置", icon: ICONS.settings, onClick: props.onOpenSettings })}
        </div>
      </div>
    </section>
  );
}
