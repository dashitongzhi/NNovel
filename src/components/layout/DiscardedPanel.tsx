import type { DiscardedItem } from "@/types/domain";

interface DiscardedPanelProps {
  visible: boolean;
  items: DiscardedItem[];
  onRestore: (id: number) => void;
  onDelete: (id: number) => void;
}

export function DiscardedPanel(props: DiscardedPanelProps) {
  if (!props.visible) return <section id="discarded-drafts-panel" className="hidden" />;

  return (
    <section id="discarded-drafts-panel">
      <div className="card discarded-panel-card">
        <div className="card-header">
          <h3>废弃稿件</h3>
          <span className="status-text" id="discarded-count-text">{props.items.length} 条</span>
        </div>
        <div id="discarded-drafts-list" className="discarded-list">
          {props.items.length === 0 ? (
            <div className="discarded-empty">（暂无废弃稿件）</div>
          ) : (
            props.items.map((item) => {
              const title = item.content.replace(/\s+/g, " ").trim().slice(0, 36) || `稿件 #${item.id}`;
              return (
                <details className="discarded-item" key={item.id}>
                  <summary>
                    <span className="discarded-item-title">{title}</span>
                    <span className="discarded-item-meta">
                      {item.created_at || ""} · {item.char_count || item.content.length}字
                    </span>
                  </summary>
                  <div className="discarded-item-content">
                    <pre className="discarded-item-text">{item.content}</pre>
                    <div className="discarded-item-actions">
                      <button className="btn btn-success btn-sm" onClick={() => props.onRestore(item.id)} type="button">复原</button>
                      <button className="btn btn-danger btn-sm" onClick={() => props.onDelete(item.id)} type="button">删除</button>
                    </div>
                  </div>
                </details>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

