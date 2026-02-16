import { LiquidGlassFrame } from "@/components/shared/LiquidGlassFrame";

interface DraftPanelProps {
  content: string;
  splitLoading: boolean;
  saveLoading: boolean;
  polishLoading: boolean;
  cacheExpanded: boolean;
  cacheEnabled: boolean;
  dynamicEffectsEnabled: boolean;
  onChange: (text: string) => void;
  onSplitChapter: () => void;
  onPolish: () => void;
  onToggleCache: () => void;
}

const DRAFT_ACTION_ICONS = {
  wand: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.2 2.1l.8 1.7 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8zM11.1 5.6l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5zM3.9 10.3l5.9-5.9a1 1 0 0 1 1.4 1.4l-5.9 5.9H2.5v-2.8z"/></svg>',
  loading: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="8" cy="8" r="5.3" strokeOpacity="0.3"></circle><path d="M13.3 8A5.3 5.3 0 0 0 8 2.7"></path></svg>',
};

export function DraftPanel(props: DraftPanelProps) {
  const charCount = props.content.trim() ? props.content.length : 0;
  const splitBusy = props.splitLoading || props.saveLoading;
  const overlayBusy = props.splitLoading || props.saveLoading;
  const actionDisabled = splitBusy || props.polishLoading;

  return (
    <div className="desk-column">
      <LiquidGlassFrame id="draft-box" className="card liquid-glass-card-shell" dynamic={props.dynamicEffectsEnabled} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="card-header">
          <h3>
            草稿箱 <span id="draft-char-count" className="badge">{charCount}字</span>
          </h3>
          <div className="draft-header-actions">
            <button
              id="polish-draft-btn"
              className={`btn btn-sm btn-primary writer-icon-btn ${props.polishLoading ? "loading" : ""}`}
              onClick={props.onPolish}
              type="button"
              disabled={actionDisabled}
              title="润色草稿"
              aria-label="润色草稿"
            >
              <span
                className="btn-icon-text"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: props.polishLoading ? DRAFT_ACTION_ICONS.loading : DRAFT_ACTION_ICONS.wand }}
              />
            </button>
            <button
              id="split-chapter-btn"
              className={`btn btn-sm btn-warning draft-split-btn ${splitBusy ? "is-busy" : ""}`}
              onClick={props.onSplitChapter}
              type="button"
              disabled={actionDisabled}
              title={splitBusy ? "保存中..." : "分章保存"}
              aria-label={splitBusy ? "保存中..." : "分章保存"}
            >
              {splitBusy ? "保存中..." : "分章保存"}
            </button>
          </div>
        </div>
        <div className="draft-content-wrap">
          <textarea
            id="draft-content"
            className="editable-area"
            value={props.content}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder="采纳后的内容会进入草稿箱，可继续编辑..."
            style={{ border: "none", resize: "none", background: "transparent" }}
          />
          <div id="draft-loading-overlay" className={`draft-loading ${overlayBusy ? "" : "hidden"}`}>
            <div className="thinking-spinner" style={{ width: 32, height: 32 }} />
            <span>正在保存...</span>
          </div>
        </div>
      </LiquidGlassFrame>

      <LiquidGlassFrame id="cache-box" className={`card liquid-glass-card-shell ${props.cacheEnabled ? "" : "hidden"}`} dynamic={props.dynamicEffectsEnabled}>
        <div id="cache-toggle-header" className="card-header" onClick={props.onToggleCache} style={{ cursor: "pointer" }}>
          <h3>
            📦 缓存区{" "}
            <span style={{ fontSize: 12, fontWeight: "normal", color: "var(--text-secondary)", marginLeft: 8 }}>
              {props.cacheEnabled ? (props.cacheExpanded ? "(点击收起)" : "(点击展开)") : "(已隐藏)"}
            </span>
          </h3>
        </div>
        <div id="cache-content" className={`cache-content ${props.cacheExpanded ? "" : "hidden"}`}>
          <pre id="cache-text" className="cache-pre">{props.content.trim() ? props.content.slice(-350) : "（暂无缓存内容）"}</pre>
        </div>
      </LiquidGlassFrame>
    </div>
  );
}

