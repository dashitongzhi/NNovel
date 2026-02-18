import { create } from "zustand";
import { STAGE_ORDER } from "@/config/defaults";
import {
  getGenerateStatus,
  pauseGenerate,
  getRecovery,
  resumeGenerate,
  savePauseSnapshot,
  startGenerate,
  stopGenerate,
} from "@/services/endpoints/generation";
import type { AppConfig, GenerationTaskState } from "@/types/domain";
import { useUiStore } from "@/stores/uiStore";
import { useConfigStore } from "@/stores/configStore";

interface StageDurations {
  queued: number;
  generating: number;
  finishing: number;
  completed: number;
}

interface RecoveryInfo {
  recoverable: boolean;
  task_id?: string;
  request_id?: string;
  partial_content?: string;
  thinking?: string;
  live_task?: boolean;
  live_state?: string;
}

interface GenerationState {
  taskId: string;
  requestId: string;
  stage: GenerationTaskState;
  stageDurations: StageDurations;
  stageSince: number;
  isWriting: boolean;
  isPaused: boolean;
  generatedText: string;
  thinking: string;
  referenceStatus: string;
  skipVisible: boolean;
  autoScroll: boolean;
  typewriterEnabled: boolean;
  typewriterSpeed: number;
  pollingStartedAt: number;
  recoveryInfo: RecoveryInfo | null;
  start: (config: AppConfig) => Promise<void>;
  stop: () => Promise<void>;
  togglePause: () => Promise<void>;
  setAutoScroll: (enabled: boolean) => void;
  setTypewriterEnabled: (enabled: boolean) => void;
  setTypewriterSpeed: (speed: number) => void;
  setReferenceStatus: (text: string) => void;
  skipTypewriter: () => void;
  clearGenerated: () => void;
  detectRecovery: () => Promise<RecoveryInfo | null>;
  resumeRecovery: () => Promise<boolean>;
}

let pollTimer: number | null = null;
let typingTimer: number | null = null;
let typingUsingRaf = false;
let typingCarryMs = 0;
let typingLastFrameTs = 0;
let streamTarget = "";
let streamIndex = 0;
let streamFinal = false;
let pollingNoChangeRounds = 0;
let pollingLastPartial = "";
let pendingStartToken: { cancelled: boolean } | null = null;
let pendingResumeToken: { cancelled: boolean } | null = null;
let pendingPauseDesired: boolean | null = null;
let pauseSyncNonce = 0;
let stopSyncNonce = 0;
let thinkingCycleMaxIndex = -1;
let thinkingCycleCompleted = false;
let thinkingCycleAnimating = false;
let pendingStreamPreviewText = "";
let pendingStreamPreviewFinalize = false;

const TYPEWRITER_ENABLED_KEY = "writer:typewriterEnabled";
const TYPEWRITER_SPEED_KEY = "writer:typewriterSpeed";
const THINKING_CYCLE_STEP_MS = 160;
const THINKING_PHASE_SEQUENCE = [
  "正在理解故事大纲，分析人物关系...",
  "正在构思本段情节的发展方向...",
  "正在撰写场景描写与人物对话...",
  "正在深入刻画人物内心活动...",
  "正在推进故事情节，制造冲突与悬念...",
  "正在润色文字，调整节奏与氛围...",
  "即将完成，进行最后的文字打磨...",
];

function stripPauseMarkerPrefix(text: string): string {
  return String(text || "")
    .replace(/^\s*已暂停(?:\.{3}|…)?\s*/u, "")
    .replace(/^\s*临时暂停快照[:：]?\s*/u, "");
}

function stripGeminiThinkingOutput(text: string): string {
  let out = String(text || "");
  out = out.replace(/```(?:thinking|reasoning|thoughts?|思考|推理)[\s\S]*?```/gi, "");
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
  out = out.replace(/^\s*(?:thought|thoughts|reasoning|thinking|思考|推理过程|思维链|chain[\s-]*of[\s-]*thought)\s*[:：].*$/gimu, "");
  out = out.replace(/^\s*[【\[]?(?:思考|推理|thinking|reasoning)[】\]]?\s*[:：].*$/gimu, "");
  return out.trimStart();
}

function normalizeGeneratedByEngine(text: string): string {
  const mode = String(useConfigStore.getState().config.engine_mode || "").toLowerCase();
  if (mode === "gemini") {
    return stripGeminiThinkingOutput(text);
  }
  return text;
}

function normalizeThinkingForMatch(text: string): string {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[.。!！?？]/g, "")
    .trim();
}

function findThinkingPhaseIndex(text: string): number {
  const target = normalizeThinkingForMatch(text);
  if (!target) return -1;
  for (let i = 0; i < THINKING_PHASE_SEQUENCE.length; i += 1) {
    const phase = normalizeThinkingForMatch(THINKING_PHASE_SEQUENCE[i]);
    if (!phase) continue;
    if (target === phase || target.includes(phase) || phase.includes(target)) {
      return i;
    }
  }
  return -1;
}

function resetThinkingCycleState(): void {
  thinkingCycleMaxIndex = -1;
  thinkingCycleCompleted = false;
  thinkingCycleAnimating = false;
  pendingStreamPreviewText = "";
  pendingStreamPreviewFinalize = false;
}

function recordThinkingPhase(text: string): void {
  const idx = findThinkingPhaseIndex(text);
  if (idx > thinkingCycleMaxIndex) {
    thinkingCycleMaxIndex = idx;
  }
  if (thinkingCycleMaxIndex >= THINKING_PHASE_SEQUENCE.length - 1) {
    thinkingCycleCompleted = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function readTypewriterEnabled(): boolean {
  const raw = localStorage.getItem(TYPEWRITER_ENABLED_KEY);
  if (raw == null) return true;
  return raw === "true";
}

function readTypewriterSpeed(): number {
  const raw = Number(localStorage.getItem(TYPEWRITER_SPEED_KEY) || "30");
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(120, Math.max(10, Math.round(raw)));
}

const defaultDurations = (): StageDurations => ({
  queued: 0,
  generating: 0,
  finishing: 0,
  completed: 0,
});

function generationSnapshot(): Record<string, unknown> {
  const s = useGenerationStore.getState();
  return {
    stage: s.stage,
    isWriting: s.isWriting,
    isPaused: s.isPaused,
    hasTask: Boolean(s.taskId),
    taskId: s.taskId || "",
    requestId: s.requestId || "",
    skipVisible: s.skipVisible,
    textLen: String(s.generatedText || "").length,
  };
}

function debugGeneration(tag: string, extra?: Record<string, unknown>): void {
  let suffix = "";
  if (extra) {
    try {
      suffix = ` | ${JSON.stringify(extra)}`;
    } catch {
      suffix = "";
    }
  }
  const message = `[debug][gen:${tag}] ${JSON.stringify(generationSnapshot())}${suffix}`;
  console.debug(message);
  useUiStore.getState().addInfo(message);
}

function requestTag(requestId = ""): string {
  const rid = String(requestId || useGenerationStore.getState().requestId || "").trim();
  if (!rid) return "";
  return ` [${rid}]`;
}

function classifyGenerationIssue(rawMessage: string, code = ""): { type: string; detail: string } {
  const normalizedCode = String(code || "").trim().toLowerCase();
  if (normalizedCode === "timeout" || normalizedCode === "transport_timeout") {
    return { type: "超时", detail: String(rawMessage || "").trim() || "请求超时" };
  }
  if (normalizedCode === "quota") {
    return { type: "余额不足", detail: String(rawMessage || "").trim() || "额度不足" };
  }
  if (normalizedCode === "auth_key_missing") {
    return { type: "缺少密钥", detail: String(rawMessage || "").trim() || "未配置 API Key" };
  }
  if (normalizedCode === "auth_key_invalid") {
    return { type: "密钥失效", detail: String(rawMessage || "").trim() || "API Key 无效或已过期" };
  }
  if (normalizedCode === "auth_permission") {
    return { type: "权限不足", detail: String(rawMessage || "").trim() || "当前账号无权限访问该模型" };
  }
  if (normalizedCode === "auth") {
    return { type: "鉴权失败", detail: String(rawMessage || "").trim() || "鉴权失败" };
  }
  if (normalizedCode === "transport_proxy") {
    return { type: "代理失败", detail: String(rawMessage || "").trim() || "代理连接失败" };
  }
  if (normalizedCode === "transport_tls") {
    return { type: "TLS失败", detail: String(rawMessage || "").trim() || "TLS/SSL 握手失败" };
  }
  if (normalizedCode === "transport") {
    return { type: "连接异常", detail: String(rawMessage || "").trim() || "网络连接异常" };
  }
  if (normalizedCode === "stopped") {
    return { type: "已停止", detail: String(rawMessage || "").trim() || "已停止生成" };
  }

  const message = String(rawMessage || "").trim();
  const lower = message.toLowerCase();
  if (!message) {
    return { type: "未知异常", detail: "未知错误" };
  }
  if (/timeout|timed out|超时/.test(lower) || /超时/.test(message)) {
    return { type: "超时", detail: message };
  }
  if (/quota|insufficient|balance|credit|余额|额度不足|资源包/.test(lower) || /余额不足|额度不足/.test(message)) {
    return { type: "余额不足", detail: message };
  }
  if (/forbidden|permission|权限不足/.test(lower) || /权限不足|无权限/.test(message)) {
    return { type: "权限不足", detail: message };
  }
  if (/invalid api key|api key|token|401|密钥/.test(lower) || /令牌|密钥无效/.test(message)) {
    return { type: "密钥失效", detail: message };
  }
  if (/unauthorized|auth|认证|鉴权|403/.test(lower) || /鉴权失败|认证失败/.test(message)) {
    return { type: "鉴权失败", detail: message };
  }
  if (/proxy|407|tunnel|代理/.test(lower) || /代理/.test(message)) {
    return { type: "代理失败", detail: message };
  }
  if (/tls|ssl|certificate|eof/.test(lower) || /TLS|SSL|证书/.test(message)) {
    return { type: "TLS失败", detail: message };
  }
  if (/connection|network|ssl|transport|eof|连接|网络/.test(lower) || /连接|网络|SSL/.test(message)) {
    return { type: "连接异常", detail: message };
  }
  return { type: "异常", detail: message };
}

function formatGenerationIssueText(rawMessage: string, code = ""): string {
  const parsed = classifyGenerationIssue(rawMessage, code);
  return `${parsed.type}: ${parsed.detail}`;
}

function setStage(next: GenerationTaskState): void {
  const store = useGenerationStore.getState();
  const now = Date.now();
  const current = store.stage;
  if (STAGE_ORDER.includes(current as never) && store.stageSince > 0) {
    const currentKey = current as keyof StageDurations;
    const nextDurations = { ...store.stageDurations };
    nextDurations[currentKey] += now - store.stageSince;
    useGenerationStore.setState({ stageDurations: nextDurations });
  }
  useGenerationStore.setState({ stage: next, stageSince: now });
}

function stopPolling(): void {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function stopTyping(): void {
  if (typingTimer != null) {
    if (typingUsingRaf) {
      window.cancelAnimationFrame(typingTimer);
    } else {
      window.clearTimeout(typingTimer);
    }
    typingTimer = null;
  }
  typingUsingRaf = false;
  typingCarryMs = 0;
  typingLastFrameTs = 0;
}

function resetStreamingState(): void {
  stopTyping();
  streamTarget = "";
  streamIndex = 0;
  streamFinal = false;
  resetThinkingCycleState();
  useGenerationStore.setState({ skipVisible: false });
}

function finalizeGeneratedOutput(finalText: string, toast = true): void {
  resetStreamingState();
  pendingPauseDesired = null;
  useGenerationStore.setState({
    generatedText: finalText,
    isWriting: false,
    taskId: "",
    isPaused: false,
    skipVisible: false,
  });
  setStage("completed");
  if (toast) {
    useUiStore.getState().addToast(`内容生成完毕${requestTag()}`, "success");
  }
}

function syncPauseToBackend(taskId: string, paused: boolean): void {
  const nonce = ++pauseSyncNonce;
  debugGeneration("pause:sync:enqueue", { taskId, paused, nonce });
  const run = (attempt: number): void => {
    if (nonce !== pauseSyncNonce) return;
    debugGeneration("pause:sync:try", { taskId, paused, nonce, attempt });
    void pauseGenerate(taskId, paused)
      .then(() => {
        if (nonce !== pauseSyncNonce) return;
        debugGeneration("pause:sync:ok", { taskId, paused, nonce, attempt });
      })
      .catch(() => {
        if (nonce !== pauseSyncNonce) return;
        debugGeneration("pause:sync:fail", { taskId, paused, nonce, attempt });
        if (attempt >= 2) return;
        window.setTimeout(() => run(attempt + 1), 180 * (attempt + 1));
      });
  };
  run(0);
}

function syncStopToBackend(taskId: string): void {
  const nonce = ++stopSyncNonce;
  debugGeneration("stop:sync:enqueue", { taskId, nonce });
  const run = (attempt: number): void => {
    if (nonce !== stopSyncNonce) return;
    debugGeneration("stop:sync:try", { taskId, nonce, attempt });
    void stopGenerate(taskId)
      .then((payload) => {
        if (nonce !== stopSyncNonce) return;
        if (payload.request_id) {
          useGenerationStore.setState({ requestId: payload.request_id });
        }
        debugGeneration("stop:sync:ok", { taskId, nonce, attempt, requestId: payload.request_id || "" });
      })
      .catch((error) => {
        if (nonce !== stopSyncNonce) return;
        debugGeneration("stop:sync:fail", { taskId, nonce, attempt });
        if (attempt >= 2) {
          const message = error instanceof Error ? error.message : "停止请求发送失败";
          useUiStore.getState().addToast(`停止请求发送失败: ${message}`, "warning");
          return;
        }
        window.setTimeout(() => run(attempt + 1), 220 * (attempt + 1));
      });
  };
  run(0);
}

function flushBufferedStreamingPreview(): void {
  if (!thinkingCycleCompleted) return;
  const state = useGenerationStore.getState();
  if (!state.isWriting || state.isPaused) return;
  const buffered = String(pendingStreamPreviewText || "");
  if (!buffered.trim()) return;
  const finalize = Boolean(pendingStreamPreviewFinalize);
  pendingStreamPreviewText = "";
  pendingStreamPreviewFinalize = false;
  queueStreamingPreview(buffered, finalize);
  if (useGenerationStore.getState().stage === "queued") {
    setStage("generating");
  }
}

async function ensureThinkingCycleThenStream(): Promise<void> {
  if (thinkingCycleCompleted || thinkingCycleAnimating) {
    flushBufferedStreamingPreview();
    return;
  }
  thinkingCycleAnimating = true;
  try {
    const start = Math.max(thinkingCycleMaxIndex + 1, 0);
    for (let i = start; i < THINKING_PHASE_SEQUENCE.length; i += 1) {
      const state = useGenerationStore.getState();
      if (!state.isWriting || state.isPaused) {
        break;
      }
      useGenerationStore.setState({ thinking: THINKING_PHASE_SEQUENCE[i] });
      thinkingCycleMaxIndex = Math.max(thinkingCycleMaxIndex, i);
      await sleep(THINKING_CYCLE_STEP_MS);
    }
    if (thinkingCycleMaxIndex >= THINKING_PHASE_SEQUENCE.length - 1) {
      thinkingCycleCompleted = true;
    }
  } finally {
    thinkingCycleAnimating = false;
    flushBufferedStreamingPreview();
  }
}

function queueStreamingPreview(content: string, finalize = false): void {
  const text = stripPauseMarkerPrefix(String(content || ""));
  if (!text.trim()) return;

  const state = useGenerationStore.getState();
  if (!state.typewriterEnabled) {
    if (finalize) {
      finalizeGeneratedOutput(text, true);
    } else {
      useGenerationStore.setState({ generatedText: text, skipVisible: false });
    }
    return;
  }

  streamTarget = text;
  streamFinal = streamFinal || finalize;

  if (streamIndex <= 0) {
    streamIndex = Math.max(0, Math.min(state.generatedText.length, streamTarget.length));
  }
  if (streamIndex > streamTarget.length) {
    streamIndex = streamTarget.length;
  }

  useGenerationStore.setState({ skipVisible: streamFinal && streamIndex < streamTarget.length });

  if (typingTimer) return;
  typingCarryMs = Math.max(typingCarryMs, Math.max(10, state.typewriterSpeed));
  typingLastFrameTs = 0;

  const scheduleNext = () => {
    if (typeof window.requestAnimationFrame === "function") {
      typingUsingRaf = true;
      typingTimer = window.requestAnimationFrame(tick);
      return;
    }
    typingUsingRaf = false;
    typingTimer = window.setTimeout(() => {
      tick(Date.now());
    }, 16);
  };

  const completeStream = () => {
    typingTimer = null;
    typingUsingRaf = false;
    typingCarryMs = 0;
    typingLastFrameTs = 0;
    if (streamFinal) {
      finalizeGeneratedOutput(streamTarget, true);
    } else {
      useGenerationStore.setState({ skipVisible: false });
    }
  };

  const tick = (frameTs: number) => {
    const latest = useGenerationStore.getState();
    if (streamIndex >= streamTarget.length) {
      completeStream();
      return;
    }

    const now = Number.isFinite(frameTs) ? frameTs : Date.now();
    if (!typingLastFrameTs) typingLastFrameTs = now;
    let delta = now - typingLastFrameTs;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    if (delta > 120) delta = 120;
    typingLastFrameTs = now;

    const speed = Math.max(10, latest.typewriterSpeed);
    typingCarryMs += delta;
    let step = Math.floor(typingCarryMs / speed);
    if (step <= 0) {
      scheduleNext();
      return;
    }
    typingCarryMs -= step * speed;
    step = Math.max(1, Math.min(step, 24));

    const remaining = streamTarget.length - streamIndex;
    streamIndex += Math.min(step, remaining);
    useGenerationStore.setState({
      generatedText: streamTarget.slice(0, streamIndex),
      skipVisible: streamFinal && streamIndex < streamTarget.length,
    });
    if (latest.stage === "queued") {
      setStage("generating");
    }

    if (streamIndex >= streamTarget.length) {
      completeStream();
      return;
    }
    scheduleNext();
  };

  // Start with one scheduled frame. The carry value ensures immediate visible progress.
  scheduleNext();
}

function nextPollingDelay(startedAt: number): number {
  const elapsed = Math.max(0, Date.now() - startedAt);
  let base = 700;
  if (elapsed > 9000) base = 1000;
  if (elapsed > 28000) base = 1400;
  if (elapsed > 65000) base = 2100;

  if (pollingNoChangeRounds >= 6) base += 500;
  if (pollingNoChangeRounds >= 12) base += 800;
  if (pollingNoChangeRounds >= 20) base += 1000;
  return Math.min(4200, Math.max(500, base));
}

async function poll(taskId: string): Promise<void> {
  const state = useGenerationStore.getState();
  if (!state.isWriting || state.isPaused || state.taskId !== taskId) {
    debugGeneration("poll:skip", {
      reason: !state.isWriting ? "not-writing" : state.isPaused ? "paused" : "task-mismatch",
      expectTaskId: taskId,
    });
    return;
  }

  try {
    const result = await getGenerateStatus(taskId);
    if (result.request_id) {
      useGenerationStore.setState({ requestId: result.request_id });
    }

    const newest = useGenerationStore.getState();
    if (!newest.isWriting || newest.isPaused || newest.taskId !== taskId) {
      return;
    }

    if (result.state === "done") {
      stopPolling();
      setStage("finishing");
      const finalText = normalizeGeneratedByEngine(stripPauseMarkerPrefix(String(result.content || "")));
      if (newest.typewriterEnabled && finalText.trim()) {
        pendingStreamPreviewText = finalText;
        pendingStreamPreviewFinalize = true;
        if (!thinkingCycleCompleted) {
          await ensureThinkingCycleThenStream();
        } else {
          flushBufferedStreamingPreview();
        }
      } else {
        finalizeGeneratedOutput(finalText, true);
      }
      pendingPauseDesired = null;
      useGenerationStore.setState({ requestId: "" });
      return;
    }

    if (result.state === "error") {
      stopPolling();
      resetStreamingState();
      pendingPauseDesired = null;
      const reason = formatGenerationIssueText(result.message || "生成失败", result.error_code || "");
      useGenerationStore.setState({
        isWriting: false,
        isPaused: false,
        taskId: "",
        stage: "error",
        thinking: "状态异常",
        skipVisible: false,
      });
      useUiStore.getState().addToast(`生成出错: ${reason}${requestTag(result.request_id || "")}`, "error");
      return;
    }

    if (result.state === "stopped" || result.state === "stopping") {
      stopPolling();
      resetStreamingState();
      pendingPauseDesired = null;
      useGenerationStore.setState({
        isWriting: false,
        isPaused: false,
        taskId: "",
        stage: "stopped",
        thinking: result.message || "已停止",
        skipVisible: false,
      });
      useGenerationStore.setState({ requestId: "" });
      return;
    }

    if (result.state === "paused") {
      if (pendingPauseDesired === false) {
        debugGeneration("poll:paused:ignored", { reason: "frontend-resuming", taskId });
        const delay = 160;
        pollTimer = window.setTimeout(() => {
          void poll(taskId);
        }, delay);
        return;
      }
      stopPolling();
      stopTyping();
      pendingPauseDesired = true;
      useGenerationStore.setState({
        isPaused: true,
        thinking: result.thinking || "已暂停",
        skipVisible: Boolean(streamFinal && streamTarget && streamIndex < streamTarget.length),
      });
      return;
    }

    const thinking = String(result.thinking || "AI 正在构思...");
    const partial = normalizeGeneratedByEngine(stripPauseMarkerPrefix(String(result.partial_content || "")));
    recordThinkingPhase(thinking);

    if (partial && partial === pollingLastPartial) {
      pollingNoChangeRounds += 1;
    } else {
      pollingNoChangeRounds = 0;
      pollingLastPartial = partial;
    }

    if (partial.trim()) {
      if (useGenerationStore.getState().stage === "queued") {
        setStage("generating");
      }
      if (useGenerationStore.getState().typewriterEnabled) {
        if (thinkingCycleCompleted) {
          queueStreamingPreview(partial, false);
        } else {
          pendingStreamPreviewText = partial;
          pendingStreamPreviewFinalize = false;
          if (!useGenerationStore.getState().generatedText.trim()) {
            useGenerationStore.setState({ thinking });
          }
          void ensureThinkingCycleThenStream();
        }
      } else {
        useGenerationStore.setState({ generatedText: partial, skipVisible: false });
      }
    }

    if (!useGenerationStore.getState().generatedText.trim() && !thinkingCycleAnimating) {
      useGenerationStore.setState({ thinking });
    }

    const delay = nextPollingDelay(useGenerationStore.getState().pollingStartedAt);
    pollTimer = window.setTimeout(() => {
      void poll(taskId);
    }, delay);
  } catch (error) {
    stopPolling();
    resetStreamingState();
    pendingPauseDesired = null;
    const message = error instanceof Error ? error.message : "连接中断";
    const parsed = formatGenerationIssueText(message);
    useGenerationStore.setState({
      isWriting: false,
      isPaused: false,
      taskId: "",
      stage: "error",
      thinking: "状态异常",
      skipVisible: false,
    });
    useUiStore.getState().addToast(`轮询状态失败: ${parsed}${requestTag()}`, "error");
  }
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  taskId: "",
  requestId: "",
  stage: "idle",
  stageDurations: defaultDurations(),
  stageSince: 0,
  isWriting: false,
  isPaused: false,
  generatedText: "",
  thinking: "就绪",
  referenceStatus: "",
  skipVisible: false,
  autoScroll: true,
  typewriterEnabled: readTypewriterEnabled(),
  typewriterSpeed: readTypewriterSpeed(),
  pollingStartedAt: 0,
  recoveryInfo: null,

  start: async (config) => {
    debugGeneration("start:click", {
      engine_mode: config.engine_mode,
      model:
        config.engine_mode === "doubao"
          ? config.doubao_model
          : config.engine_mode === "personal"
            ? config.personal_model
            : config.engine_mode === "gemini"
              ? config.gemini_model
              : config.engine_mode === "claude"
                ? config.claude_model
                : config.codex_model,
    });
    if (get().isWriting) {
      debugGeneration("start:redirect-stop");
      void get().stop();
      return;
    }

    if (pendingResumeToken) {
      pendingResumeToken.cancelled = true;
      pendingResumeToken = null;
    }
    const startToken = { cancelled: false };
    pendingStartToken = startToken;

    resetStreamingState();
    stopPolling();
    pollingNoChangeRounds = 0;
    pollingLastPartial = "";
    pendingPauseDesired = null;

    set({
      isWriting: true,
      isPaused: false,
      generatedText: "",
      thinking: "AI 正在构思...",
      stageDurations: defaultDurations(),
      pollingStartedAt: Date.now(),
      recoveryInfo: null,
      requestId: "",
      skipVisible: false,
    });
    debugGeneration("start:optimistic-set");
    setStage("queued");

    try {
      const payload = await startGenerate(config);
      const taskId = String(payload.task_id || "");
      if (!taskId) {
        throw new Error("未获取到任务ID");
      }
      if (startToken.cancelled) {
        debugGeneration("start:cancelled-before-bind", { taskId });
        try {
          await stopGenerate(taskId);
        } catch {
          // ignore
        } finally {
          pendingStartToken = null;
        }
        return;
      }
      set({ taskId, requestId: payload.request_id || "" });
      debugGeneration("start:task-bound", { taskId, requestId: payload.request_id || "" });
      if (pendingPauseDesired === true) {
        stopPolling();
        stopTyping();
        set({
          isPaused: true,
          thinking: "已暂停",
          skipVisible: false,
        });
        setStage("paused");
        debugGeneration("start:paused-before-poll", { taskId });
        void pauseGenerate(taskId, true).catch(() => {
          // ignore pause sync failure
        });
        return;
      }
      setStage("generating");
      debugGeneration("start:poll-begin", { taskId });
      await poll(taskId);
    } catch (error) {
      if (startToken.cancelled) {
        debugGeneration("start:cancelled-ignore-error");
        return;
      }
      stopPolling();
      resetStreamingState();
      pendingPauseDesired = null;
      const message = error instanceof Error ? error.message : "启动写作失败";
      const parsed = formatGenerationIssueText(message);
      set({
        isWriting: false,
        isPaused: false,
        taskId: "",
        stage: "error",
        thinking: "状态异常",
        skipVisible: false,
      });
      useUiStore.getState().addToast(`启动生成失败: ${parsed}${requestTag()}`, "error");
      debugGeneration("start:error", { message: parsed });
    } finally {
      if (pendingStartToken === startToken) {
        pendingStartToken = null;
      }
      debugGeneration("start:finally");
    }
  },

  stop: async () => {
    debugGeneration("stop:click");
    const { taskId } = get();
    pendingPauseDesired = null;
    if (pendingResumeToken && !taskId) {
      pendingResumeToken.cancelled = true;
      pendingResumeToken = null;
    }
    if (pendingStartToken && !taskId) {
      pendingStartToken.cancelled = true;
    }
    if (!taskId && !get().isWriting) {
      set({
        stage: "stopped",
        thinking: "已停止",
        skipVisible: false,
      });
      debugGeneration("stop:no-task-frontend-only");
      return;
    }

    stopPolling();
    resetStreamingState();
    set({
      isWriting: false,
      isPaused: false,
      stage: "stopped",
      stageDurations: defaultDurations(),
      stageSince: 0,
      taskId: "",
      thinking: "已停止",
      generatedText: "(写作已停止)",
      skipVisible: false,
      requestId: "",
    });
    debugGeneration("stop:optimistic-set", { taskId });

    if (taskId) {
      syncStopToBackend(taskId);
    }

    useUiStore.getState().addToast(`写作已停止${requestTag()}`, "warning");
  },

  togglePause: async () => {
    const state = get();
    debugGeneration("pause:click", {
      stateIsWriting: state.isWriting,
      stateIsPaused: state.isPaused,
      taskId: state.taskId || "",
    });
    const hasBackendTask = Boolean(state.taskId);
    const hasLiveWriting = Boolean(state.isWriting || hasBackendTask);
    const nextPaused = !state.isPaused;

    // Front-end first: always flip visual state immediately on click.
    if (nextPaused) {
      pendingPauseDesired = true;
      stopPolling();
      stopTyping();
      set({
        isPaused: true,
        thinking: "已暂停",
        skipVisible: Boolean(streamFinal && streamTarget && streamIndex < streamTarget.length),
        stage: hasLiveWriting ? state.stage : "paused",
      });

      const snapshot = stripPauseMarkerPrefix(String(streamTarget || state.generatedText || "")).trim();
      if (snapshot && hasBackendTask) {
        void savePauseSnapshot({
          task_id: state.taskId,
          request_id: state.requestId,
          content: snapshot,
        }).catch(() => {
          // ignore snapshot save errors
        });
      }
      if (hasBackendTask) {
        syncPauseToBackend(state.taskId, true);
      }
      useUiStore.getState().addToast("写作已暂停", "info");
      debugGeneration("pause:frontend-paused", { hasBackendTask });

      // Defensive fallback for edge-cases where user clicked while no active task.
      if (!hasLiveWriting) {
        window.setTimeout(() => {
          const latest = get();
          if (!latest.isWriting && !latest.taskId) {
            set({
              isPaused: false,
              thinking: "就绪",
              stage: latest.stage === "paused" ? "idle" : latest.stage,
            });
          }
        }, 140);
      }
      return;
    }

    pendingPauseDesired = false;
    if (hasLiveWriting && !["queued", "generating", "finishing"].includes(String(state.stage || ""))) {
      setStage("generating");
    }
    set({
      isPaused: false,
      thinking: hasLiveWriting ? "AI 正在创作..." : "就绪",
      stage: !hasLiveWriting && state.stage === "paused" ? "idle" : state.stage,
    });

    if (hasBackendTask) {
      syncPauseToBackend(state.taskId, false);
      void poll(state.taskId);
      useUiStore.getState().addToast("继续写作", "info");
      debugGeneration("pause:frontend-resumed", { hasBackendTask: true });
      return;
    }

    useUiStore.getState().addToast(hasLiveWriting ? "继续写作" : "当前没有可继续的写作任务", hasLiveWriting ? "info" : "warning");
    debugGeneration("pause:frontend-resumed", { hasBackendTask: false, hasLiveWriting });
  },

  setAutoScroll: (enabled) => set({ autoScroll: enabled }),

  setTypewriterEnabled: (enabled) => {
    localStorage.setItem(TYPEWRITER_ENABLED_KEY, String(enabled));
    set({ typewriterEnabled: enabled });

    if (!enabled && streamTarget) {
      stopTyping();
      streamIndex = streamTarget.length;
      if (streamFinal) {
        finalizeGeneratedOutput(streamTarget, true);
      } else {
        set({ generatedText: streamTarget, skipVisible: false });
      }
    }
  },

  setTypewriterSpeed: (speed) => {
    const next = Math.min(120, Math.max(10, Math.round(speed)));
    localStorage.setItem(TYPEWRITER_SPEED_KEY, String(next));
    set({ typewriterSpeed: next });
  },

  setReferenceStatus: (text) => set({ referenceStatus: String(text || "") }),

  skipTypewriter: () => {
    debugGeneration("skip:click", { hasStreamTarget: Boolean(streamTarget), streamFinal });
    if (!streamTarget) {
      useUiStore.getState().addToast("当前没有可跳过的动画", "info");
      debugGeneration("skip:ignored-no-target");
      return;
    }
    stopTyping();
    streamIndex = streamTarget.length;
    set({ generatedText: streamTarget, skipVisible: false });
    if (streamFinal) {
      finalizeGeneratedOutput(streamTarget, true);
    } else {
      set({ skipVisible: false });
    }
  },

  clearGenerated: () => {
    pendingPauseDesired = null;
    if (pendingResumeToken) {
      pendingResumeToken.cancelled = true;
      pendingResumeToken = null;
    }
    resetStreamingState();
    stopPolling();
    set({
      generatedText: "",
      stage: "idle",
      taskId: "",
      requestId: "",
      thinking: "就绪",
      isPaused: false,
      recoveryInfo: null,
      skipVisible: false,
      referenceStatus: "",
    });
  },

  detectRecovery: async () => {
    try {
      pendingPauseDesired = null;
      const info = await getRecovery();
      if (!info || !info.recoverable) {
        set({ recoveryInfo: null });
        return null;
      }

      const normalized: RecoveryInfo = {
        recoverable: true,
        task_id: info.task_id,
        request_id: info.request_id,
        partial_content: info.partial_content,
        thinking: info.thinking,
        live_task: info.live_task,
        live_state: info.live_state,
      };
      set({ recoveryInfo: normalized });

      if (normalized.live_task && normalized.task_id) {
        stopPolling();
        resetStreamingState();
        pollingNoChangeRounds = 0;
        pollingLastPartial = String(normalized.partial_content || "");

        set({
          isWriting: true,
          isPaused: false,
          stage: "generating",
          taskId: normalized.task_id,
          requestId: normalized.request_id || "",
          generatedText: normalizeGeneratedByEngine(stripPauseMarkerPrefix(String(normalized.partial_content || ""))),
          thinking: normalized.thinking || "AI 正在创作...",
          pollingStartedAt: Date.now(),
          stageDurations: defaultDurations(),
          skipVisible: false,
        });
        setStage("generating");
        await poll(normalized.task_id);
      } else if (normalized.partial_content) {
        set({
          generatedText: normalizeGeneratedByEngine(stripPauseMarkerPrefix(String(normalized.partial_content || ""))),
          thinking: "就绪",
          stage: "paused",
          isWriting: false,
          isPaused: false,
          skipVisible: false,
          requestId: normalized.request_id || "",
        });
      }

      return normalized;
    } catch {
      return null;
    }
  },

  resumeRecovery: async () => {
    const resumeToken = { cancelled: false };
    pendingResumeToken = resumeToken;
    pendingPauseDesired = null;
    stopPolling();
    resetStreamingState();
    pollingNoChangeRounds = 0;
    pollingLastPartial = "";
    set({
      isWriting: true,
      isPaused: false,
      stage: "queued",
      taskId: "",
      requestId: "",
      thinking: "AI 正在恢复任务...",
      generatedText: "",
      pollingStartedAt: Date.now(),
      stageDurations: defaultDurations(),
      stageSince: Date.now(),
      skipVisible: false,
    });
    try {
      const payload = await resumeGenerate();
      if (resumeToken.cancelled) {
        const staleTaskId = String(payload.task_id || "");
        if (staleTaskId) {
          void stopGenerate(staleTaskId).catch(() => {
            // ignore stale stop failure
          });
        }
        return false;
      }
      const taskId = String(payload.task_id || "");
      if (!payload.ok || !taskId) {
        set({
          isWriting: false,
          isPaused: false,
          stage: "idle",
          taskId: "",
          requestId: payload.request_id || "",
          thinking: "就绪",
          skipVisible: false,
        });
        return false;
      }

      set({
        isWriting: true,
        isPaused: false,
        stage: "generating",
        taskId,
        requestId: payload.request_id || "",
        pollingStartedAt: Date.now(),
        stageDurations: defaultDurations(),
        skipVisible: false,
        recoveryInfo: null,
      });
      setStage("generating");
      await poll(taskId);
      return true;
    } catch {
      if (resumeToken.cancelled) {
        return false;
      }
      set({
        isWriting: false,
        isPaused: false,
        stage: "idle",
        taskId: "",
        requestId: "",
        thinking: "就绪",
        skipVisible: false,
      });
      return false;
    } finally {
      if (pendingResumeToken === resumeToken) {
        pendingResumeToken = null;
      }
    }
  },
}));
