interface DraftPanelProps {
  content: string;
  loading: boolean;
  cacheExpanded: boolean;
  cacheEnabled: boolean;
  onChange: (text: string) => void;
  onSplitChapter: () => void;
  onToggleCache: () => void;
}

export function DraftPanel(props: DraftPanelProps) {
  const charCount = props.content.trim() ? props.content.length : 0;

  return (
    <div className="desk-column">
      <div id="draft-box" className="card" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div className="card-header">
          <h3>
            草稿箱 <span id="draft-char-count" className="badge">{charCount}字</span>
          </h3>
          <button id="split-chapter-btn" className="btn btn-warning btn-sm" onClick={props.onSplitChapter} type="button">
            分章保存
          </button>
        </div>
        <textarea
          id="draft-content"
          className="editable-area"
          value={props.content}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="采纳后的内容会进入草稿箱，可继续编辑..."
          style={{ border: "none", resize: "none", background: "transparent" }}
        />
        <div id="draft-loading-overlay" className={`draft-loading ${props.loading ? "" : "hidden"}`}>
          <div className="thinking-spinner" style={{ width: 32, height: 32 }} />
          <span>正在保存，并进行记忆/连贯性校验...</span>
        </div>
      </div>

      <div id="cache-box" className={`card ${props.cacheEnabled ? "" : "hidden"}`}>
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
      </div>
    </div>
  );
}

