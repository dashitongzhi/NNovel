import { STAGE_ORDER } from "@/config/defaults";
import type { GenerationTaskState } from "@/types/domain";
import { LiquidGlassFrame } from "@/components/shared/LiquidGlassFrame";

interface GenerationPanelProps {
  statusState: GenerationTaskState;
  stage: GenerationTaskState;
  stageDurations: Record<string, number>;
  statusText: string;
  thinkingText: string;
  generatedText: string;
  referenceStatus: string;
  stageTimelineEnabled: boolean;
  isWriting: boolean;
  hasTask: boolean;
  isPaused: boolean;
  skipVisible: boolean;
  showTypeCursor: boolean;
  autoScroll: boolean;
  dynamicEffectsEnabled: boolean;
  onStartStop: () => void;
  onPauseResume: () => void;
  onSkip: () => void;
  onToggleAutoScroll: () => void;
  onAccept: () => void;
  onRewrite: () => void;
}

const WRITER_BUTTON_ICONS = {
  play: "▶️",
  stop: "🛑",
  pause: "⏸️",
  resume: "▶️",
  skip: '<svg class="btn-icon-svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 4a.7.7 0 0 1 1.1-.57L8 6.17V4.7a.7.7 0 0 1 1.1-.57l3.8 2.53a.7.7 0 0 1 0 1.16L9.1 10.35A.7.7 0 0 1 8 9.78V8.3l-3.9 2.74A.7.7 0 0 1 3 10.47z"/></svg>',
} as const;

function statusClass(stage: GenerationTaskState): string {
  if (stage === "error") return "error";
  if (stage === "paused") return "paused";
  if (stage === "stopped") return "stopped";
  if (stage === "completed") return "ready";
  if (stage === "queued" || stage === "generating" || stage === "finishing") return "thinking";
  return "ready";
}

function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function GenerationPanel(props: GenerationPanelProps) {
  const canSubmit = props.generatedText.trim().length > 0 && props.stage === "completed";
  const showThinking = props.isWriting && !props.generatedText.trim();
  const showCursor = props.showTypeCursor && !showThinking && !!props.generatedText;
  const triggerByPress = (event: { currentTarget: HTMLButtonElement; preventDefault: () => void }, action: () => void) => {
    event.preventDefault();
    event.currentTarget.dataset.fastPressed = "1";
    action();
  };
  const triggerByClickFallback = (event: { currentTarget: HTMLButtonElement }, action: () => void) => {
    if (event.currentTarget.dataset.fastPressed === "1") {
      event.currentTarget.dataset.fastPressed = "";
      return;
    }
    action();
  };

  return (
    <LiquidGlassFrame id="generation-area" className="card liquid-glass-card-shell" dynamic={props.dynamicEffectsEnabled}>
      <div className="card-header">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          AI 作家
          <div className="status-indicator-wrapper" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <span id="status-dot" className={`status-dot ${statusClass(props.statusState)}`} />
            <span id="status-text" className="status-text">{props.statusText}</span>
          </div>
          <span
            id="ref-status"
            className="status-text"
            style={{ display: props.referenceStatus && !props.skipVisible ? undefined : "none", fontSize: 12, marginLeft: 4, color: "var(--accent)" }}
          >
            {props.referenceStatus}
          </span>
        </h3>
        <div className="toolbar">
          <button
            id="pause-writing-btn"
            className={`btn btn-warning btn-sm writer-icon-btn ${props.isWriting || props.hasTask ? "" : "hidden"}`}
            type="button"
            onMouseDown={(e) => triggerByPress(e, props.onPauseResume)}
            onClick={(e) => triggerByClickFallback(e, props.onPauseResume)}
            title={props.isPaused ? "继续写作" : "暂停写作"}
            aria-label={props.isPaused ? "继续写作" : "暂停写作"}
          >
            <span className="btn-icon-text" aria-hidden="true">
              {props.isPaused ? WRITER_BUTTON_ICONS.resume : WRITER_BUTTON_ICONS.pause}
            </span>
          </button>
          <button
            id="start-writing-btn"
            className={`btn btn-sm writer-icon-btn ${props.isWriting ? "btn-danger" : "btn-success"}`}
            type="button"
            onMouseDown={(e) => triggerByPress(e, props.onStartStop)}
            onClick={(e) => triggerByClickFallback(e, props.onStartStop)}
            title={props.isWriting ? "停止写作" : "开始写作"}
            aria-label={props.isWriting ? "停止写作" : "开始写作"}
          >
            <span className="btn-icon-text" aria-hidden="true">
              {props.isWriting ? WRITER_BUTTON_ICONS.stop : WRITER_BUTTON_ICONS.play}
            </span>
          </button>
          <button
            id="skip-anim-btn"
            className={`btn btn-sm btn-primary writer-icon-btn ${props.skipVisible ? "" : "hidden"}`}
            onMouseDown={(e) => triggerByPress(e, props.onSkip)}
            onClick={(e) => triggerByClickFallback(e, props.onSkip)}
            type="button"
            title="跳过动画"
            aria-label="跳过动画"
          >
            <span className="btn-icon-text" aria-hidden="true" dangerouslySetInnerHTML={{ __html: WRITER_BUTTON_ICONS.skip }} />
          </button>
          <button
            id="auto-scroll-btn"
            className={`btn btn-sm btn-primary writer-icon-btn ${props.autoScroll ? "lock-on" : "lock-off"}`}
            onMouseDown={(e) => triggerByPress(e, props.onToggleAutoScroll)}
            onClick={(e) => triggerByClickFallback(e, props.onToggleAutoScroll)}
            type="button"
            title={props.autoScroll ? "自动滚动: 开" : "自动滚动: 关"}
            aria-label={props.autoScroll ? "自动滚动: 开" : "自动滚动: 关"}
          >
            <span className="btn-icon-text" aria-hidden="true">{props.autoScroll ? "🔒" : "↕️"}</span>
          </button>
        </div>
      </div>

      <div id="generation-stage-track" className={`generation-stage-track ${props.stageTimelineEnabled ? "" : "hidden"}`}>
        {STAGE_ORDER.map((name) => {
          const done = STAGE_ORDER.indexOf(name) < STAGE_ORDER.indexOf(props.stage as never);
          const active = name === props.stage;
          return (
            <div key={name} className={`stage-item ${done ? "done" : ""} ${active ? "active" : ""}`} data-stage={name}>
              <span className="stage-name">
                {name === "queued" ? "排队" : name === "generating" ? "生成" : name === "finishing" ? "收尾" : "完成"}
              </span>
              <span className="stage-time">{formatSeconds(props.stageDurations[name] || 0)}</span>
            </div>
          );
        })}
      </div>

      <div id="generated-content" className="content-area">
        {showThinking ? (
          <div className="thinking-container">
            <div className={`thinking-spinner ${props.isPaused ? "paused" : ""}`} />
            <div id="thinking-text" className={`thinking-text ${props.isPaused ? "paused" : ""}`}>{props.thinkingText || "AI 正在构思..."}</div>
          </div>
        ) : (
          <span className="generated-inline">
            {props.generatedText || ""}
            {showCursor ? <span className="cursor-blink" aria-hidden="true" /> : null}
          </span>
        )}
      </div>

      <div id="gen-actions" className={`card-footer ${canSubmit ? "" : "hidden"}`}>
        <button id="accept-btn" className="btn btn-success" type="button" onClick={props.onAccept}>
          接受
        </button>
        <button id="delete-btn" className="btn btn-danger" type="button" onClick={props.onRewrite}>
          重写
        </button>
      </div>
    </LiquidGlassFrame>
  );
}
