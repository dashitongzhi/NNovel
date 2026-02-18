import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { DraftPanel } from "@/components/layout/DraftPanel";
import { GenerationPanel } from "@/components/layout/GenerationPanel";
import { DiscardedPanel } from "@/components/layout/DiscardedPanel";
import { ModalHost } from "@/components/modals/ModalHost";
import { ToastStack } from "@/components/shared/ToastStack";
import { ConfigSelect } from "@/components/shared/ConfigSelect";
import { ModelIdListEditor } from "@/components/shared/ModelIdListEditor";
import { BACKGROUND_LIBRARY, DEFAULT_BACKGROUND_ID, type BackgroundItem } from "@/config/backgroundLibrary";
import { useConfigStore } from "@/stores/configStore";
import { useDraftStore } from "@/stores/draftStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useDiscardedStore } from "@/stores/discardedStore";
import { useUiStore, type ThemeMode } from "@/stores/uiStore";
import { diffMemory } from "@/utils/memory";
import { generateChapterTitle, saveChapter } from "@/services/endpoints/chapter";
import { generateOutline } from "@/services/endpoints/outline";
import { polishDraft } from "@/services/endpoints/polish";
import { getBooks, createBook, switchBook } from "@/services/endpoints/books";
import { listChapters, getChapter, deleteChapter, type ChapterItem } from "@/services/endpoints/chapters";
import { uploadTxt } from "@/services/endpoints/upload";
import {
  getAuthFile,
  getSettingsFile,
  openAuthFile,
  openSettingsFile,
  restoreAuthFile,
  restoreSettingsFile,
  saveAuthFile,
  saveSettingsFile,
} from "@/services/endpoints/settingsFiles";
import { getSelfCheck, getStatus, prewarmEngine, saveProxyPort, testConnectivity } from "@/services/endpoints/runtime";
import type { AppConfig, BookshelfPayload, ConsistencyConflict, ModelHealthRow, StartupStatus } from "@/types/domain";

function statusText(stage: string, isPaused: boolean, isWriting: boolean): string {
  if (isPaused) return "已暂停";
  if (isWriting || stage === "queued" || stage === "generating" || stage === "finishing") return "AI正在创作...";
  if (stage === "completed") return "AI创作完成";
  if (stage === "paused") return "已暂停";
  if (stage === "error") return "状态异常";
  if (stage === "stopped") return "已停止";
  return "就绪";
}

function modeLabel(mode: AppConfig["engine_mode"]): string {
  if (mode === "personal") return "个人配置";
  if (mode === "doubao") return "Doubao";
  if (mode === "claude") return "Claude";
  if (mode === "gemini") return "Gemini";
  return "ChatGPT";
}

function themeModeLabel(mode: ThemeMode): string {
  if (mode === "light") return "浅色模式";
  if (mode === "dark") return "深色模式";
  return "跟随系统";
}

function modelForMode(config: AppConfig, mode: AppConfig["engine_mode"]): string {
  if (mode === "gemini") return String(config.gemini_model || "");
  if (mode === "claude") return String(config.claude_model || "");
  if (mode === "doubao") return String(config.doubao_model || "");
  if (mode === "personal") return String(config.personal_model || "");
  return String(config.codex_model || "");
}

const CACHE_BOX_ENABLED_KEY = "writer:cacheBoxEnabled";
const CACHE_BOX_EXPANDED_KEY = "writer:cacheBoxExpanded";
const STAGE_TIMELINE_ENABLED_KEY = "writer:stageTimelineEnabled";
const BACKGROUND_IMAGE_KEY = "writer:backgroundImage";
const CUSTOM_BACKGROUND_LIBRARY_KEY = "writer:customBackgroundLibrary";
const CUSTOM_BACKGROUND_ID_PREFIX = "custom-bg-";
const CUSTOM_BACKGROUND_MAX_COUNT = 24;
const FONT_PRESET_KEY = "writer:fontPreset";
const FONT_SIZE_KEY = "writer:fontSizePx";
const FONT_WEIGHT_KEY = "writer:fontWeightBold";
const TEXT_COLOR_CUSTOM_KEY = "writer:textColorCustom";
const TEXT_COLOR_KEY = "writer:textColorHex";
const CLONE_BACKGROUND_IMAGE = 'linear-gradient(180deg, rgba(5, 11, 20, 0.48), rgba(5, 11, 20, 0.36)), url("https://picsum.photos/seed/liquid-glass-react/2200/1400")';
const DOUBAO_DEFAULT_MODELS = [
  "doubao-seed-1-6-251015",
  "doubao-seed-1-6-lite-251015",
  "doubao-seed-1-6-flash-250828",
];

type FontPreset = "default" | "pingfang" | "yahei" | "source_han_sans" | "source_han_serif" | "wenkai";

const FONT_PRESETS: Record<FontPreset, { label: string; ui: string; serif: string }> = {
  default: {
    label: "系统默认",
    ui: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  },
  pingfang: {
    label: "苹方 / 鸿蒙",
    ui: '"PingFang SC", "Hiragino Sans GB", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
    serif: '"PingFang SC", "Hiragino Sans GB", "HarmonyOS Sans SC", serif',
  },
  yahei: {
    label: "微软雅黑",
    ui: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    serif: '"Microsoft YaHei", "PingFang SC", "Noto Serif SC", serif',
  },
  source_han_sans: {
    label: "思源黑体",
    ui: '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    serif: '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", serif',
  },
  source_han_serif: {
    label: "思源宋体",
    ui: '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif',
    serif: '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif',
  },
  wenkai: {
    label: "霞鹜文楷",
    ui: '"LXGW WenKai", "Kaiti SC", "KaiTi", "STKaiti", serif',
    serif: '"LXGW WenKai", "Kaiti SC", "KaiTi", "STKaiti", serif',
  },
};

const FONT_PRESET_OPTIONS = (Object.keys(FONT_PRESETS) as FontPreset[]).map((value) => ({
  value,
  label: FONT_PRESETS[value].label,
}));

interface OutlineFormState {
  overall_flow: string;
  selling_points: string;
  key_events: string;
  story_pace: string;
  worldview: string;
  protagonist_tags: string;
  motivation: string;
  relations: string;
  antagonist: string;
  foreshadowing: string;
  target_words: string;
  ending_pref: string;
}

interface SelfCheckRowView {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
  pending?: boolean;
}

function buildSelfCheckTemplate(config: AppConfig): Array<Pick<SelfCheckRowView, "id" | "label">> {
  const rows: Array<Pick<SelfCheckRowView, "id" | "label">> = [];
  const codexApi = config.codex_access_mode === "api";
  const geminiApi = config.gemini_access_mode === "api";
  const claudeApi = config.claude_access_mode === "api";

  rows.push(codexApi ? { id: "key_codex_api", label: "ChatGPT API Key" } : { id: "cli_codex", label: "ChatGPT CLI" });
  rows.push(geminiApi ? { id: "key_gemini_api", label: "Gemini API Key" } : { id: "cli_gemini", label: "Gemini CLI" });
  rows.push(claudeApi ? { id: "key_claude_api", label: "Claude API Key" } : { id: "cli_claude", label: "Claude CLI" });

  if (!codexApi || !geminiApi || !claudeApi) {
    rows.push({ id: "proxy_port", label: "代理端口" });
  }

  rows.push({ id: "key_doubao", label: "豆包 API Key" });
  rows.push({ id: "key_personal", label: "个人配置 API Key" });
  rows.push({ id: "url_personal", label: "个人配置 Base URL" });
  return rows;
}

type ModelListPrefix = "personal" | "doubao";

interface ModelContextMenuState {
  open: boolean;
  left: number;
  top: number;
  showPinTop: boolean;
}

interface InfoContextMenuState {
  open: boolean;
  left: number;
  top: number;
}

const OUTLINE_REQUIRED_FIELDS: Array<keyof OutlineFormState> = [
  "overall_flow",
  "worldview",
  "protagonist_tags",
  "target_words",
  "ending_pref",
];

const EMPTY_OUTLINE_FORM: OutlineFormState = {
  overall_flow: "",
  selling_points: "",
  key_events: "",
  story_pace: "",
  worldview: "",
  protagonist_tags: "",
  motivation: "",
  relations: "",
  antagonist: "",
  foreshadowing: "",
  target_words: "",
  ending_pref: "",
};

function readBoolSetting(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  return raw === "true";
}

function clampFontSize(value: number): number {
  const clamped = Math.max(13, Math.min(20, value));
  return Math.round(clamped * 10) / 10;
}

function formatFontSize(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}px` : `${rounded.toFixed(1)}px`;
}

function readFontPreset(): FontPreset {
  const raw = String(localStorage.getItem(FONT_PRESET_KEY) || "default").trim().toLowerCase();
  if (raw in FONT_PRESETS) return raw as FontPreset;
  return "default";
}

function readFontSize(): number {
  const raw = Number(localStorage.getItem(FONT_SIZE_KEY) || "15");
  if (!Number.isFinite(raw)) return 15;
  return clampFontSize(raw);
}

function readFontWeightBold(): boolean {
  const raw = String(localStorage.getItem(FONT_WEIGHT_KEY) || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric >= 550;
  return false;
}

function normalizeHexColor(raw: string): string | null {
  const value = String(raw || "").trim();
  const short = /^#([0-9a-fA-F]{3})$/;
  const full = /^#([0-9a-fA-F]{6})$/;
  const shortMatch = value.match(short);
  if (shortMatch) {
    const chunk = shortMatch[1];
    return `#${chunk[0]}${chunk[0]}${chunk[1]}${chunk[1]}${chunk[2]}${chunk[2]}`.toLowerCase();
  }
  if (full.test(value)) return value.toLowerCase();
  return null;
}

function readTextColor(): string {
  return normalizeHexColor(String(localStorage.getItem(TEXT_COLOR_KEY) || "")) || "#1d1d1f";
}

function readCustomBackgroundLibrary(): BackgroundItem[] {
  try {
    const raw = String(localStorage.getItem(CUSTOM_BACKGROUND_LIBRARY_KEY) || "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item?.id || "").trim(),
        name: String(item?.name || "").trim(),
        url: String(item?.url || "").trim(),
      }))
      .filter((item) => item.id.startsWith(CUSTOM_BACKGROUND_ID_PREFIX) && item.name && item.url)
      .slice(0, CUSTOM_BACKGROUND_MAX_COUNT);
  } catch {
    return [];
  }
}

function normalizeCustomBackgroundName(fileName: string): string {
  const decoded = decodeURIComponent(String(fileName || "").trim());
  const base = decoded.replace(/\.[^.]+$/, "").trim();
  return base || "自定义背景";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function deriveSecondaryTextColor(primaryHex: string): string {
  const normalized = normalizeHexColor(primaryHex) || "#1d1d1f";
  const hex = normalized.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.72)`;
}

function buildOutlineSeed(form: OutlineFormState): string {
  const lines: string[] = [];
  const push = (label: string, value: string, force = false) => {
    const text = String(value || "").trim();
    if (!text && !force) return;
    lines.push(`${label}：${text || "无"}`);
  };

  lines.push("请基于以下信息，生成可执行、可分章创作的长篇小说大纲。");
  lines.push("");
  lines.push("【小说框架】");
  push("总体流程", form.overall_flow, true);
  push("主要卖点", form.selling_points);
  push("关键事件", form.key_events);
  push("故事节奏", form.story_pace);
  lines.push("");
  lines.push("【主要世界观】");
  push("世界观描述", form.worldview, true);
  lines.push("");
  lines.push("【核心人物设定】");
  push("主角性格标签", form.protagonist_tags, true);
  push("角色动机与欲望", form.motivation);
  push("人物关系图谱", form.relations);
  push("反派的描绘", form.antagonist);
  push("重要伏笔", form.foreshadowing);
  lines.push("");
  lines.push("【输出控制参数】");
  push("预期字数", form.target_words, true);
  push("结局偏好", form.ending_pref, true);
  return lines.join("\n");
}

function normalizeModelList(value: string, fallback = ""): string[] {
  const rows = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/,/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const list: string[] = [];
  rows.forEach((x) => {
    const key = x.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(x);
  });
  if (!list.length && fallback.trim()) list.push(fallback.trim());
  return list;
}

function runtimeModels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return normalizeModelList(String(raw || ""));
}

function seedModelEditorRows(value: string, fallback: string): string[] {
  const rows = normalizeModelList(value, fallback);
  return rows.length ? rows : [fallback];
}

function resolveEditableTarget(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const el = target.closest("input, textarea");
  if (!el) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return null;
}

function canPasteToTarget(target: HTMLInputElement | HTMLTextAreaElement | null): boolean {
  if (!target) return false;
  return !target.readOnly && !target.disabled;
}

function getEditableSelectionText(target: HTMLInputElement | HTMLTextAreaElement | null): string {
  if (!target) return "";
  const start = Number.isFinite(target.selectionStart) ? Number(target.selectionStart) : 0;
  const end = Number.isFinite(target.selectionEnd) ? Number(target.selectionEnd) : 0;
  if (end <= start) return "";
  return target.value.slice(start, end);
}

async function copyText(text: string): Promise<boolean> {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function readClipboardText(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      return String(text || "");
    }
  } catch {
    // ignore
  }
  return "";
}

function formatInfoTime(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function clampMenuPosition(clientX: number, clientY: number, width: number, height: number): { left: number; top: number } {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, clientX), maxLeft),
    top: Math.min(Math.max(margin, clientY), maxTop),
  };
}

function App() {
  const configStore = useConfigStore();
  const draftStore = useDraftStore();
  const generation = useGenerationStore();
  const discarded = useDiscardedStore();
  const ui = useUiStore();

  const [chapterTitleOpen, setChapterTitleOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterTitleGenerating, setChapterTitleGenerating] = useState(false);
  const [chapterSaving, setChapterSaving] = useState(false);
  const [draftPolishing, setDraftPolishing] = useState(false);
  const [polishModalOpen, setPolishModalOpen] = useState(false);
  const [polishRequirements, setPolishRequirements] = useState("");

  const [consistencyOpen, setConsistencyOpen] = useState(false);
  const [consistencySummary, setConsistencySummary] = useState("");
  const [consistencyConflicts, setConsistencyConflicts] = useState<ConsistencyConflict[]>([]);

  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryAdded, setMemoryAdded] = useState<Array<{ key: string; summary: string }>>([]);
  const [memoryReplaced, setMemoryReplaced] = useState<Array<{ key: string; summary: string; oldSummary?: string }>>([]);
  const [memoryUnchanged, setMemoryUnchanged] = useState<Array<{ key: string; summary: string }>>([]);

  const [selfCheckOpen, setSelfCheckOpen] = useState(false);
  const [selfCheckSummary, setSelfCheckSummary] = useState("正在检测...");
  const [selfCheckRows, setSelfCheckRows] = useState<SelfCheckRowView[]>([]);
  const [selfCheckLoading, setSelfCheckLoading] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearanceSettingsOpen, setAppearanceSettingsOpen] = useState(false);
  const [assistSettingsOpen, setAssistSettingsOpen] = useState(false);
  const [accessSettingsOpen, setAccessSettingsOpen] = useState(false);
  const [doubaoSettingsOpen, setDoubaoSettingsOpen] = useState(false);
  const [personalConfigOpen, setPersonalConfigOpen] = useState(false);
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [settingsEditorPath, setSettingsEditorPath] = useState("");
  const [settingsEditorContent, setSettingsEditorContent] = useState("");
  const [authEditorOpen, setAuthEditorOpen] = useState(false);
  const [authEditorPath, setAuthEditorPath] = useState("");
  const [authEditorContent, setAuthEditorContent] = useState("");

  const [bookshelfOpen, setBookshelfOpen] = useState(false);
  const [bookshelfLoading, setBookshelfLoading] = useState(false);
  const [bookshelf, setBookshelf] = useState<BookshelfPayload>({ books: [] });
  const [newBookTitle, setNewBookTitle] = useState("");

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [chapterPreviewOpen, setChapterPreviewOpen] = useState(false);
  const [chapterPreviewLoading, setChapterPreviewLoading] = useState(false);
  const [chapterPreviewItem, setChapterPreviewItem] = useState<{
    id: number;
    title: string;
    content: string;
    charCount: number;
    createdAt: string;
  } | null>(null);

  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineGenerating, setOutlineGenerating] = useState(false);
  const [outlinePaused, setOutlinePaused] = useState(false);
  const [outlineForm, setOutlineForm] = useState<OutlineFormState>(EMPTY_OUTLINE_FORM);
  const outlineAbortRef = useRef<AbortController | null>(null);

  const [modelHealthOpen, setModelHealthOpen] = useState(false);
  const [modelHealthRows, setModelHealthRows] = useState<ModelHealthRow[]>([]);
  const [infoBoxOpen, setInfoBoxOpen] = useState(false);
  const [connectivityTesting, setConnectivityTesting] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<StartupStatus | null>(null);
  const [engineSwitching, setEngineSwitching] = useState(false);
  const engineSwitchReleaseRef = useRef<number | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const raw = String(localStorage.getItem("theme") || "auto").trim().toLowerCase();
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
    return "auto";
  });
  const [fontPreset, setFontPreset] = useState<FontPreset>(() => readFontPreset());
  const [fontSizePx, setFontSizePx] = useState<number>(() => readFontSize());
  const [fontWeightBold, setFontWeightBold] = useState<boolean>(() => readFontWeightBold());
  const [typewriterRangeSliding, setTypewriterRangeSliding] = useState(false);
  const [fontSizeRangeSliding, setFontSizeRangeSliding] = useState(false);
  const [customTextColorEnabled, setCustomTextColorEnabled] = useState<boolean>(() => readBoolSetting(TEXT_COLOR_CUSTOM_KEY, false));
  const [customTextColor, setCustomTextColor] = useState<string>(() => readTextColor());
  const [appearanceFontOpen, setAppearanceFontOpen] = useState(false);
  const [appearanceBackgroundOpen, setAppearanceBackgroundOpen] = useState(false);
  const [customBackgrounds, setCustomBackgrounds] = useState<BackgroundItem[]>(() => readCustomBackgroundLibrary());
  const [activeBackgroundId, setActiveBackgroundId] = useState<string>(() => {
    const fallback = DEFAULT_BACKGROUND_ID;
    const raw = String(localStorage.getItem(BACKGROUND_IMAGE_KEY) || "").trim();
    if (!raw) return fallback;
    return (BACKGROUND_LIBRARY.some((item) => item.id === raw) || readCustomBackgroundLibrary().some((item) => item.id === raw)) ? raw : fallback;
  });
  const backgroundFileInputRef = useRef<HTMLInputElement | null>(null);

  const [cacheEnabled, setCacheEnabled] = useState(() => readBoolSetting(CACHE_BOX_ENABLED_KEY, true));
  const [cacheExpanded, setCacheExpanded] = useState(() => readBoolSetting(CACHE_BOX_EXPANDED_KEY, true));
  const [stageTimelineEnabled, setStageTimelineEnabled] = useState(() => readBoolSetting(STAGE_TIMELINE_ENABLED_KEY, true));

  const [tick, setTick] = useState(Date.now());
  const [doubaoModelEditorRows, setDoubaoModelEditorRows] = useState<string[]>(["doubao-seed-1-6-251015"]);

  const debugUiAction = (tag: string, extra?: Record<string, unknown>): void => {
    const g = useGenerationStore.getState();
    const payload = {
      stage: g.stage,
      isWriting: g.isWriting,
      isPaused: g.isPaused,
      taskId: g.taskId || "",
      skipVisible: g.skipVisible,
      ...(extra || {}),
    };
    const message = `[debug][ui:${tag}] ${JSON.stringify(payload)}`;
    console.debug(message);
    ui.addInfo(message);
  };
  const [personalModelEditorRows, setPersonalModelEditorRows] = useState<string[]>(["deepseek-ai/deepseek-v3.2"]);
  const [modelContextMenu, setModelContextMenu] = useState<ModelContextMenuState>({ open: false, left: 0, top: 0, showPinTop: false });
  const [modelMenuCanCopy, setModelMenuCanCopy] = useState(false);
  const [modelMenuCanPaste, setModelMenuCanPaste] = useState(false);
  const [modelMenuCanCut, setModelMenuCanCut] = useState(false);
  const [infoContextMenu, setInfoContextMenu] = useState<InfoContextMenuState>({ open: false, left: 0, top: 0 });
  const modelContextTargetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const modelContextRowRef = useRef<{ prefix: ModelListPrefix; index: number } | null>(null);
  const infoContextItemIdRef = useRef<number | null>(null);

  const typewriterSpeedValue = Math.max(10, Math.min(80, generation.typewriterSpeed));
  const typewriterRangeProgress = ((typewriterSpeedValue - 10) / (80 - 10)) * 100;
  const fontSizeRangeProgress = ((fontSizePx - 13) / (20 - 13)) * 100;
  const typewriterRangeStyle = { "--range-progress": `${Math.max(0, Math.min(100, typewriterRangeProgress))}%` } as CSSProperties;
  const fontSizeRangeStyle = { "--range-progress": `${Math.max(0, Math.min(100, fontSizeRangeProgress))}%` } as CSSProperties;
  const backgroundLibrary = useMemo(() => {
    const seen = new Set<string>();
    const rows: BackgroundItem[] = [];
    [...customBackgrounds, ...BACKGROUND_LIBRARY].forEach((item) => {
      const id = String(item?.id || "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      rows.push(item);
    });
    return rows;
  }, [customBackgrounds]);

  const refreshRuntimeStatus = async (silent = false): Promise<void> => {
    try {
      const status = await getStatus();
      setRuntimeStatus(status);
      setModelHealthRows(Array.isArray(status.model_health) ? status.model_health : []);
      const mode = String(status.engine_mode || configStore.config.engine_mode || "codex");
      if (!silent) {
        if (mode === "gemini") {
          if (status.gemini_access_mode === "api") {
            if (status.gemini_api_ready === false) {
              ui.addToast("Gemini API 模式未配置密钥，请填写 API Key 或设置 GEMINI_API_KEY", "error");
            }
          } else if (status.gemini_available === false) {
            ui.addToast("未检测到 gemini 可执行文件，请确保已安装并在 PATH 中", "error");
          }
        } else if (mode === "claude") {
          if (status.claude_access_mode === "api") {
            if (status.claude_api_ready === false) {
              ui.addToast("Claude API 模式未配置密钥，请填写 API Key 或设置 ANTHROPIC_API_KEY", "error");
            }
          } else if (status.claude_available === false) {
            ui.addToast("未检测到 claude 可执行文件，请确保已安装并在 PATH 中", "error");
          }
        } else if (mode === "doubao") {
          if (status.doubao_ready === false) {
            ui.addToast("豆包未配置密钥，请设置 DOUBAO_API_KEY 或 ARK_API_KEY", "error");
          }
        } else if (mode === "personal") {
          if (status.personal_ready === false) {
            ui.addToast("个人配置未完成，请填写 base url 与 api key", "error");
          }
        } else if (status.codex_access_mode === "api") {
          if (status.codex_api_ready === false) {
            ui.addToast("ChatGPT API 模式未配置密钥，请填写 API Key 或设置 OPENAI_API_KEY", "error");
          }
        }
      }
      const runtimeErr = String(status.runtime_last_error || "").trim();
      if (!silent && runtimeErr) {
        ui.addToast(`运行态异常: ${runtimeErr}`, "warning");
      }
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : "状态读取失败";
        ui.addToast(`状态读取失败: ${message}`, "error");
      }
    }
  };

  const reloadBookshelf = async (): Promise<void> => {
    setBookshelfLoading(true);
    try {
      const payload = await getBooks();
      setBookshelf({
        books: Array.isArray(payload.books) ? payload.books : [],
        active_book: payload.active_book,
        active_book_id: payload.active_book_id,
        active_paths: payload.active_paths,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载书架失败";
      ui.addToast(`加载书架失败: ${message}`, "error");
    } finally {
      setBookshelfLoading(false);
    }
  };

  const reloadChapters = async (): Promise<void> => {
    setChaptersLoading(true);
    try {
      const items = await listChapters();
      setChapters(Array.isArray(items) ? items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载章节失败";
      ui.addToast(`加载章节失败: ${message}`, "error");
    } finally {
      setChaptersLoading(false);
    }
  };

  const refreshAll = async (): Promise<void> => {
    await Promise.all([configStore.load(), draftStore.load(), discarded.load()]);
    await refreshRuntimeStatus(true);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.all([configStore.load(), draftStore.load()]);
      await refreshRuntimeStatus(true);
      if (!active) return;
      try {
        await prewarmEngine();
      } catch {
        // ignore prewarm failure
      }
      await generation.detectRecovery();
      if (configStore.config.first_run_required) {
        setBookshelfOpen(true);
        await reloadBookshelf();
      }
    })();

    const timer = window.setInterval(() => setTick(Date.now()), 300);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (discarded.visible) {
      void discarded.load();
    }
  }, [discarded.visible]);

  useEffect(() => {
    ui.setTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    const preset = FONT_PRESETS[fontPreset] || FONT_PRESETS.default;
    const root = document.documentElement;
    root.style.setProperty("--font-ui", preset.ui);
    root.style.setProperty("--font-serif", preset.serif);
    root.style.setProperty("--user-font-scale", String(fontSizePx / 15));
    root.style.setProperty("--user-font-weight", fontWeightBold ? "600" : "400");
    localStorage.setItem(FONT_PRESET_KEY, fontPreset);
    localStorage.setItem(FONT_SIZE_KEY, String(fontSizePx));
    localStorage.setItem(FONT_WEIGHT_KEY, String(fontWeightBold));
  }, [fontPreset, fontSizePx, fontWeightBold]);

  useEffect(() => {
    const root = document.documentElement;
    localStorage.setItem(TEXT_COLOR_CUSTOM_KEY, String(customTextColorEnabled));
    localStorage.setItem(TEXT_COLOR_KEY, customTextColor);
    if (!customTextColorEnabled) {
      root.style.removeProperty("--text-primary");
      root.style.removeProperty("--text-secondary");
      return;
    }
    root.style.setProperty("--text-primary", customTextColor);
    root.style.setProperty("--text-secondary", deriveSecondaryTextColor(customTextColor));
  }, [customTextColorEnabled, customTextColor]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => ui.syncTheme();
    media.addEventListener("change", onMedia);
    return () => media.removeEventListener("change", onMedia);
  }, [ui.theme]);

  useEffect(() => {
    const root = document.documentElement;
    let hideTimer: number | null = null;
    let frameToken: number | null = null;
    const isSettingsScrollTarget = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest(".settings-modal-scroll"));
    const markScrolling = () => {
      if (frameToken != null) return;
      frameToken = window.requestAnimationFrame(() => {
        frameToken = null;
        root.classList.add("ui-scrolling");
        if (hideTimer != null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          root.classList.remove("ui-scrolling");
        }, 380);
      });
    };
    const onWheel = (event: WheelEvent) => {
      if (isSettingsScrollTarget(event.target)) return;
      markScrolling();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (isSettingsScrollTarget(event.target)) return;
      markScrolling();
    };
    const onScrollCapture = (event: Event) => {
      if (isSettingsScrollTarget(event.target)) return;
      markScrolling();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("scroll", onScrollCapture, true);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("scroll", onScrollCapture, true);
      if (frameToken != null) window.cancelAnimationFrame(frameToken);
      if (hideTimer != null) window.clearTimeout(hideTimer);
      root.classList.remove("ui-scrolling");
    };
  }, []);

  useEffect(() => {
    const timers = new Map<HTMLElement, number>();
    const resolveContainer = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const node = target.closest(".settings-modal-scroll");
      return node instanceof HTMLElement ? node : null;
    };
    const markSettingsScrolling = (container: HTMLElement): void => {
      container.classList.add("is-scrolling");
      const prev = timers.get(container);
      if (prev != null) window.clearTimeout(prev);
      const timer = window.setTimeout(() => {
        container.classList.remove("is-scrolling");
        timers.delete(container);
      }, 420);
      timers.set(container, timer);
    };
    const onSettingsScrollCapture = (event: Event): void => {
      const container = resolveContainer(event.target);
      if (!container) return;
      markSettingsScrolling(container);
    };
    document.addEventListener("scroll", onSettingsScrollCapture, true);
    return () => {
      document.removeEventListener("scroll", onSettingsScrollCapture, true);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      document.querySelectorAll(".settings-modal-scroll.is-scrolling").forEach((node) => {
        if (node instanceof HTMLElement) node.classList.remove("is-scrolling");
      });
    };
  }, []);

  useEffect(() => {
    const clearSliderState = () => {
      setTypewriterRangeSliding(false);
      setFontSizeRangeSliding(false);
    };
    window.addEventListener("pointerup", clearSliderState, true);
    window.addEventListener("pointercancel", clearSliderState, true);
    window.addEventListener("blur", clearSliderState);
    return () => {
      window.removeEventListener("pointerup", clearSliderState, true);
      window.removeEventListener("pointercancel", clearSliderState, true);
      window.removeEventListener("blur", clearSliderState);
    };
  }, []);

  useEffect(() => {
    if (!generation.autoScroll) return;
    const el = document.getElementById("generated-content");
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [generation.generatedText, generation.autoScroll]);

  useEffect(() => {
    localStorage.setItem(CACHE_BOX_ENABLED_KEY, String(cacheEnabled));
    if (!cacheEnabled) {
      setCacheExpanded(false);
    }
  }, [cacheEnabled]);

  useEffect(() => {
    localStorage.setItem(CACHE_BOX_EXPANDED_KEY, String(cacheExpanded));
  }, [cacheExpanded]);

  useEffect(() => {
    localStorage.setItem(STAGE_TIMELINE_ENABLED_KEY, String(stageTimelineEnabled));
  }, [stageTimelineEnabled]);

  useEffect(() => () => {
    if (engineSwitchReleaseRef.current != null) {
      window.clearTimeout(engineSwitchReleaseRef.current);
      engineSwitchReleaseRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (configStore.config.first_run_required) {
      setBookshelfOpen(true);
      void reloadBookshelf();
    }
  }, [configStore.config.first_run_required]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_BACKGROUND_LIBRARY_KEY, JSON.stringify(customBackgrounds));
    } catch {
      // localStorage 可能超限；保持内存态可用。
    }
  }, [customBackgrounds]);

  useEffect(() => {
    if (!backgroundLibrary.length) return;
    if (activeBackgroundId && backgroundLibrary.some((item) => item.id === activeBackgroundId)) return;
    setActiveBackgroundId(backgroundLibrary[0]?.id || "");
  }, [activeBackgroundId, backgroundLibrary]);

  useEffect(() => {
    if (!activeBackgroundId) {
      localStorage.removeItem(BACKGROUND_IMAGE_KEY);
      return;
    }
    localStorage.setItem(BACKGROUND_IMAGE_KEY, activeBackgroundId);
  }, [activeBackgroundId]);

  useEffect(() => {
    if (!outlineOpen) return;
    window.setTimeout(() => {
      const first = document.getElementById("outline-overall-flow") as HTMLTextAreaElement | null;
      first?.focus();
    }, 0);
  }, [outlineOpen]);

  useEffect(() => {
    if (!infoBoxOpen) {
      closeInfoContextMenu();
    }
  }, [infoBoxOpen]);

  useEffect(() => {
    if (!personalConfigOpen && !doubaoSettingsOpen) {
      closeModelContextMenu();
    }
  }, [personalConfigOpen, doubaoSettingsOpen]);

  useEffect(() => {
    const onDocContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("#engine-picker-menu")) return;
      if (target.closest("#info-box-modal")) return;
      const row = target.closest(".personal-model-row, .doubao-model-row") as HTMLElement | null;
      const editable = resolveEditableTarget(target);
      if (!row && !editable) return;
      event.preventDefault();
      let rowContext: { prefix: ModelListPrefix; index: number } | null = null;
      if (row) {
        const rawIndex = Number.parseInt(String(row.getAttribute("data-model-index") || ""), 10);
        const prefix = row.classList.contains("doubao-model-row") ? "doubao" : "personal";
        rowContext = {
          prefix,
          index: Number.isFinite(rawIndex) ? rawIndex : 0,
        };
      }
      openModelContextMenuAt(event.clientX, event.clientY, editable, rowContext);
    };

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const inModelMenu = Boolean(target?.closest?.("#personal-model-context-menu"));
      const inInfoMenu = Boolean(target?.closest?.("#info-box-context-menu"));
      if (!inModelMenu) closeModelContextMenu();
      if (!inInfoMenu) closeInfoContextMenu();
    };

    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeModelContextMenu();
      closeInfoContextMenu();
    };

    const onResize = () => {
      closeModelContextMenu();
      closeInfoContextMenu();
    };

    const onSelection = () => {
      if (!modelContextMenu.open) return;
      updateModelContextMenuActionState();
    };

    document.addEventListener("contextmenu", onDocContextMenu);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("contextmenu", onDocContextMenu);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("resize", onResize);
    };
  }, [modelContextMenu.open]);

  const stageDurations = useMemo(() => {
    const next = { ...generation.stageDurations };
    if (
      (generation.stage === "queued" || generation.stage === "generating" || generation.stage === "finishing") &&
      generation.stageSince > 0
    ) {
      next[generation.stage] += tick - generation.stageSince;
    }
    return next;
  }, [generation.stageDurations, generation.stage, generation.stageSince, tick]);

  const personalModalModelRows = useMemo(
    () => normalizeModelList(personalModelEditorRows.join("\n"), "deepseek-ai/deepseek-v3.2"),
    [personalModelEditorRows],
  );
  const doubaoModalModelRows = useMemo(
    () => normalizeModelList(doubaoModelEditorRows.join("\n"), "doubao-seed-1-6-251015"),
    [doubaoModelEditorRows],
  );
  const hasPersonalModel = useMemo(() => {
    const list = normalizeModelList(
      configStore.config.personal_models || configStore.config.personal_model || "",
      "deepseek-ai/deepseek-v3.2",
    );
    return list.length > 0;
  }, [configStore.config.personal_models, configStore.config.personal_model]);
  const personalSaveDisabled = useMemo(() => {
    const hasModel = personalModalModelRows.some((item) => String(item || "").trim());
    return !(
      hasModel
      && String(configStore.config.personal_base_url || "").trim()
      && String(configStore.config.personal_api_key || "").trim()
    );
  }, [personalModalModelRows, configStore.config.personal_base_url, configStore.config.personal_api_key]);
  const doubaoSaveDisabled = useMemo(
    () => !doubaoModalModelRows.some((item) => String(item || "").trim()),
    [doubaoModalModelRows],
  );
  const outlineFormValid = useMemo(
    () => OUTLINE_REQUIRED_FIELDS.every((key) => Boolean(String(outlineForm[key] || "").trim())),
    [outlineForm],
  );

  const toolbarStatusOverride = useMemo<"" | "就绪" | "异常" | "成功">(() => {
    if (generation.stage === "error") return "异常";
    if (generation.stage === "completed") return "就绪";
    if ((generation.stage === "generating" || generation.stage === "finishing") && generation.generatedText.trim()) return "成功";
    return "";
  }, [generation.stage, generation.generatedText]);

  const personalConfigReady = useMemo(() => {
    return Boolean(
      String(configStore.config.personal_base_url || "").trim()
      && String(configStore.config.personal_api_key || "").trim()
      && hasPersonalModel,
    );
  }, [configStore.config.personal_base_url, configStore.config.personal_api_key, hasPersonalModel]);

  const handleStartStop = (): void => {
    debugUiAction("start-stop:click");
    if (useGenerationStore.getState().isWriting) {
      debugUiAction("start-stop:route-stop");
      void generation.stop();
      return;
    }

    const hasCache = Boolean(String(useConfigStore.getState().config.cache || "").trim());
    generation.setReferenceStatus(hasCache ? "已加载提要" : "首次创作");

    const recovery = useGenerationStore.getState().recoveryInfo;
    if (recovery?.recoverable) {
      debugUiAction("start-stop:route-recovery");
      void (async () => {
        try {
          const resumed = await generation.resumeRecovery();
          if (resumed) {
            debugUiAction("start-stop:recovery-ok");
            useGenerationStore.setState({ recoveryInfo: null });
            return;
          }
        } catch {
          // ignore and fallback to normal start
        }
        useGenerationStore.setState({ recoveryInfo: null });
        debugUiAction("start-stop:recovery-fallback-start");
        await generation.start(useConfigStore.getState().config);
      })();
      return;
    }

    debugUiAction("start-stop:route-start");
    void generation.start(useConfigStore.getState().config);
    void (async () => {
      try {
        const chapters = await listChapters();
        const chapterCount = Array.isArray(chapters) ? chapters.length : 0;
        const freshHasCache = Boolean(String(useConfigStore.getState().config.cache || "").trim());
        generation.setReferenceStatus(chapterCount > 0 || freshHasCache ? "已加载提要" : "首次创作");
      } catch {
        // ignore chapter check failure; keep optimistic front-end response
      }
    })();
  };

  const handlePauseResume = (): void => {
    debugUiAction("pause-resume:click");
    void generation.togglePause();
  };

  const handleSkipAnimation = (): void => {
    debugUiAction("skip:click");
    generation.skipTypewriter();
  };

  const handleSaveConfig = async (opts?: { silent?: boolean }): Promise<void> => {
    await configStore.save({ silent: Boolean(opts?.silent) });
    try {
      await saveProxyPort(configStore.config.proxy_port || "10808");
    } catch {
      // ignore proxy sync failure here
    }
    await refreshRuntimeStatus(true);
  };

  const runDoubaoSaveApply = async (opts?: {
    preferredModel?: string;
    rowsText?: string;
    source?: string;
    silent?: boolean;
  }): Promise<void> => {
    const current = useConfigStore.getState().config;
    const normalized = normalizeModelList(
      String(opts?.rowsText || current.doubao_models || ""),
      "doubao-seed-1-6-251015",
    );
    if (!normalized.length) return;
    const requested = String(opts?.preferredModel || current.doubao_model || "").trim();
    const selected = requested && normalized.includes(requested) ? requested : (normalized[0] || "");
    updateDoubaoModels(normalized, selected);
    setDoubaoModelEditorRows(normalized);
    if (opts?.silent) {
      await configStore.saveQuietly();
      try {
        await saveProxyPort(useConfigStore.getState().config.proxy_port || "10808");
      } catch {
        // ignore proxy sync failure here
      }
      await refreshRuntimeStatus(true);
      return;
    }
    await handleSaveConfig({ silent: false });
  };

  const switchEngineMode = async (mode: AppConfig["engine_mode"]): Promise<void> => {
    if (engineSwitching) return;
    if (generation.isWriting) {
      ui.addToast("写作进行中，停止后才能切换模型", "warning");
      return;
    }

    if (configStore.loading) {
      await configStore.load();
    }

    setEngineSwitching(true);
    if (engineSwitchReleaseRef.current != null) {
      window.clearTimeout(engineSwitchReleaseRef.current);
      engineSwitchReleaseRef.current = null;
    }
    try {
      const currentCfg = useConfigStore.getState().config;
      let patch: Partial<AppConfig> = { engine_mode: mode };
      if (mode === "doubao") {
        const runtimeDoubao = runtimeModels((runtimeStatus as Record<string, unknown> | null)?.doubao_models);
        let merged = normalizeModelList(
          [
            String(currentCfg.doubao_models || ""),
            runtimeDoubao.join("\n"),
            String(currentCfg.doubao_model || ""),
          ]
            .filter(Boolean)
            .join("\n"),
          DOUBAO_DEFAULT_MODELS[0],
        );
        if (merged.length <= 1) {
          merged = normalizeModelList(
            [merged.join("\n"), DOUBAO_DEFAULT_MODELS.join("\n")].join("\n"),
            DOUBAO_DEFAULT_MODELS[0],
          );
        }
        const current = String(currentCfg.doubao_model || "").trim();
        patch = {
          ...patch,
          doubao_models: merged.join("\n"),
          doubao_model: (current && merged.includes(current)) ? current : (merged[0] || DOUBAO_DEFAULT_MODELS[0]),
        };
      } else if (mode === "personal") {
        const runtimePersonal = runtimeModels((runtimeStatus as Record<string, unknown> | null)?.personal_models);
        const merged = normalizeModelList(
          String(currentCfg.personal_models || runtimePersonal.join("\n") || currentCfg.personal_model || ""),
          "deepseek-ai/deepseek-v3.2",
        );
        const current = String(currentCfg.personal_model || "").trim();
        patch = {
          ...patch,
          personal_models: merged.join("\n"),
          personal_model: (current && merged.includes(current)) ? current : (merged[0] || "deepseek-ai/deepseek-v3.2"),
        };
      }

      const nextConfig: AppConfig = {
        ...currentCfg,
        ...patch,
      };
      configStore.patch(patch);
      setRuntimeStatus((prev) => {
        const base = (prev || {}) as StartupStatus;
        return {
          ...base,
          engine_mode: mode,
          runtime_last_engine: mode,
          runtime_last_model: modelForMode(nextConfig, mode),
        };
      });

      if (mode === "doubao") {
        await runDoubaoSaveApply({
          preferredModel: String(nextConfig.doubao_model || ""),
          rowsText: String(nextConfig.doubao_models || ""),
          source: "switch_engine_mode",
          silent: true,
        });
      } else {
        await handleSaveConfig({ silent: true });
      }
      ui.addToast(`已切换模型：${modeLabel(mode)}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      ui.addToast(`切换模型失败: ${message}`, "error");
      await refreshRuntimeStatus(true);
    } finally {
      engineSwitchReleaseRef.current = window.setTimeout(() => {
        setEngineSwitching(false);
        engineSwitchReleaseRef.current = null;
      }, 180);
    }
  };

  const handleImportFile = async (target: "outline" | "reference", file: File): Promise<void> => {
    try {
      const payload = await uploadTxt(target, file);
      if (target === "outline") {
        configStore.patch({ outline: payload.content });
      } else {
        configStore.patch({ reference: payload.content });
      }
      ui.addToast("文件导入成功", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件导入失败";
      ui.addToast(`文件导入失败: ${message}`, "error");
    }
  };

  const updatePersonalModels = (rows: string[], preferred = ""): void => {
    const normalized = normalizeModelList(rows.join("\n"), "deepseek-ai/deepseek-v3.2");
    const current = String(preferred || "").trim();
    const selected = (current && normalized.includes(current)) ? current : (normalized[0] || "");
    useConfigStore.getState().patch({
      personal_models: normalized.join("\n"),
      personal_model: selected,
    });
  };

  const updateDoubaoModels = (rows: string[], preferred = ""): void => {
    const normalized = normalizeModelList(rows.join("\n"), "doubao-seed-1-6-251015");
    const current = String(preferred || "").trim();
    const selected = (current && normalized.includes(current)) ? current : (normalized[0] || "");
    useConfigStore.getState().patch({
      doubao_models: normalized.join("\n"),
      doubao_model: selected,
    });
  };

  const applySelectedDoubaoModel = (value: string): void => {
    const selected = String(value || "").trim();
    if (!selected) return;
    const previous = String(useConfigStore.getState().config.doubao_model || "").trim();
    if (selected === previous) return;
    const current = useConfigStore.getState().config;
    const merged = normalizeModelList(
      [String(current.doubao_models || ""), selected].filter(Boolean).join("\n"),
      selected,
    );
    useConfigStore.getState().patch({
      doubao_models: merged.join("\n"),
      doubao_model: selected,
    });
    setRuntimeStatus((prev) => {
      const base = (prev || {}) as StartupStatus;
      return {
        ...base,
        doubao_model: selected,
        runtime_last_engine: "doubao",
        runtime_last_model: selected,
      };
    });
    void runDoubaoSaveApply({
      preferredModel: selected,
      rowsText: merged.join("\n"),
      source: "sidebar_doubao_model_select",
      silent: true,
    });
  };

  const applySelectedPersonalModel = (value: string): void => {
    const selected = String(value || "").trim();
    if (!selected) return;
    const previous = String(useConfigStore.getState().config.personal_model || "").trim();
    if (selected === previous) return;
    const current = useConfigStore.getState().config;
    const merged = normalizeModelList(
      [String(current.personal_models || ""), selected].filter(Boolean).join("\n"),
      selected,
    );
    useConfigStore.getState().patch({
      personal_models: merged.join("\n"),
      personal_model: selected,
    });
    setRuntimeStatus((prev) => {
      const base = (prev || {}) as StartupStatus;
      return {
        ...base,
        personal_model: selected,
        runtime_last_engine: "personal",
        runtime_last_model: selected,
      };
    });
    void handleSaveConfig({ silent: true });
  };

  const handleSidebarPatch = (patch: Partial<AppConfig>): void => {
    const nextPatch = { ...patch };
    if (typeof nextPatch.doubao_model === "string") {
      nextPatch.doubao_model = String(nextPatch.doubao_model || "").trim();
    }
    if (typeof nextPatch.personal_model === "string") {
      nextPatch.personal_model = String(nextPatch.personal_model || "").trim();
    }
    configStore.patch(nextPatch);
  };

  const closeBookshelfModal = (): void => {
    if (configStore.config.first_run_required) return;
    setBookshelfOpen(false);
  };

  const bookshelfTip = useMemo(() => {
    const rootDir = String(bookshelf.active_paths?.root_dir || "").trim();
    if (rootDir) {
      return `当前书籍目录：${rootDir}。本书的大纲、参考、缓存、章节、草稿都会单独保存在这里。`;
    }
    return "每本书会在独立文件夹中保存：大纲、参考、缓存、章节、草稿都会单独隔离。";
  }, [bookshelf.active_paths]);

  const createBookQuick = async (): Promise<void> => {
    setBookshelfOpen(true);
    await reloadBookshelf();
    window.setTimeout(() => {
      const input = document.getElementById("new-book-title-input") as HTMLInputElement | null;
      if (!input) return;
      input.focus();
      input.select();
    }, 0);
  };

  const handleAccept = async (): Promise<void> => {
    await draftStore.acceptGenerated(generation.generatedText);
    generation.clearGenerated();
  };

  const handleRewrite = async (): Promise<void> => {
    const added = await draftStore.deleteGenerated(generation.generatedText);
    generation.clearGenerated();
    if (added) {
      await discarded.load();
    }
    await generation.start(configStore.config);
  };

  const handleSplitChapter = async (): Promise<void> => {
    if (chapterSaving || chapterTitleGenerating) {
      return;
    }
    const content = draftStore.content;
    if (!content || content.trim().length < 10) {
      ui.addToast("草稿内容太少，无法分章", "error");
      return;
    }
    setChapterTitleGenerating(true);
    try {
      const payload = await generateChapterTitle(content);
      setChapterTitle(payload.title || "新章节");
      setChapterTitleOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成标题失败";
      ui.addToast(`生成标题失败: ${message}`, "error");
    } finally {
      setChapterTitleGenerating(false);
    }
  };

  const handlePolishDraft = async (): Promise<void> => {
    if (draftPolishing || chapterSaving || chapterTitleGenerating) {
      return;
    }
    const content = String(draftStore.content || "").trim();
    if (!content) {
      ui.addToast("草稿为空，无法润色", "warning");
      return;
    }
    setPolishRequirements((prev) => prev || "在不改变核心剧情事实的前提下，优化文笔、节奏和段落层次。");
    setPolishModalOpen(true);
  };

  const submitPolishDraft = async (): Promise<void> => {
    if (draftPolishing) return;
    const content = String(draftStore.content || "").trim();
    if (!content) {
      ui.addToast("草稿为空，无法润色", "warning");
      return;
    }
    const requirementsText = String(polishRequirements || "").trim();
    setDraftPolishing(true);
    try {
      const payload = await polishDraft({
        ...useConfigStore.getState().config,
        content,
        polish_requirements: requirementsText,
      });
      const polished = String(payload.content || "").trim();
      if (!polished) {
        throw new Error("润色结果为空");
      }
      draftStore.setContent(polished);
      await draftStore.saveNow();
      setPolishModalOpen(false);
      ui.addToast("润色完成", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "润色失败";
      ui.addToast(`润色失败: ${message}`, "error");
    } finally {
      setDraftPolishing(false);
    }
  };

  const handleConfirmChapterSave = async (): Promise<void> => {
    if (!chapterTitle.trim()) {
      ui.addToast("标题不能为空", "error");
      return;
    }
    setChapterTitleOpen(false);
    setChapterSaving(true);
    try {
      const oldMemory = configStore.config.global_memory;
      const result = await saveChapter(draftStore.content, chapterTitle.trim());
      const nextMemory = String(result.global_memory || "");

      if (nextMemory) {
        configStore.patch({ global_memory: nextMemory });
      }

      if (result.memory_updated && nextMemory) {
        const diff = diffMemory(oldMemory, nextMemory);
        setMemoryAdded(diff.added.map((x) => ({ key: x.key, summary: x.summary })));
        setMemoryReplaced(diff.replaced.map((x) => ({ key: x.key, summary: x.summary, oldSummary: x.oldSummary })));
        setMemoryUnchanged(diff.unchanged.map((x) => ({ key: x.key, summary: x.summary })));
        setMemoryOpen(true);
        ui.addToast(`分章保存成功，记忆更新 ${diff.added.length + diff.replaced.length} 条`, "success");
      } else {
        ui.addToast("分章保存成功", "success");
      }

      if (result.consistency_checked) {
        const conflicts = Array.isArray(result.consistency_conflicts) ? result.consistency_conflicts : [];
        if (result.consistency_has_conflicts && conflicts.length > 0) {
          setConsistencySummary(result.consistency_summary || "检测到连贯性冲突");
          setConsistencyConflicts(conflicts);
          setConsistencyOpen(true);
          ui.addToast(`检测到 ${conflicts.length} 处连贯性冲突`, "warning");
        }
      }

      draftStore.setContent("");
      await draftStore.saveNow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存章节失败";
      ui.addToast(`保存章节失败: ${message}`, "error");
    } finally {
      setChapterSaving(false);
    }
  };

  const handleTestConnectivity = async (): Promise<void> => {
    setConnectivityTesting(true);
    try {
      const result = await testConnectivity(configStore.config);
      ui.addToast(result.ok ? "连通性检查通过" : (result.message || "连通性检查失败"), result.ok ? "success" : "warning");
    } catch (error) {
      const message = error instanceof Error ? error.message : "连通性检查失败";
      ui.addToast(`连通性检查失败: ${message}`, "error");
    } finally {
      setConnectivityTesting(false);
    }
  };

  const saveSettingsModal = async (): Promise<void> => {
    await handleSaveConfig();
    setSettingsOpen(false);
  };

  const openAppearanceSettingsModal = (): void => {
    setAppearanceFontOpen(false);
    setAppearanceBackgroundOpen(false);
    setAppearanceSettingsOpen(true);
  };

  const closeAppearanceSettingsModal = (): void => {
    setAppearanceFontOpen(false);
    setAppearanceBackgroundOpen(false);
    setAppearanceSettingsOpen(false);
  };

  const applyBackgroundImage = (id: string): void => {
    if (!backgroundLibrary.some((item) => item.id === id)) return;
    setActiveBackgroundId(id);
    ui.addToast("背景已应用", "success");
  };

  const openBackgroundFilePicker = (): void => {
    backgroundFileInputRef.current?.click();
  };

  const handleBackgroundFilePick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!String(file.type || "").toLowerCase().startsWith("image/")) {
      ui.addToast("请选择图片文件", "warning");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const name = normalizeCustomBackgroundName(file.name);
      const id = `${CUSTOM_BACKGROUND_ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const nextItem: BackgroundItem = { id, name, url: dataUrl };
      const next = [nextItem, ...customBackgrounds.filter((item) => item.url !== dataUrl)].slice(0, CUSTOM_BACKGROUND_MAX_COUNT);
      try {
        localStorage.setItem(CUSTOM_BACKGROUND_LIBRARY_KEY, JSON.stringify(next));
      } catch {
        ui.addToast("图片过大，保存失败，请换一张更小的图片", "error");
        return;
      }
      setCustomBackgrounds(next);
      setActiveBackgroundId(id);
      ui.addToast("已添加并应用背景", "success");
    } catch {
      ui.addToast("读取图片失败，请重试", "error");
    }
  };

  const saveDoubaoConfigFromModal = async (): Promise<void> => {
    const normalized = normalizeModelList(doubaoModelEditorRows.join("\n"), "doubao-seed-1-6-251015");
    if (!normalized.length) {
      ui.addToast("请至少配置一个模型 ID", "error");
      return;
    }
    updateDoubaoModels(normalized, normalized[0] || "");
    await runDoubaoSaveApply({
      preferredModel: String(configStore.config.doubao_model || normalized[0] || ""),
      rowsText: normalized.join("\n"),
      source: "system_settings_doubao_save",
      silent: false,
    });
    setDoubaoSettingsOpen(false);
  };

  const savePersonalConfigFromModal = async (): Promise<void> => {
    const normalized = normalizeModelList(personalModelEditorRows.join("\n"), "deepseek-ai/deepseek-v3.2");
    const baseUrl = String(configStore.config.personal_base_url || "").trim();
    const apiKey = String(configStore.config.personal_api_key || "").trim();
    if (!normalized.length || !baseUrl || !apiKey) {
      ui.addToast("请填写模型 ID、base url 与 api key", "error");
      return;
    }
    updatePersonalModels(normalized, normalized[0] || "");
    await handleSaveConfig();
    setPersonalConfigOpen(false);
  };

  const openDoubaoConfigModal = (): void => {
    setDoubaoModelEditorRows(seedModelEditorRows(configStore.config.doubao_models, "doubao-seed-1-6-251015"));
    setDoubaoSettingsOpen(true);
  };

  const openPersonalConfigModal = (): void => {
    setPersonalModelEditorRows(seedModelEditorRows(configStore.config.personal_models, "deepseek-ai/deepseek-v3.2"));
    setPersonalConfigOpen(true);
  };

  const openSettingsEditorModal = async (): Promise<void> => {
    try {
      const payload = await getSettingsFile();
      setSettingsEditorPath(payload.path || "");
      setSettingsEditorContent(payload.content || "");
      setSettingsEditorOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 settings.json 失败";
      ui.addToast(`读取 settings.json 失败: ${message}`, "error");
    }
  };

  const openAuthEditorModal = async (): Promise<void> => {
    try {
      const payload = await getAuthFile();
      setAuthEditorPath(payload.path || "");
      setAuthEditorContent(payload.content || "");
      setAuthEditorOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 auth.json 失败";
      ui.addToast(`读取 auth.json 失败: ${message}`, "error");
    }
  };

  const saveSettingsEditorModal = async (): Promise<void> => {
    try {
      await saveSettingsFile(settingsEditorContent);
      ui.addToast("settings.json 已保存", "success");
      await configStore.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 settings.json 失败";
      ui.addToast(`保存 settings.json 失败: ${message}`, "error");
    }
  };

  const saveAuthEditorModal = async (): Promise<void> => {
    try {
      await saveAuthFile(authEditorContent);
      ui.addToast("auth.json 已保存", "success");
      await configStore.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 auth.json 失败";
      ui.addToast(`保存 auth.json 失败: ${message}`, "error");
    }
  };

  const restoreSettingsEditorModal = async (): Promise<void> => {
    try {
      await restoreSettingsFile();
      const payload = await getSettingsFile();
      setSettingsEditorContent(payload.content || "");
      ui.addToast("已恢复上一次 settings.json 备份", "success");
      await configStore.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复 settings.json 失败";
      ui.addToast(`恢复 settings.json 失败: ${message}`, "error");
    }
  };

  const restoreAuthEditorModal = async (): Promise<void> => {
    try {
      await restoreAuthFile();
      const payload = await getAuthFile();
      setAuthEditorContent(payload.content || "");
      ui.addToast("已恢复上一次 auth.json 备份", "success");
      await configStore.load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复 auth.json 失败";
      ui.addToast(`恢复 auth.json 失败: ${message}`, "error");
    }
  };

  const openSettingsPath = async (): Promise<void> => {
    try {
      const payload = await openSettingsFile();
      if (!payload.ok) {
        ui.addToast(payload.message || "打开 settings.json 失败", "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开 settings.json 失败";
      ui.addToast(`打开 settings.json 失败: ${message}`, "error");
    }
  };

  const openAuthPath = async (): Promise<void> => {
    try {
      const payload = await openAuthFile();
      if (!payload.ok) {
        ui.addToast(payload.message || "打开 auth.json 失败", "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "打开 auth.json 失败";
      ui.addToast(`打开 auth.json 失败: ${message}`, "error");
    }
  };

  const createBookAction = async (): Promise<void> => {
    const title = newBookTitle.trim();
    if (!title) {
      ui.addToast("书名不能为空", "error");
      return;
    }
    try {
      const payload = await createBook(title);
      if (payload.shelf) {
        setBookshelf(payload.shelf);
      } else {
        await reloadBookshelf();
      }
      setNewBookTitle("");
      await refreshAll();
      generation.clearGenerated();
      ui.addToast("新书创建成功", "success");
      setBookshelfOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建新书失败";
      ui.addToast(`创建新书失败: ${message}`, "error");
    }
  };

  const switchBookAction = async (bookId: string): Promise<void> => {
    try {
      const payload = await switchBook(bookId);
      if (payload.shelf) {
        setBookshelf(payload.shelf);
      }
      await refreshAll();
      generation.clearGenerated();
      ui.addToast("已切换到目标书籍", "success");
      setBookshelfOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "切换书籍失败";
      ui.addToast(`切换书籍失败: ${message}`, "error");
    }
  };

  const openChaptersModal = async (): Promise<void> => {
    setChaptersOpen(true);
    await reloadChapters();
  };

  const openChapterPreview = async (chapter: ChapterItem): Promise<void> => {
    setChapterPreviewOpen(true);
    setChapterPreviewLoading(true);
    try {
      const payload = await getChapter(chapter.id);
      const content = String(payload.content || "");
      setChapterPreviewItem({
        id: chapter.id,
        title: String(payload.title || chapter.title || "未命名章节"),
        content,
        charCount: Number(chapter.char_count || content.length || 0),
        createdAt: String(chapter.created_at || ""),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取章节失败";
      ui.addToast(`读取章节失败: ${message}`, "error");
      setChapterPreviewOpen(false);
    } finally {
      setChapterPreviewLoading(false);
    }
  };

  const openChapterIntoDraft = async (chapterId: number): Promise<void> => {
    try {
      const payload = await getChapter(chapterId);
      draftStore.setContent(String(payload.content || ""));
      setChaptersOpen(false);
      setChapterPreviewOpen(false);
      ui.addToast("章节内容已载入草稿箱", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取章节失败";
      ui.addToast(`读取章节失败: ${message}`, "error");
    }
  };

  const loadPreviewIntoDraft = (): void => {
    if (!chapterPreviewItem) return;
    draftStore.setContent(String(chapterPreviewItem.content || ""));
    setChapterPreviewOpen(false);
    setChaptersOpen(false);
    ui.addToast("章节内容已载入草稿箱", "success");
  };

  const deleteChapterItem = async (chapterId: number): Promise<void> => {
    try {
      await deleteChapter(chapterId);
      await reloadChapters();
      ui.addToast("章节已删除", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除章节失败";
      ui.addToast(`删除章节失败: ${message}`, "error");
    }
  };

  const updateModelContextMenuActionState = (): void => {
    const target = modelContextTargetRef.current;
    const editableSelection = getEditableSelectionText(target).trim();
    const selected = window.getSelection?.();
    const selectedText = String(selected ? selected.toString() : "").trim();
    setModelMenuCanCopy(Boolean(editableSelection || selectedText));
    setModelMenuCanCut(Boolean(target && !target.readOnly && !target.disabled));
    setModelMenuCanPaste(canPasteToTarget(target));
  };

  const closeModelContextMenu = (): void => {
    setModelContextMenu((prev) => ({ ...prev, open: false }));
    modelContextTargetRef.current = null;
    modelContextRowRef.current = null;
  };

  const closeInfoContextMenu = (): void => {
    setInfoContextMenu((prev) => ({ ...prev, open: false }));
    infoContextItemIdRef.current = null;
  };

  const openModelContextMenuAt = (
    clientX: number,
    clientY: number,
    target: HTMLInputElement | HTMLTextAreaElement | null,
    rowContext: { prefix: ModelListPrefix; index: number } | null,
  ): void => {
    const pos = clampMenuPosition(clientX, clientY, 170, rowContext ? 174 : 138);
    modelContextTargetRef.current = target;
    modelContextRowRef.current = rowContext;
    updateModelContextMenuActionState();
    setModelContextMenu({
      open: true,
      left: pos.left,
      top: pos.top,
      showPinTop: Boolean(rowContext),
    });
    closeInfoContextMenu();
  };

  const openInfoContextMenuAt = (clientX: number, clientY: number, itemId: number): void => {
    const pos = clampMenuPosition(clientX, clientY, 150, 60);
    infoContextItemIdRef.current = itemId;
    setInfoContextMenu({ open: true, left: pos.left, top: pos.top });
    closeModelContextMenu();
  };

  const closeOutlineModal = (abortRunning = true): void => {
    const controller = outlineAbortRef.current;
    if (abortRunning && controller) {
      controller.abort();
      ui.addToast("已取消生成", "info");
    }
    outlineAbortRef.current = null;
    setOutlineGenerating(false);
    setOutlinePaused(false);
    setOutlineOpen(false);
  };

  const toggleOutlinePause = (): void => {
    if (!outlineAbortRef.current) return;
    setOutlinePaused((prev) => !prev);
  };

  const generateOutlineFromModal = async (): Promise<void> => {
    if (outlineAbortRef.current) {
      toggleOutlinePause();
      return;
    }
    if (!outlineFormValid) {
      ui.addToast("请先填写所有必填项", "error");
      return;
    }

    const controller = new AbortController();
    outlineAbortRef.current = controller;
    setOutlinePaused(false);
    setOutlineGenerating(true);

    try {
      const prompt = buildOutlineSeed(outlineForm);
      const payload = await generateOutline({ ...configStore.config, outline: prompt }, controller.signal);
      const nextOutline = String(payload.outline || "").trim();
      configStore.patch({ outline: nextOutline || prompt });
      ui.addToast("大纲生成完成", "success");
      closeOutlineModal(false);
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (!aborted) {
        const message = error instanceof Error ? error.message : "生成大纲失败";
        ui.addToast(`生成大纲失败: ${message}`, "error");
      }
    } finally {
      if (outlineAbortRef.current === controller) {
        outlineAbortRef.current = null;
        setOutlineGenerating(false);
        setOutlinePaused(false);
      }
    }
  };

  const handleModelContextCopy = async (): Promise<void> => {
    const selected = window.getSelection?.();
    const text = getEditableSelectionText(modelContextTargetRef.current) || String(selected ? selected.toString() : "");
    if (!String(text || "").trim()) {
      ui.addToast("没有可复制内容", "error");
      return;
    }
    const ok = await copyText(text);
    ui.addToast(ok ? "已复制" : "复制失败", ok ? "success" : "error");
  };

  const handleModelContextCut = async (): Promise<void> => {
    const target = modelContextTargetRef.current;
    if (!target || target.readOnly || target.disabled) {
      ui.addToast("当前区域不支持剪切", "error");
      return;
    }
    const start = Number.isFinite(target.selectionStart) ? Number(target.selectionStart) : 0;
    const end = Number.isFinite(target.selectionEnd) ? Number(target.selectionEnd) : 0;
    if (end <= start) {
      ui.addToast("请选择要剪切的内容", "error");
      return;
    }
    const text = target.value.slice(start, end);
    const ok = await copyText(text);
    if (!ok) {
      ui.addToast("剪切失败", "error");
      return;
    }
    target.setRangeText("", start, end, "start");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    ui.addToast("已剪切", "success");
  };

  const handleModelContextPaste = async (): Promise<void> => {
    const target = modelContextTargetRef.current;
    if (!target || !canPasteToTarget(target)) {
      ui.addToast("当前区域不支持粘贴", "error");
      return;
    }
    const text = await readClipboardText();
    if (!text) {
      ui.addToast("剪贴板为空或无权限", "error");
      return;
    }
    const start = Number.isFinite(target.selectionStart) ? Number(target.selectionStart) : target.value.length;
    const end = Number.isFinite(target.selectionEnd) ? Number(target.selectionEnd) : target.value.length;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    ui.addToast("已粘贴", "success");
  };

  const handleModelContextPinTop = (): void => {
    const row = modelContextRowRef.current;
    if (!row || row.index <= 0) return;
    if (row.prefix === "doubao") {
      if (row.index >= doubaoModelEditorRows.length) return;
      const next = [...doubaoModelEditorRows];
      const [picked] = next.splice(row.index, 1);
      next.unshift(picked);
      setDoubaoModelEditorRows(next);
      updateDoubaoModels(next, next[0] || picked || "");
    } else {
      if (row.index >= personalModelEditorRows.length) return;
      const next = [...personalModelEditorRows];
      const [picked] = next.splice(row.index, 1);
      next.unshift(picked);
      setPersonalModelEditorRows(next);
      updatePersonalModels(next, next[0] || picked || "");
    }
    ui.addToast("已设为置顶模型（默认）", "success");
  };

  const copyInfoBoxItemById = async (id: number): Promise<void> => {
    const item = ui.infoItems.find((x) => x.id === id);
    const text = String(item?.message || "");
    if (!text.trim()) {
      ui.addToast("没有可复制内容", "error");
      return;
    }
    const ok = await copyText(text);
    ui.addToast(ok ? "已复制" : "复制失败", ok ? "success" : "error");
  };

  const runSelfCheck = async (auto = false): Promise<void> => {
    const template = buildSelfCheckTemplate(configStore.config);
    if (!auto) setSelfCheckOpen(true);
    setSelfCheckLoading(true);
    setSelfCheckSummary("正在检测环境，请稍候...");
    setSelfCheckRows(
      template.map((item) => ({
        id: item.id,
        label: item.label,
        ok: false,
        detail: "检测中...",
        required: false,
        pending: true,
      })),
    );
    try {
      const payload = await getSelfCheck();
      const checks = Array.isArray(payload.checks) ? payload.checks : [];
      const requiredSet = new Set(Array.isArray(payload.required_ids) ? payload.required_ids.map((x) => String(x || "")) : []);
      const rowsFromPayload: SelfCheckRowView[] = checks.map((item) => {
        const id = String(item.id || "");
        return {
          id,
          label: String(item.name || item.label || id || "检查项"),
          ok: Boolean(item.ok),
          detail: String(item.detail || ""),
          required: requiredSet.has(id),
          pending: false,
        };
      });
      const payloadById = new Map(rowsFromPayload.map((row) => [row.id, row]));
      const rows: SelfCheckRowView[] = template.map((base) => {
        const hit = payloadById.get(base.id);
        if (hit) return hit;
        return {
          id: base.id,
          label: base.label,
          ok: false,
          detail: "当前引擎未启用该检查项",
          required: false,
          pending: false,
        };
      });
      rowsFromPayload.forEach((row) => {
        if (!rows.find((x) => x.id === row.id)) rows.push(row);
      });
      setSelfCheckRows(rows);
      const requiredFailed = rows.filter((x) => x.required && !x.ok).length;
      if (requiredFailed > 0) {
        setSelfCheckSummary(`当前引擎所需项异常：${requiredFailed} 项`);
        if (!auto) ui.addToast(`环境自检：当前引擎有 ${requiredFailed} 项异常`, "error");
      } else {
        setSelfCheckSummary("当前引擎所需项均已就绪");
        if (!auto) ui.addToast("环境自检通过", "success");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "自检失败";
      setSelfCheckRows([{ id: "self_check_api", label: "自检接口", ok: false, detail: message, required: true, pending: false }]);
      setSelfCheckSummary(`环境自检失败：${message}`);
      if (!auto) ui.addToast(`环境自检失败: ${message}`, "error");
    } finally {
      setSelfCheckLoading(false);
    }
  };

  const restoreDiscarded = async (id: number): Promise<void> => {
    const content = await discarded.restore(id);
    if (!content) return;
    useGenerationStore.setState({
      generatedText: content,
      stage: "completed",
      isWriting: false,
      taskId: "",
      isPaused: false,
      thinking: "已复原废弃稿件",
    });
  };

  const softwareGpuMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const gpuMode = String(params.get("gpu_mode") || "").toLowerCase();
    const gpuCompositing = String(params.get("gpu_compositing") || "").toLowerCase();
    const webgl = String(params.get("webgl") || "").toLowerCase();
    if (gpuMode === "software") return true;
    if (gpuCompositing.includes("disabled")) return true;
    if (webgl.includes("disabled")) return true;
    return false;
  }, []);

  const appClassName = [
    ui.sidebarCollapsed ? "sidebar-collapsed" : "",
    engineSwitching ? "engine-switching" : "",
    softwareGpuMode ? "software-gpu" : "",
    ui.strictCloneMode ? "ui-clone-mode" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const strictCloneEnabled = ui.strictCloneMode;
  const liquidDynamicEnabled = strictCloneEnabled && !engineSwitching;
  const activeBackground = useMemo(
    () => backgroundLibrary.find((item) => item.id === activeBackgroundId) || backgroundLibrary[0] || null,
    [activeBackgroundId, backgroundLibrary],
  );
  const activeBackgroundStyle = useMemo(
    () => ({
      backgroundImage: activeBackground
        ? `url("${activeBackground.url}")`
        : (ui.strictCloneMode ? CLONE_BACKGROUND_IMAGE : "none"),
    }),
    [activeBackground, ui.strictCloneMode],
  );

  return (
    <>
      <div
        id="app-background-layer"
        className={[softwareGpuMode ? "software-gpu" : "", ui.strictCloneMode ? "ui-clone-mode" : ""].filter(Boolean).join(" ")}
        style={activeBackgroundStyle}
        aria-hidden="true"
      />
      <div id="app-background-vignette" className={[softwareGpuMode ? "software-gpu" : "", ui.strictCloneMode ? "ui-clone-mode" : ""].filter(Boolean).join(" ")} aria-hidden="true" />

      <div id="app" className={appClassName}>
        <Sidebar
          config={configStore.config}
          saving={configStore.saving}
          isWriting={generation.isWriting}
          personalConfigReady={personalConfigReady}
          onPatch={handleSidebarPatch}
          onSelectDoubaoModel={applySelectedDoubaoModel}
          onSelectPersonalModel={applySelectedPersonalModel}
          onSave={() => void handleSaveConfig()}
          onStartStop={() => void handleStartStop()}
          onOpenPersonalConfig={openPersonalConfigModal}
          onImportFile={(target, file) => void handleImportFile(target, file)}
        />

        <main id="center-area">
          <Toolbar
            sidebarCollapsed={ui.sidebarCollapsed}
            discardedVisible={discarded.visible}
            hasInfoItems={ui.infoItems.length > 0}
            dynamicEffectsEnabled={liquidDynamicEnabled}
            interactionsLocked={generation.isWriting || engineSwitching}
            config={configStore.config}
            status={runtimeStatus}
            statusOverride={toolbarStatusOverride}
            onToggleSidebar={ui.toggleSidebar}
            onToggleDiscarded={() => discarded.setVisible(!discarded.visible)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenOutline={() => setOutlineOpen(true)}
            onOpenBookshelf={() => {
              setBookshelfOpen(true);
              void reloadBookshelf();
            }}
            onOpenModelHealth={() => {
              setModelHealthOpen(true);
              void refreshRuntimeStatus(true);
            }}
            onOpenInfoBox={() => setInfoBoxOpen(true)}
            onOpenChapters={() => void openChaptersModal()}
            onOpenSelfCheck={() => void runSelfCheck()}
            onCreateBookQuick={() => void createBookQuick()}
            onSwitchEngine={(mode) => {
              void switchEngineMode(mode);
            }}
          />

          <DiscardedPanel
            visible={discarded.visible}
            items={discarded.items}
            dynamicEffectsEnabled={liquidDynamicEnabled}
            onRestore={(id) => void restoreDiscarded(id)}
            onDelete={(id) => void discarded.remove(id)}
          />

          <section id="writing-desk">
            <DraftPanel
              content={draftStore.content}
              splitLoading={chapterTitleGenerating}
              saveLoading={chapterSaving}
              polishLoading={draftPolishing}
              cacheEnabled={cacheEnabled}
              cacheExpanded={cacheEnabled && cacheExpanded}
              dynamicEffectsEnabled={liquidDynamicEnabled}
              onChange={draftStore.setContent}
              onPolish={() => void handlePolishDraft()}
              onSplitChapter={() => void handleSplitChapter()}
              onToggleCache={() => {
                if (!cacheEnabled) return;
                setCacheExpanded((prev) => !prev);
              }}
            />

            <GenerationPanel
              statusState={generation.isPaused ? "paused" : generation.stage}
              stage={generation.stage}
              stageDurations={stageDurations}
              statusText={statusText(generation.stage, generation.isPaused, generation.isWriting)}
              thinkingText={generation.thinking}
              generatedText={generation.generatedText}
              referenceStatus={generation.referenceStatus}
              stageTimelineEnabled={stageTimelineEnabled}
              isWriting={generation.isWriting}
              hasTask={Boolean(generation.taskId)}
              isPaused={generation.isPaused}
              skipVisible={generation.skipVisible}
              showTypeCursor={
                generation.typewriterEnabled
                && generation.isWriting
                && !generation.isPaused
                && generation.stage !== "completed"
                && generation.stage !== "error"
                && generation.stage !== "stopped"
              }
              autoScroll={generation.autoScroll}
              dynamicEffectsEnabled={liquidDynamicEnabled}
              onStartStop={() => void handleStartStop()}
              onPauseResume={() => void handlePauseResume()}
              onSkip={() => void handleSkipAnimation()}
              onToggleAutoScroll={() => {
                generation.setAutoScroll(!generation.autoScroll);
                ui.addToast(generation.autoScroll ? "自动滚动已关闭" : "自动滚动已开启", "info");
              }}
              onAccept={() => void handleAccept()}
              onRewrite={() => void handleRewrite()}
            />
          </section>
        </main>
      </div>

      <ModalHost
        chapterTitleOpen={chapterTitleOpen}
        chapterTitle={chapterTitle}
        onChapterTitleChange={setChapterTitle}
        onChapterConfirm={() => void handleConfirmChapterSave()}
        onCloseChapterModal={() => setChapterTitleOpen(false)}
        consistencyOpen={consistencyOpen}
        consistencySummary={consistencySummary}
        consistencyConflicts={consistencyConflicts}
        onCloseConsistency={() => setConsistencyOpen(false)}
        memoryOpen={memoryOpen}
        memoryAdded={memoryAdded}
        memoryReplaced={memoryReplaced}
        memoryUnchanged={memoryUnchanged}
        onCloseMemory={() => setMemoryOpen(false)}
        selfCheckOpen={selfCheckOpen}
        selfCheckLoading={selfCheckLoading}
        selfCheckSummary={selfCheckSummary}
        selfCheckRows={selfCheckRows}
        onRecheck={() => void runSelfCheck(false)}
        onCloseSelfCheck={() => setSelfCheckOpen(false)}
      />

      <div id="settings-modal" className={`modal-overlay ${settingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header settings-modal-header">
            <button className="icon-btn settings-modal-header-icon-btn" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button>
            <h3>系统设置</h3>
            <button className="icon-btn settings-modal-header-icon-btn save-btn" type="button" aria-label="保存设置" onClick={() => void saveSettingsModal()}>✓</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <h4>主题外观</h4>
              <button
                id="open-appearance-settings-btn"
                className="settings-entry-btn"
                type="button"
                onClick={openAppearanceSettingsModal}
              >
                <span>外观与背景</span>
                <span className="settings-entry-arrow">{themeModeLabel(themeMode)} ›</span>
              </button>
              <p className="settings-desc">点击进入：模式切换、字体设置、背景预览与设为背景。</p>
            </div>

            <div className="settings-section">
              <h4>生成区设置</h4>
              <div className="settings-row">
                <label htmlFor="typewriter-speed" className="settings-label">打字机速度</label>
                <div className="settings-control">
                  <input
                    id="typewriter-speed"
                    className={`ios-range ${typewriterRangeSliding ? "is-sliding" : ""}`}
                    style={typewriterRangeStyle}
                    type="range"
                    min={10}
                    max={80}
                    step={1}
                    value={typewriterSpeedValue}
                    onChange={(e) => generation.setTypewriterSpeed(Math.max(10, Math.min(80, Math.round(Number(e.target.value || 30)))))}
                    onPointerDown={() => setTypewriterRangeSliding(true)}
                    onPointerUp={() => setTypewriterRangeSliding(false)}
                    onPointerCancel={() => setTypewriterRangeSliding(false)}
                    onBlur={() => setTypewriterRangeSliding(false)}
                  />
                  <span id="typewriter-speed-value" className="settings-value range-value">{typewriterSpeedValue}ms/字</span>
                </div>
              </div>
              <label className="settings-toggle">
                <input id="typewriter-enabled" type="checkbox" checked={generation.typewriterEnabled} onChange={(e) => generation.setTypewriterEnabled(e.target.checked)} />
                <span>启用打字机动画</span>
              </label>
              <p className="settings-desc">关闭后生成内容将直接显示，不再逐字播放。</p>
            </div>

            <div className="settings-section">
              <h4>网络代理</h4>
              <div className="settings-row">
                <label className="settings-label">代理端口</label>
                <div className="settings-control">
                  <input id="proxy-port-input" className="settings-number-input" type="text" inputMode="numeric" value={configStore.config.proxy_port || ""} onChange={(e) => configStore.patch({ proxy_port: e.target.value })} placeholder="10808" />
                </div>
              </div>
              <p className="settings-desc">Gemini、Claude 和 ChatGPT 每次执行时会临时使用 http://127.0.0.1:端口 代理，不修改系统全局环境。</p>
            </div>

            <div className="settings-section">
              <h4>模型配置</h4>
              <button id="doubao-config-btn" className="settings-entry-btn" type="button" onClick={openDoubaoConfigModal}>
                <span>豆包</span>
                <span className="settings-entry-arrow">›</span>
              </button>
            </div>

            <div className="settings-section">
              <h4>高级设置</h4>
              <button id="open-assist-settings-btn" className="settings-entry-btn" type="button" onClick={() => setAssistSettingsOpen(true)}>
                <span>辅助功能</span>
                <span className="settings-entry-arrow">›</span>
              </button>
              <button id="open-access-settings-btn" className="settings-entry-btn" type="button" onClick={() => setAccessSettingsOpen(true)}>
                <span>调用方式</span>
                <span className="settings-entry-arrow">›</span>
              </button>
              <button className="settings-entry-btn" type="button" onClick={() => void openSettingsEditorModal()}>
                <span>打开 settings.json</span>
                <span className="settings-entry-arrow">›</span>
              </button>
              <button className="settings-entry-btn" type="button" onClick={() => void openAuthEditorModal()}>
                <span>打开 auth.json</span>
                <span className="settings-entry-arrow">›</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="appearance-settings-modal" className={`modal-overlay ${appearanceSettingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) closeAppearanceSettingsModal();
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header settings-modal-header">
            <button
              className="icon-btn settings-modal-header-icon-btn back-btn"
              type="button"
              aria-label="返回系统设置"
              onClick={closeAppearanceSettingsModal}
            >
              <svg className="settings-back-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M12.5 4.5L7 10l5.5 5.5" />
              </svg>
            </button>
            <h3>主题外观</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" aria-label="关闭主题外观" onClick={closeAppearanceSettingsModal}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <h4>模式切换</h4>
              <div className="theme-options">
                <label className="theme-option">
                  <input type="radio" name="theme-appearance" value="light" checked={themeMode === "light"} onChange={() => setThemeMode("light")} />
                  <span className="theme-label">☀️ 浅色模式</span>
                </label>
                <label className="theme-option">
                  <input type="radio" name="theme-appearance" value="dark" checked={themeMode === "dark"} onChange={() => setThemeMode("dark")} />
                  <span className="theme-label">🌙 深色模式</span>
                </label>
                <label className="theme-option">
                  <input type="radio" name="theme-appearance" value="auto" checked={themeMode === "auto"} onChange={() => setThemeMode("auto")} />
                  <span className="theme-label">💻 跟随系统</span>
                </label>
              </div>
            </div>

            <div className="settings-section">
              <h4>字体切换</h4>
              <button
                id="appearance-font-toggle-btn"
                className="settings-entry-btn"
                type="button"
                onClick={() => setAppearanceFontOpen(true)}
              >
                <span>字体设置</span>
                <span className="settings-entry-arrow">›</span>
              </button>
              <p className="settings-desc">点击后进入字体弹窗，设置字体方案、字号与文字颜色。</p>
            </div>

            <div className="settings-section">
              <h4>设置背景</h4>
              <button
                id="appearance-background-toggle-btn"
                className="settings-entry-btn"
                type="button"
                onClick={() => setAppearanceBackgroundOpen(true)}
              >
                <span>背景图库</span>
                <span className="settings-entry-arrow">›</span>
              </button>
              <p className="settings-desc">点击后进入背景弹窗，预览背景并一键设为当前背景。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={closeAppearanceSettingsModal}>完成</button>
          </div>
        </div>
      </div>

      <div id="appearance-font-modal" className={`modal-overlay ${appearanceFontOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAppearanceFontOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header settings-modal-header">
            <button
              className="icon-btn settings-modal-header-icon-btn back-btn"
              type="button"
              aria-label="返回主题外观"
              onClick={() => setAppearanceFontOpen(false)}
            >
              <svg className="settings-back-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M12.5 4.5L7 10l5.5 5.5" />
              </svg>
            </button>
            <h3>字体设置</h3>
            <button
              className="icon-btn settings-modal-header-icon-btn"
              type="button"
              aria-label="关闭字体设置"
              onClick={() => {
                setAppearanceFontOpen(false);
                setAppearanceSettingsOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">字体方案</label>
                <div className="settings-control">
                  <ConfigSelect
                    id="font-preset-select"
                    value={fontPreset}
                    onChange={(value) => setFontPreset(value as FontPreset)}
                    options={FONT_PRESET_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </div>
              </div>
              <div className="settings-row">
                <label htmlFor="font-size-select" className="settings-label">字体大小</label>
                <div className="settings-control">
                  <input
                    id="font-size-select"
                    className={`ios-range ${fontSizeRangeSliding ? "is-sliding" : ""}`}
                    style={fontSizeRangeStyle}
                    type="range"
                    min={13}
                    max={20}
                    step={0.1}
                    value={fontSizePx}
                    onChange={(e) => setFontSizePx(clampFontSize(Number(e.target.value || 15)))}
                    onPointerDown={() => setFontSizeRangeSliding(true)}
                    onPointerUp={() => setFontSizeRangeSliding(false)}
                    onPointerCancel={() => setFontSizeRangeSliding(false)}
                    onBlur={() => setFontSizeRangeSliding(false)}
                  />
                  <span className="settings-value range-value">{formatFontSize(fontSizePx)}</span>
                </div>
              </div>
              <label className="ios-switch-row" htmlFor="font-weight-bold-enabled">
                <span className="settings-label">全局字体加粗</span>
                <span className="ios-switch">
                  <input
                    id="font-weight-bold-enabled"
                    type="checkbox"
                    checked={fontWeightBold}
                    onChange={(e) => setFontWeightBold(e.target.checked)}
                  />
                  <span className="ios-switch-slider" />
                </span>
              </label>
              <label className="ios-switch-row" htmlFor="custom-text-color-enabled">
                <span className="settings-label">自定义文字颜色</span>
                <span className="ios-switch">
                  <input
                    id="custom-text-color-enabled"
                    type="checkbox"
                    checked={customTextColorEnabled}
                    onChange={(e) => setCustomTextColorEnabled(e.target.checked)}
                  />
                  <span className="ios-switch-slider" />
                </span>
              </label>
              {customTextColorEnabled ? (
                <div className="settings-row">
                  <label htmlFor="custom-text-color-input" className="settings-label">文字颜色</label>
                  <div className="settings-control">
                    <input
                      id="custom-text-color-input"
                      className="settings-color-input"
                      type="color"
                      value={customTextColor}
                      onChange={(e) => {
                        const normalized = normalizeHexColor(e.target.value);
                        if (normalized) setCustomTextColor(normalized);
                      }}
                    />
                    <span className="settings-value">{customTextColor.toUpperCase()}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={() => setAppearanceFontOpen(false)}>完成</button>
          </div>
        </div>
      </div>

      <div id="appearance-background-modal" className={`modal-overlay ${appearanceBackgroundOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAppearanceBackgroundOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header settings-modal-header">
            <button
              className="icon-btn settings-modal-header-icon-btn back-btn"
              type="button"
              aria-label="返回主题外观"
              onClick={() => setAppearanceBackgroundOpen(false)}
            >
              <svg className="settings-back-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M12.5 4.5L7 10l5.5 5.5" />
              </svg>
            </button>
            <h3>设置背景</h3>
            <button
              className="icon-btn settings-modal-header-icon-btn"
              type="button"
              aria-label="关闭背景设置"
              onClick={() => {
                setAppearanceBackgroundOpen(false);
                setAppearanceSettingsOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="background-picker-toolbar">
                <button
                  id="appearance-background-add-btn"
                  className="btn btn-sm btn-primary background-picker-add-btn"
                  type="button"
                  onClick={openBackgroundFilePicker}
                >
                  添加图片
                </button>
                <input
                  ref={backgroundFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
                  onChange={(event) => void handleBackgroundFilePick(event)}
                  style={{ display: "none" }}
                />
                <p className="background-picker-help">支持 JPG / PNG / WebP / AVIF / GIF。添加后可立即预览并设为背景。</p>
              </div>
              {backgroundLibrary.length ? (
                <div className="background-picker-grid">
                  {backgroundLibrary.map((item) => {
                    const active = item.id === activeBackgroundId;
                    return (
                      <div key={item.id} className={`background-picker-item ${active ? "active" : ""}`}>
                        <div className="background-picker-thumb-wrap">
                          <img className="background-picker-thumb" src={item.url} alt={item.name} loading="lazy" decoding="async" />
                        </div>
                        <div className="background-picker-meta">
                          <span className="background-picker-title" title={item.name}>{item.name}</span>
                          <button
                            className={`btn btn-sm background-picker-apply ${active ? "btn-success" : "btn-primary"}`}
                            type="button"
                            onClick={() => applyBackgroundImage(item.id)}
                            disabled={active}
                          >
                            {active ? "当前背景" : "设为背景"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="settings-desc">暂无背景图片，请点击“添加图片”导入。</p>
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={() => setAppearanceBackgroundOpen(false)}>完成</button>
          </div>
        </div>
      </div>

      <div id="assist-settings-modal" className={`modal-overlay ${assistSettingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAssistSettingsOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header">
            <h3>辅助功能</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setAssistSettingsOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <label className="ios-switch-row" htmlFor="cache-box-enabled">
                <span className="settings-label">启用缓存区</span>
                <span className="ios-switch">
                  <input id="cache-box-enabled" type="checkbox" checked={cacheEnabled} onChange={(e) => setCacheEnabled(e.target.checked)} />
                  <span className="ios-switch-slider" />
                </span>
              </label>
              <label className="ios-switch-row" htmlFor="stage-timeline-enabled">
                <span className="settings-label">显示阶段时间线</span>
                <span className="ios-switch">
                  <input id="stage-timeline-enabled" type="checkbox" checked={stageTimelineEnabled} onChange={(e) => setStageTimelineEnabled(e.target.checked)} />
                  <span className="ios-switch-slider" />
                </span>
              </label>
              <label className="ios-switch-row" htmlFor="strict-clone-mode-enabled">
                <span className="settings-label">完全复刻 UI（除按钮尺寸）</span>
                <span className="ios-switch">
                  <input
                    id="strict-clone-mode-enabled"
                    type="checkbox"
                    checked={ui.strictCloneMode}
                    onChange={(e) => {
                      const next = e.target.checked;
                      ui.setStrictCloneMode(next);
                      if (next) {
                        ui.setLiquidProfile("aggressive");
                        ui.setDynamicEffectsEnabled(true);
                        ui.addToast("已启用完全复刻 UI", "success");
                      } else {
                        ui.setLiquidProfile("balanced");
                        ui.setDynamicEffectsEnabled(false);
                        ui.addToast("已关闭完全复刻 UI", "info");
                      }
                    }}
                  />
                  <span className="ios-switch-slider" />
                </span>
              </label>
              <p className="settings-desc">开启后应用完整复刻风格；关闭后恢复普通样式。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={() => setAssistSettingsOpen(false)}>完成</button>
          </div>
        </div>
      </div>

      <div id="access-settings-modal" className={`modal-overlay ${accessSettingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAccessSettingsOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header">
            <h3>调用方式</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setAccessSettingsOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">ChatGPT</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.codex_access_mode}
                    onChange={(value) => configStore.patch({ codex_access_mode: value as "cli" | "api" })}
                    options={[
                      { value: "cli", label: "CLI" },
                      { value: "api", label: "API" },
                    ]}
                  />
                </div>
              </div>
              {configStore.config.codex_access_mode === "api" ? (
                <div className="settings-row">
                  <label className="settings-label">ChatGPT API Key</label>
                  <div className="settings-control">
                    <input className="settings-number-input" type="password" placeholder="OPENAI_API_KEY" value={configStore.config.codex_api_key || ""} onChange={(e) => configStore.patch({ codex_api_key: e.target.value })} />
                  </div>
                </div>
              ) : null}
              <div className="settings-row">
                <label className="settings-label">Gemini</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.gemini_access_mode}
                    onChange={(value) => configStore.patch({ gemini_access_mode: value as "cli" | "api" })}
                    options={[
                      { value: "cli", label: "CLI" },
                      { value: "api", label: "API" },
                    ]}
                  />
                </div>
              </div>
              {configStore.config.gemini_access_mode === "api" ? (
                <div className="settings-row">
                  <label className="settings-label">Gemini API Key</label>
                  <div className="settings-control">
                    <input className="settings-number-input" type="password" placeholder="GEMINI_API_KEY" value={configStore.config.gemini_api_key || ""} onChange={(e) => configStore.patch({ gemini_api_key: e.target.value })} />
                  </div>
                </div>
              ) : null}
              <div className="settings-row">
                <label className="settings-label">Claude</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.claude_access_mode}
                    onChange={(value) => configStore.patch({ claude_access_mode: value as "cli" | "api" })}
                    options={[
                      { value: "cli", label: "CLI" },
                      { value: "api", label: "API" },
                    ]}
                  />
                </div>
              </div>
              {configStore.config.claude_access_mode === "api" ? (
                <div className="settings-row">
                  <label className="settings-label">Claude API Key</label>
                  <div className="settings-control">
                    <input className="settings-number-input" type="password" placeholder="ANTHROPIC_API_KEY" value={configStore.config.claude_api_key || ""} onChange={(e) => configStore.patch({ claude_api_key: e.target.value })} />
                  </div>
                </div>
              ) : null}
              <p className="settings-desc">API 模式分别使用 OpenAI / Gemini / Claude 官方接口；CLI 模式继续调用本机命令行。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-warning" type="button" onClick={() => void handleTestConnectivity()} disabled={connectivityTesting}>
              {connectivityTesting ? "检测中..." : "连通性检测"}
            </button>
            <button className="btn btn-primary" type="button" onClick={() => setAccessSettingsOpen(false)}>完成</button>
          </div>
        </div>
      </div>

      <div id="doubao-config-modal" className={`modal-overlay ${doubaoSettingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setDoubaoSettingsOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header">
            <h3>豆包</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setDoubaoSettingsOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">当前模型</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.doubao_model || doubaoModalModelRows[0] || ""}
                    onChange={(value) => applySelectedDoubaoModel(value)}
                    options={doubaoModalModelRows.map((x) => ({ value: x, label: x }))}
                  />
                </div>
              </div>
              <ModelIdListEditor
                idPrefix="doubao"
                rows={doubaoModelEditorRows}
                onRowsChange={setDoubaoModelEditorRows}
                hint="支持增减模型 ID。首位模型为默认使用模型，失败时按从上到下自动切换。"
              />
              <div className="settings-row">
                <label className="settings-label">思考等级</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.doubao_reasoning_effort}
                    onChange={(value) => configStore.patch({ doubao_reasoning_effort: value as "low" | "medium" | "high" })}
                    options={[
                      { value: "low", label: "低" },
                      { value: "medium", label: "中" },
                      { value: "high", label: "高" },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={() => void saveDoubaoConfigFromModal()} disabled={doubaoSaveDisabled}>保存并应用</button>
            <button className="btn btn-danger" type="button" onClick={() => setDoubaoSettingsOpen(false)}>取消</button>
          </div>
        </div>
      </div>

      <div id="personal-config-modal" className={`modal-overlay ${personalConfigOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setPersonalConfigOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header">
            <h3>个人配置</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setPersonalConfigOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">当前模型</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.personal_model || personalModalModelRows[0] || ""}
                    onChange={(value) => applySelectedPersonalModel(value)}
                    options={personalModalModelRows.map((x) => ({ value: x, label: x }))}
                  />
                </div>
              </div>
              <ModelIdListEditor
                idPrefix="personal"
                rows={personalModelEditorRows}
                onRowsChange={setPersonalModelEditorRows}
                hint="支持增减模型 ID。首位模型为默认使用模型，失败时按从上到下自动切换。"
              />
              <div className="settings-row">
                <label className="settings-label">Base URL</label>
                <div className="settings-control">
                  <input className="settings-number-input" type="text" value={configStore.config.personal_base_url || ""} onChange={(e) => configStore.patch({ personal_base_url: e.target.value })} />
                </div>
              </div>
              <div className="settings-row">
                <label className="settings-label">API Key</label>
                <div className="settings-control">
                  <input className="settings-number-input" type="password" value={configStore.config.personal_api_key || ""} onChange={(e) => configStore.patch({ personal_api_key: e.target.value })} />
                </div>
              </div>
              <p className="settings-desc">调用方式使用 OpenAI Chat Completions 流式接口，模型默认读取「生成引擎」中的个人模型 ID。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button id="personal-config-save-btn" className="btn btn-primary" type="button" onClick={() => void savePersonalConfigFromModal()} disabled={personalSaveDisabled}>保存并应用</button>
            <button className="btn btn-danger" type="button" onClick={() => setPersonalConfigOpen(false)}>取消</button>
          </div>
        </div>
      </div>

      <div id="settings-json-modal" className={`modal-overlay ${settingsEditorOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsEditorOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>settings.json</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setSettingsEditorOpen(false)}>×</button>
          </div>
          <p className="consistency-summary">路径：{settingsEditorPath || configStore.config.settings_path || "未读取"}</p>
          <textarea className="outline-input" style={{ minHeight: 320, fontFamily: "Consolas, 'Courier New', monospace" }} value={settingsEditorContent} onChange={(e) => setSettingsEditorContent(e.target.value)} />
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={() => void saveSettingsEditorModal()}>保存</button>
            <button className="btn btn-warning" type="button" onClick={() => void restoreSettingsEditorModal()}>复原上一次</button>
            <button className="btn btn-warning" type="button" onClick={() => void openSettingsPath()}>打开文件</button>
            <button className="btn btn-danger" type="button" onClick={() => setSettingsEditorOpen(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div id="auth-json-modal" className={`modal-overlay ${authEditorOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAuthEditorOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>auth.json</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setAuthEditorOpen(false)}>×</button>
          </div>
          <p className="consistency-summary">路径：{authEditorPath || configStore.config.auth_path || "未读取"}</p>
          <textarea className="outline-input" style={{ minHeight: 320, fontFamily: "Consolas, 'Courier New', monospace" }} value={authEditorContent} onChange={(e) => setAuthEditorContent(e.target.value)} />
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={() => void saveAuthEditorModal()}>保存</button>
            <button className="btn btn-warning" type="button" onClick={() => void restoreAuthEditorModal()}>复原上一次</button>
            <button className="btn btn-warning" type="button" onClick={() => void openAuthPath()}>打开文件</button>
            <button className="btn btn-danger" type="button" onClick={() => setAuthEditorOpen(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div id="bookshelf-modal" className={`modal-overlay ${bookshelfOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) closeBookshelfModal();
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>书架</h3>
            <button
              className={`icon-btn settings-modal-header-icon-btn ${configStore.config.first_run_required ? "hidden" : ""}`}
              type="button"
              onClick={closeBookshelfModal}
              aria-label="关闭书架弹窗"
            >
              ×
            </button>
          </div>
          <p id="bookshelf-tip" className="consistency-summary">{bookshelfTip}</p>
          <div className="settings-row" style={{ marginBottom: 10 }}>
            <label className="settings-label">新书书名</label>
            <div className="settings-control">
              <input id="new-book-title-input" className="settings-number-input" type="text" value={newBookTitle} onChange={(e) => setNewBookTitle(e.target.value)} placeholder="输入书名后创建" />
            </div>
          </div>
          <div className="modal-actions" style={{ marginBottom: 12 }}>
            <button className="btn btn-primary" type="button" onClick={() => void createBookAction()}>创建新书</button>
            <button className="btn btn-warning" type="button" onClick={() => void reloadBookshelf()}>刷新</button>
          </div>
          <div className="bookshelf-list">
            {bookshelfLoading ? (
              <div className="discarded-empty">加载中...</div>
            ) : (bookshelf.books || []).length === 0 ? (
              <div className="discarded-empty">暂无书籍</div>
            ) : (
              (bookshelf.books || []).map((book) => {
                const activeId = bookshelf.active_book?.id || bookshelf.active_book_id || "";
                const active = activeId === book.id;
                return (
                  <div className={`book-card ${active ? "active" : ""}`} key={book.id}>
                    <div className="book-cover">
                      {book.title}
                    </div>
                    <div className="book-meta">文件夹：{book.folder || "-"}</div>
                    <div className="book-meta">更新时间：{book.updated_at || "-"}</div>
                    <button className={`btn btn-primary btn-sm ${active ? "btn-success" : ""}`} type="button" disabled={active} onClick={() => void switchBookAction(book.id)}>
                      {active ? "当前写作中" : "切换到此书"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div id="chapter-manager-modal" className={`modal-overlay ${chaptersOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setChaptersOpen(false);
      }}>
        <div className="modal-content consistency-modal-content chapter-manager-content">
          <div className="modal-header">
            <h3>章节管理</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setChaptersOpen(false)}>×</button>
          </div>
          <div className="modal-actions" style={{ marginBottom: 12 }}>
            <button className="btn btn-warning" type="button" onClick={() => void reloadChapters()}>刷新</button>
          </div>
          <div className="consistency-conflict-list">
            {chaptersLoading ? (
              <div className="consistency-item">加载中...</div>
            ) : chapters.length === 0 ? (
              <div className="consistency-item">暂无章节</div>
            ) : (
              chapters.map((chapter) => (
                <div key={chapter.id} className="consistency-item chapter-item-card">
                  <div className="consistency-head">#{chapter.id} · {chapter.title || "未命名章节"}</div>
                  <div className="consistency-line">{chapter.created_at || ""} · {chapter.char_count || 0}字</div>
                  <div className="modal-actions chapter-item-actions" style={{ marginTop: 10 }}>
                    <button className="btn btn-warning" type="button" onClick={() => void openChapterPreview(chapter)}>打开预览</button>
                    <button className="btn btn-primary" type="button" onClick={() => void openChapterIntoDraft(chapter.id)}>载入草稿箱</button>
                    <button className="btn btn-danger" type="button" onClick={() => void deleteChapterItem(chapter.id)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div id="chapter-preview-modal" className={`modal-overlay ${chapterPreviewOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setChapterPreviewOpen(false);
      }}>
        <div className="modal-content chapter-preview-modal-content">
          <div className="modal-header">
            <h3>{chapterPreviewItem?.title || "章节预览"}</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setChapterPreviewOpen(false)}>×</button>
          </div>
          <div className="chapter-preview-meta">
            <span>章节ID：{chapterPreviewItem?.id || "-"}</span>
            <span>字数：{chapterPreviewItem?.charCount || 0}</span>
            <span>保存时间：{chapterPreviewItem?.createdAt || "-"}</span>
          </div>
          <div className="chapter-preview-body">
            {chapterPreviewLoading ? (
              <div className="thinking-container">
                <div className="thinking-spinner" />
                <div className="thinking-text">正在加载章节内容...</div>
              </div>
            ) : (
              <article className="chapter-preview-paper">
                <pre className="chapter-preview-text">{chapterPreviewItem?.content || "暂无内容"}</pre>
              </article>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={loadPreviewIntoDraft} disabled={chapterPreviewLoading || !chapterPreviewItem}>载入草稿箱</button>
            <button className="btn btn-danger" type="button" onClick={() => setChapterPreviewOpen(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div id="polish-modal" className={`modal-overlay ${polishModalOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget && !draftPolishing) setPolishModalOpen(false);
      }}>
        <div className="modal-content polish-modal-content">
          <div className="modal-header">
            <h3>润色草稿</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setPolishModalOpen(false)} disabled={draftPolishing}>×</button>
          </div>
          <p className="consistency-summary">
            当前引擎：
            <span className="polish-engine-chip">{modeLabel(configStore.config.engine_mode)}</span>
            模型：{modelForMode(configStore.config, configStore.config.engine_mode) || "-"}
          </p>
          <label className="outline-label" htmlFor="polish-requirements-input">润色要求</label>
          <textarea
            id="polish-requirements-input"
            className="outline-input polish-requirements-input"
            value={polishRequirements}
            onChange={(e) => setPolishRequirements(e.target.value)}
            placeholder="例如：保持剧情不变，增强画面感；对话更自然；压缩冗余描述。"
            disabled={draftPolishing}
          />
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={() => void submitPolishDraft()} disabled={draftPolishing}>
              {draftPolishing ? "润色中..." : "开始润色"}
            </button>
            <button className="btn btn-danger" type="button" onClick={() => setPolishModalOpen(false)} disabled={draftPolishing}>取消</button>
          </div>
        </div>
      </div>

      <div id="outline-modal" className={`modal-overlay ${outlineOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) closeOutlineModal(true);
      }}>
        <div className="modal-content outline-modal-content">
          <div id="outline-loading-overlay" className={`loading-overlay ${outlineGenerating ? "" : "hidden"}`}>
            <div className={`spinner ${outlinePaused ? "paused" : ""}`} />
            <div className="loading-text">{outlinePaused ? "已暂停生成大纲" : "正在生成大纲..."}</div>
          </div>
          <div className="modal-header">
            <h3>生成大纲</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" aria-label="关闭大纲弹窗" onClick={() => closeOutlineModal(true)}>×</button>
          </div>
          <div className="outline-modal-body">
            <div className="outline-section">
              <h4>小说框架</h4>
              <label className="outline-label">总体流程 <span className="required-mark">*</span></label>
              <textarea id="outline-overall-flow" className="outline-input" placeholder="起始，大致经过，预期结果。" value={outlineForm.overall_flow} onChange={(e) => setOutlineForm((s) => ({ ...s, overall_flow: e.target.value }))} />
              <label className="outline-label">主要卖点</label>
              <textarea id="outline-selling-points" className="outline-input" placeholder="例如：金手指/外挂设定: [系统, 重生]" value={outlineForm.selling_points} onChange={(e) => setOutlineForm((s) => ({ ...s, selling_points: e.target.value }))} />
              <label className="outline-label">关键事件</label>
              <textarea id="outline-key-events" className="outline-input" placeholder="如：激励事件、一无所有时刻、高潮。" value={outlineForm.key_events} onChange={(e) => setOutlineForm((s) => ({ ...s, key_events: e.target.value }))} />
              <label className="outline-label">故事节奏</label>
              <textarea id="outline-story-pace" className="outline-input" placeholder="是慢热型还是快节奏爽文" value={outlineForm.story_pace} onChange={(e) => setOutlineForm((s) => ({ ...s, story_pace: e.target.value }))} />
            </div>
            <div className="outline-section">
              <h4>主要世界观</h4>
              <label className="outline-label">世界观描述 <span className="required-mark">*</span></label>
              <textarea id="outline-worldview" className="outline-input" placeholder="故事背景，势力分布，境界设定（武侠、玄幻）......" value={outlineForm.worldview} onChange={(e) => setOutlineForm((s) => ({ ...s, worldview: e.target.value }))} />
            </div>
            <div className="outline-section">
              <h4>核心人物设定</h4>
              <label className="outline-label">主角性格标签 <span className="required-mark">*</span></label>
              <textarea id="outline-protagonist-tags" className="outline-input" placeholder="主角性格标签" value={outlineForm.protagonist_tags} onChange={(e) => setOutlineForm((s) => ({ ...s, protagonist_tags: e.target.value }))} />
              <label className="outline-label">角色动机与欲望</label>
              <textarea id="outline-motivation" className="outline-input" placeholder="角色动机与欲望" value={outlineForm.motivation} onChange={(e) => setOutlineForm((s) => ({ ...s, motivation: e.target.value }))} />
              <label className="outline-label">人物关系图谱</label>
              <textarea id="outline-relations" className="outline-input" placeholder="包含家庭状况和主要关系人物，例如：大家族、边疆小镇" value={outlineForm.relations} onChange={(e) => setOutlineForm((s) => ({ ...s, relations: e.target.value }))} />
              <label className="outline-label">反派的描绘</label>
              <textarea id="outline-antagonist" className="outline-input" placeholder="反派的描绘" value={outlineForm.antagonist} onChange={(e) => setOutlineForm((s) => ({ ...s, antagonist: e.target.value }))} />
              <label className="outline-label">重要伏笔</label>
              <textarea id="outline-foreshadowing" className="outline-input" placeholder="例如：身世之谜" value={outlineForm.foreshadowing} onChange={(e) => setOutlineForm((s) => ({ ...s, foreshadowing: e.target.value }))} />
            </div>
            <div className="outline-section">
              <h4>输出控制参数</h4>
              <label className="outline-label">预期字数 <span className="required-mark">*</span></label>
              <input id="outline-target-words" className="outline-text-input" placeholder="50万/100万/200万......" value={outlineForm.target_words} onChange={(e) => setOutlineForm((s) => ({ ...s, target_words: e.target.value }))} />
              <label className="outline-label">结局偏好 <span className="required-mark">*</span></label>
              <input id="outline-ending-pref" className="outline-text-input" placeholder="好结局、坏结局、开放式结局" value={outlineForm.ending_pref} onChange={(e) => setOutlineForm((s) => ({ ...s, ending_pref: e.target.value }))} />
            </div>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button
              id="outline-generate-confirm-btn"
              className="btn btn-primary"
              type="button"
              onClick={() => {
                if (!outlineGenerating && !outlineFormValid) {
                  ui.addToast("请先填写所有必填项后再生成大纲", "warning");
                  return;
                }
                void generateOutlineFromModal();
              }}
            >
              {outlineGenerating ? (outlinePaused ? "继续" : "暂停") : "生成大纲"}
            </button>
            <button className="btn btn-danger" type="button" disabled={outlineGenerating && !outlinePaused} onClick={() => closeOutlineModal(true)}>取消</button>
          </div>
        </div>
      </div>

      <div id="model-health-modal" className={`modal-overlay ${modelHealthOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setModelHealthOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>模型健康面板</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => setModelHealthOpen(false)}>×</button>
          </div>
          <p className="consistency-summary">最近 N 次调用统计：成功率、平均首字时间、平均总耗时。</p>
          <div className="model-health-table-wrap">
            <table className="model-health-table">
              <thead>
                <tr>
                  <th>引擎</th>
                  <th>模型</th>
                  <th>成功率</th>
                  <th>首字(ms)</th>
                  <th>总耗时(ms)</th>
                  <th>冷却</th>
                </tr>
              </thead>
              <tbody>
                {modelHealthRows.length === 0 ? (
                  <tr><td colSpan={6} className="health-empty">暂无数据</td></tr>
                ) : (
                  modelHealthRows.map((row, idx) => (
                    <tr key={`${row.engine}-${row.model}-${idx}`}>
                      <td>{row.engine}</td>
                      <td>{row.model}</td>
                      <td>{(Number(row.success_rate || 0) * 100).toFixed(1)}%</td>
                      <td>{Math.round(Number(row.avg_first_token_ms || 0))}</td>
                      <td>{Math.round(Number(row.avg_total_ms || 0))}</td>
                      <td>{Math.round(Number(row.cooldown_ms || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" onClick={() => void refreshRuntimeStatus(true)}>刷新</button>
            <button className="btn btn-danger" type="button" onClick={() => setModelHealthOpen(false)}>关闭</button>
          </div>
        </div>
      </div>

      <div id="info-box-modal" className={`modal-overlay ${infoBoxOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) {
          setInfoBoxOpen(false);
          closeInfoContextMenu();
        }
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>信息箱</h3>
            <button className="icon-btn settings-modal-header-icon-btn" type="button" onClick={() => {
              setInfoBoxOpen(false);
              closeInfoContextMenu();
            }}>×</button>
          </div>
          <p className="consistency-summary">仅收集异常信息；点击“复制”或右键可复制单条内容。</p>
          <div id="info-box-list" className="info-box-list">
            {ui.infoItems.length === 0 ? (
              <div className="info-box-empty">暂无异常信息</div>
            ) : (
              [...ui.infoItems].reverse().map((item) => (
                <div
                  className="info-box-item"
                  key={item.id}
                  data-item-id={item.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openInfoContextMenuAt(event.clientX, event.clientY, item.id);
                  }}
                >
                  <div className="info-box-row">
                    <span className="info-box-time">{formatInfoTime(item.createdAt)}</span>
                    <button className="btn btn-primary btn-sm info-box-copy-btn" type="button" onClick={() => void copyInfoBoxItemById(item.id)}>复制</button>
                  </div>
                  <div className="info-box-text">{item.message}</div>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-warning" type="button" onClick={ui.clearInfoItems}>清空</button>
            <button className="btn btn-danger" type="button" onClick={() => {
              setInfoBoxOpen(false);
              closeInfoContextMenu();
            }}>关闭</button>
          </div>
        </div>
      </div>

      <div
        id="personal-model-context-menu"
        className={`context-menu ${modelContextMenu.open ? "" : "hidden"}`}
        style={{ left: modelContextMenu.left, top: modelContextMenu.top }}
      >
        <button id="personal-model-menu-copy" type="button" className="context-menu-item" onClick={() => {
          void handleModelContextCopy();
          closeModelContextMenu();
        }} disabled={!modelMenuCanCopy}>复制</button>
        <button id="personal-model-menu-paste" type="button" className="context-menu-item" onClick={() => {
          void handleModelContextPaste();
          closeModelContextMenu();
        }} disabled={!modelMenuCanPaste}>粘贴</button>
        <button id="personal-model-menu-cut" type="button" className="context-menu-item" onClick={() => {
          void handleModelContextCut();
          closeModelContextMenu();
        }} disabled={!modelMenuCanCut}>剪切</button>
        <button id="personal-model-menu-pin-top" type="button" className={`context-menu-item ${modelContextMenu.showPinTop ? "" : "hidden"}`} onClick={() => {
          handleModelContextPinTop();
          closeModelContextMenu();
        }}>设为置顶模型</button>
      </div>

      <div
        id="info-box-context-menu"
        className={`context-menu ${infoContextMenu.open ? "" : "hidden"}`}
        style={{ left: infoContextMenu.left, top: infoContextMenu.top }}
      >
        <button
          id="info-box-menu-copy"
          type="button"
          className="context-menu-item"
          onClick={() => {
            const itemId = infoContextItemIdRef.current;
            if (itemId != null) {
              void copyInfoBoxItemById(itemId);
            }
            closeInfoContextMenu();
          }}
        >
          复制
        </button>
      </div>

      <ToastStack />
    </>
  );
}

export default App;
