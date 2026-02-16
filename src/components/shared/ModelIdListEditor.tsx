import { useState } from "react";

interface ModelIdListEditorProps {
  idPrefix: string;
  rows: string[];
  onRowsChange: (rows: string[]) => void;
  hint: string;
}

export function ModelIdListEditor(props: ModelIdListEditorProps) {
  const { idPrefix, rows, onRowsChange, hint } = props;
  const list = rows.length ? rows : [""];
  const count = list.filter((x) => String(x || "").trim()).length;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const updateRow = (index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    onRowsChange(next);
  };

  const removeRow = (index: number) => {
    if (list.length <= 1) {
      onRowsChange([""]);
      return;
    }
    const next = list.filter((_, i) => i !== index);
    onRowsChange(next.length ? next : [""]);
  };

  const addRow = () => {
    onRowsChange([...list, ""]);
  };

  const reorderRows = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onRowsChange(next);
  };

  return (
    <details id={`${idPrefix}-model-list-details`} className="personal-model-list-details" open>
      <summary>
        <span>模型ID列表</span>
        <span id={`${idPrefix}-model-list-summary`} className="personal-model-list-summary">
          {count} 个
        </span>
      </summary>
      <div className="personal-model-list-body">
        <div className="settings-row">
          <label className="settings-label">Model ID</label>
          <div className="settings-control">
            <div
              id={`${idPrefix}-model-inputs`}
              className={`personal-model-inputs ${dragIndex !== null ? "dragging-active" : ""}`}
            >
              {list.map((value, index) => (
                <div
                  key={`${idPrefix}-row-${index}`}
                  className={`${idPrefix}-model-row personal-model-row ${dragIndex === index ? "dragging-current" : ""}`}
                  data-model-prefix={idPrefix}
                  data-model-index={index}
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    setDropIndex(index);
                    try {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                    } catch {
                      // ignore
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dropIndex !== index) setDropIndex(index);
                    try {
                      event.dataTransfer.dropEffect = "move";
                    } catch {
                      // ignore
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = dragIndex;
                    const to = index;
                    if (from !== null) reorderRows(from, to);
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                >
                  <input
                    className={`settings-number-input ${idPrefix}-model-id-input personal-model-id-input`}
                    type="text"
                    value={value}
                    onChange={(e) => updateRow(index, e.target.value)}
                  />
                  <button
                    type="button"
                    className={`icon-btn ${idPrefix}-model-remove-btn personal-model-remove-btn`}
                    title="删除该模型"
                    aria-label="删除该模型"
                    onClick={() => removeRow(index)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {dragIndex !== null && dropIndex !== null && dropIndex >= 0 && dropIndex < list.length ? (
                <div className="personal-model-placeholder" />
              ) : null}
            </div>
          </div>
        </div>
        <button id={`${idPrefix}-model-add-btn`} className="btn btn-primary btn-sm" type="button" onClick={addRow}>
          ＋ 添加模型
        </button>
        <p className="settings-desc">{hint}</p>
      </div>
    </details>
  );
}
