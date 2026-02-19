import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ENGINE_LABELS } from "@/config/defaults";
import type { AppConfig, StartupStatus } from "@/types/domain";
import { LiquidGlassFrame } from "@/components/shared/LiquidGlassFrame";
import { LayerPortal } from "@/components/shared/LayerPortal";

interface ToolbarProps {
  sidebarCollapsed: boolean;
  discardedVisible: boolean;
  hasInfoItems: boolean;
  dynamicEffectsEnabled: boolean;
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

interface EngineMenuLayout {
  top: number;
  left: number;
  width: number;
}

export function Toolbar(props: ToolbarProps) {
  const ICONS = {
    sidebar: "☰",
    outline: "📑",
    selfCheck: "🧪",
    newBook: "➕",
    bookshelf: "📚",
    chapters: "📖",
    health: "🩺",
    discarded: "🗑️",
    settings: "⚙️",
  } as const;
  const infoIcon = props.hasInfoItems ? "📬" : "📭";

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
  const engineMenuRef = useRef<HTMLDivElement | null>(null);
  const [engineMenuLayout, setEngineMenuLayout] = useState<EngineMenuLayout | null>(null);

  const syncEngineMenuLayout = useCallback(() => {
    if (!visibleEngineMenuOpen) return;
    const button = enginePickerRef.current?.querySelector("#engine-picker-btn") as HTMLButtonElement | null;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(142, Math.min(178, Math.round(rect.width)));
    const viewportPad = 12;
    const half = width / 2;
    let left = rect.left + rect.width / 2;
    left = Math.max(viewportPad + half, Math.min(left, window.innerWidth - viewportPad - half));
    const top = Math.round(rect.bottom + 6);
    setEngineMenuLayout({ top, left, width });
  }, [visibleEngineMenuOpen]);

  useLayoutEffect(() => {
    if (!visibleEngineMenuOpen) {
      setEngineMenuLayout(null);
      return;
    }
    const update = () => syncEngineMenuLayout();
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [syncEngineMenuLayout, visibleEngineMenuOpen]);

  useEffect(() => {
    if (!visibleEngineMenuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const root = enginePickerRef.current;
      const menu = engineMenuRef.current;
      if (event.target instanceof Node) {
        if (root && root.contains(event.target)) return;
        if (menu && menu.contains(event.target)) return;
      }
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
      onMouseDown={(event) => {
        if (p.disabled) return;
        event.preventDefault();
        event.currentTarget.dataset.fastPressed = "1";
        p.onClick();
      }}
      onClick={(event) => {
        if (p.disabled) return;
        if (event.currentTarget.dataset.fastPressed === "1") {
          event.currentTarget.dataset.fastPressed = "";
          return;
        }
        p.onClick();
      }}
      dangerouslySetInnerHTML={{ __html: p.icon }}
    />
  );

  const engineMenuStyle: CSSProperties | undefined = engineMenuLayout
    ? {
      position: "fixed",
      top: engineMenuLayout.top,
      left: engineMenuLayout.left,
      width: engineMenuLayout.width,
      minWidth: 142,
      maxWidth: 178,
      transform: "translateX(-50%)",
    }
    : undefined;

  const ToolbarIsolate = (p: { children: ReactNode; className?: string }) => {
    const className = p.className ? `toolbar-item-isolate ${p.className}` : "toolbar-item-isolate";
    return <span className={className}>{p.children}</span>;
  };

  return (
    <section id="extra-settings">
      <LiquidGlassFrame
        id="toolbar-container"
        className="section-header top-toolbar-row liquid-glass-toolbar-shell"
        dynamic={props.dynamicEffectsEnabled}
        staticOnly
        style={{
          padding: "10px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "nowrap",
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
          <ToolbarIsolate>{IconBtn({ id: "outline-generate-btn", title: "调用当前模型生成大纲", icon: ICONS.outline, onClick: props.onOpenOutline })}</ToolbarIsolate>
          <ToolbarIsolate className="toolbar-item-isolate-engine">
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
                <span aria-hidden="true" style={{ marginRight: 6, lineHeight: 1 }}>
                  🔲
                </span>
                <span>模型: {ENGINE_LABELS[engineMode] || "ChatGPT"}</span>
              </button>
            </div>
          </ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ id: "self-check-btn", title: "环境自检", icon: ICONS.selfCheck, onClick: props.onOpenSelfCheck })}</ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ id: "new-book-btn", title: "新建书籍", icon: ICONS.newBook, onClick: props.onCreateBookQuick })}</ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ id: "bookshelf-btn", title: "打开书架", icon: ICONS.bookshelf, onClick: props.onOpenBookshelf })}</ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ title: "章节管理", icon: ICONS.chapters, onClick: props.onOpenChapters })}</ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ title: "模型健康面板", icon: ICONS.health, onClick: props.onOpenModelHealth })}</ToolbarIsolate>
          <ToolbarIsolate>
            {IconBtn({
              title: props.hasInfoItems ? "打开信息箱（有信息）" : "打开信息箱（无信息）",
              icon: infoIcon,
              onClick: props.onOpenInfoBox,
            })}
          </ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ title: "查看废弃稿件", icon: ICONS.discarded, active: props.discardedVisible, onClick: props.onToggleDiscarded })}</ToolbarIsolate>
          <ToolbarIsolate>{IconBtn({ title: "系统设置", icon: ICONS.settings, onClick: props.onOpenSettings })}</ToolbarIsolate>
        </div>
      </LiquidGlassFrame>

      {visibleEngineMenuOpen ? (
        <LayerPortal>
          <div
            ref={engineMenuRef}
            id="engine-picker-menu"
            className="engine-picker-menu glass-panel"
            style={engineMenuStyle}
          >
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
        </LayerPortal>
      ) : null}
    </section>
  );
}



