import type { ConsistencyConflict } from "@/types/domain";

interface MemoryDiffItem {
  key: string;
  summary: string;
  oldSummary?: string;
}

interface ModalHostProps {
  chapterTitleOpen: boolean;
  chapterTitle: string;
  onChapterTitleChange: (v: string) => void;
  onChapterConfirm: () => void;
  onCloseChapterModal: () => void;
  consistencyOpen: boolean;
  consistencySummary: string;
  consistencyConflicts: ConsistencyConflict[];
  onCloseConsistency: () => void;
  memoryOpen: boolean;
  memoryAdded: MemoryDiffItem[];
  memoryReplaced: MemoryDiffItem[];
  memoryUnchanged: MemoryDiffItem[];
  onCloseMemory: () => void;
  selfCheckOpen: boolean;
  selfCheckLoading: boolean;
  selfCheckSummary: string;
  selfCheckRows: Array<{ id: string; label: string; ok: boolean; detail?: string; required?: boolean; pending?: boolean }>;
  onRecheck: () => void;
  onCloseSelfCheck: () => void;
}

export function ModalHost(props: ModalHostProps) {
  return (
    <>
      <div id="title-modal" className={`modal-overlay ${props.chapterTitleOpen ? "" : "hidden"}`}>
        <div className="modal-content title-modal-content">
          <h3>章节标题确认</h3>
          <p className="modal-desc">AI 已为您生成章节标题，您可以修改或直接保存。</p>
          <input
            id="chapter-title-input"
            className="large-input"
            value={props.chapterTitle}
            onChange={(e) => props.onChapterTitleChange(e.target.value)}
            type="text"
          />
          <div className="modal-actions">
            <button id="modal-confirm-btn" className="btn btn-success btn-lg" onClick={props.onChapterConfirm} type="button">确认保存</button>
            <button id="modal-cancel-btn" className="btn btn-danger btn-lg" onClick={props.onCloseChapterModal} type="button">取消</button>
          </div>
        </div>
      </div>

      <div id="memory-preview-modal" className={`modal-overlay ${props.memoryOpen ? "" : "hidden"}`}>
        <div className="modal-content memory-preview-content">
          <div className="modal-header">
            <h3>全局记忆更新预览</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={props.onCloseMemory}>×</button>
          </div>
          <div className="memory-stat-bar">
            <div className="stat-item stat-added"><span className="stat-count">{props.memoryAdded.length}</span><span className="stat-label">新增</span></div>
            <div className="stat-item stat-replaced"><span className="stat-count">{props.memoryReplaced.length}</span><span className="stat-label">变更</span></div>
            <div className="stat-item stat-unchanged"><span className="stat-count">{props.memoryUnchanged.length}</span><span className="stat-label">未变</span></div>
          </div>
          <div className="memory-preview-list">
            {props.memoryAdded.map((x) => (
              <div className="memory-change-item" key={`a-${x.key}`}>
                <div><span className="change-tag tag-added">新增</span></div>
                <div className="change-content"><div className="change-key">{x.key}</div><div className="change-diff"><div className="diff-new">{x.summary}</div></div></div>
              </div>
            ))}
            {props.memoryReplaced.map((x) => (
              <div className="memory-change-item" key={`r-${x.key}`}>
                <div><span className="change-tag tag-replaced">变更</span></div>
                <div className="change-content"><div className="change-key">{x.key}</div><div className="change-diff"><div className="diff-old">{x.oldSummary}</div><div className="diff-new">{x.summary}</div></div></div>
              </div>
            ))}
            {props.memoryUnchanged.map((x) => (
              <div className="memory-change-item" key={`u-${x.key}`}>
                <div><span className="change-tag tag-unchanged">未变</span></div>
                <div className="change-content"><div className="change-key">{x.key}</div><div className="change-diff"><div className="diff-new">{x.summary}</div></div></div>
              </div>
            ))}
          </div>
          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" type="button" onClick={props.onCloseMemory}>确认</button>
          </div>
        </div>
      </div>

      <div id="consistency-modal" className={`modal-overlay ${props.consistencyOpen ? "" : "hidden"}`}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>连贯性校验结果</h3>
            <button className="icon-btn settings-modal-header-icon-btn" onClick={props.onCloseConsistency} type="button">×</button>
          </div>
          <p className="consistency-summary">{props.consistencySummary || "检测到连贯性冲突，请按以下建议修复。"}</p>
          <div className="consistency-conflict-list">
            {props.consistencyConflicts.length === 0 ? (
              <div className="consistency-item">无冲突</div>
            ) : (
              props.consistencyConflicts.map((item, index) => (
                <div className="consistency-item" key={`c-${index}`}>
                  <div className="consistency-head">#{index + 1} · {item.type || "其他"}</div>
                  <div className="consistency-line"><strong>冲突：</strong>{item.issue || "（未提供）"}</div>
                  <div className="consistency-line"><strong>依据：</strong>{item.evidence || "（未提供）"}</div>
                  <div className="consistency-line"><strong>修复建议：</strong>{item.suggestion || "（未提供）"}</div>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={props.onCloseConsistency} type="button">我知道了</button>
          </div>
        </div>
      </div>

      <div id="self-check-modal" className={`modal-overlay ${props.selfCheckOpen ? "" : "hidden"}`}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>环境自检</h3>
            <button className="icon-btn settings-modal-header-icon-btn" onClick={props.onCloseSelfCheck} type="button">×</button>
          </div>
          <div id="self-check-loading" className={props.selfCheckLoading ? "" : "hidden"} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div className="thinking-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            <span className="status-text">检测中...</span>
          </div>
          <p className="consistency-summary">{props.selfCheckSummary}</p>
          <div className="consistency-conflict-list">
            {props.selfCheckRows.length === 0 && !props.selfCheckLoading ? <div className="consistency-item">暂无检测结果</div> : null}
            {props.selfCheckRows.map((row, idx) => (
              <div className={`self-check-item ${row.pending ? "pending" : row.ok ? "ok" : "bad"}`} key={`${row.id || "s"}-${idx}`}>
                <div>
                  <div className="check-name">
                    {row.label}
                    {row.required && !/chatgpt/i.test(String(row.label || "")) ? "（必需）" : ""}
                  </div>
                  <div className="check-detail">{row.detail || ""}</div>
                </div>
                <div className="check-state">
                  {row.pending ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="self-check-mini-spinner" aria-hidden="true" />
                      检测中
                    </span>
                  ) : row.ok ? "就绪" : "异常"}
                </div>
              </div>
            ))}
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={props.onRecheck} type="button">重新检测</button>
            <button className="btn btn-danger" onClick={props.onCloseSelfCheck} type="button">关闭</button>
          </div>
        </div>
      </div>
    </>
  );
}

