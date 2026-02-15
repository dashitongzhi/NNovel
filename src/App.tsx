import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { DraftPanel } from "@/components/layout/DraftPanel";
import { GenerationPanel } from "@/components/layout/GenerationPanel";
import { DiscardedPanel } from "@/components/layout/DiscardedPanel";
import { ModalHost } from "@/components/modals/ModalHost";
import { ToastStack } from "@/components/shared/ToastStack";
import { ConfigSelect } from "@/components/shared/ConfigSelect";
import { useConfigStore } from "@/stores/configStore";
import { useDraftStore } from "@/stores/draftStore";
import { useGenerationStore } from "@/stores/generationStore";
import { useDiscardedStore } from "@/stores/discardedStore";
import { useUiStore, type ThemeMode } from "@/stores/uiStore";
import { diffMemory } from "@/utils/memory";
import { generateChapterTitle, saveChapter } from "@/services/endpoints/chapter";
import { generateOutline } from "@/services/endpoints/outline";
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
import type { BookshelfPayload, ConsistencyConflict, ModelHealthRow, StartupStatus } from "@/types/domain";

function statusText(stage: string, thinking: string): string {
  if (stage === "queued") return "排队中";
  if (stage === "generating") return thinking || "AI 正在创作...";
  if (stage === "finishing") return "收尾中";
  if (stage === "completed") return "生成完成";
  if (stage === "paused") return "已暂停";
  if (stage === "error") return "状态异常";
  if (stage === "stopped") return "已停止";
  return thinking || "就绪";
}

const CACHE_BOX_ENABLED_KEY = "writer:cacheBoxEnabled";
const CACHE_BOX_EXPANDED_KEY = "writer:cacheBoxExpanded";
const STAGE_TIMELINE_ENABLED_KEY = "writer:stageTimelineEnabled";

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

function App() {
  const configStore = useConfigStore();
  const draftStore = useDraftStore();
  const generation = useGenerationStore();
  const discarded = useDiscardedStore();
  const ui = useUiStore();

  const [chapterTitleOpen, setChapterTitleOpen] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterSaving, setChapterSaving] = useState(false);

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

  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineGenerating, setOutlineGenerating] = useState(false);
  const [outlineForm, setOutlineForm] = useState<OutlineFormState>(EMPTY_OUTLINE_FORM);

  const [modelHealthOpen, setModelHealthOpen] = useState(false);
  const [modelHealthRows, setModelHealthRows] = useState<ModelHealthRow[]>([]);
  const [infoBoxOpen, setInfoBoxOpen] = useState(false);
  const [connectivityTesting, setConnectivityTesting] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<StartupStatus | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const raw = String(localStorage.getItem("theme") || "auto").trim().toLowerCase();
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
    return "auto";
  });

  const [cacheEnabled, setCacheEnabled] = useState(() => readBoolSetting(CACHE_BOX_ENABLED_KEY, true));
  const [cacheExpanded, setCacheExpanded] = useState(() => readBoolSetting(CACHE_BOX_EXPANDED_KEY, true));
  const [stageTimelineEnabled, setStageTimelineEnabled] = useState(() => readBoolSetting(STAGE_TIMELINE_ENABLED_KEY, true));

  const [tick, setTick] = useState(Date.now());

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
        } else if (status.codex_available === false) {
          ui.addToast("未检测到 ChatGPT(codex) 可执行文件，请确保 codex 已安装并在 PATH 中", "error");
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
      const recovery = await generation.detectRecovery();
      if (recovery?.recoverable && !recovery.live_task) {
        ui.addToast("检测到异常中断任务，点击开始写作可续写", "warning");
      }
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
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => ui.syncTheme();
    media.addEventListener("change", onMedia);
    return () => media.removeEventListener("change", onMedia);
  }, [ui.theme]);

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

  useEffect(() => {
    if (configStore.config.first_run_required) {
      setBookshelfOpen(true);
      void reloadBookshelf();
    }
  }, [configStore.config.first_run_required]);

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

  const personalModelRows = useMemo(
    () => normalizeModelList(configStore.config.personal_models, "deepseek-ai/deepseek-v3.2"),
    [configStore.config.personal_models],
  );
  const doubaoModelRows = useMemo(
    () => normalizeModelList(configStore.config.doubao_models, "doubao-seed-1-6-251015"),
    [configStore.config.doubao_models],
  );

  const toolbarStatusOverride = useMemo<"" | "就绪" | "异常" | "成功">(() => {
    if (generation.stage === "error") return "异常";
    if (generation.stage === "completed") return "就绪";
    if ((generation.stage === "generating" || generation.stage === "finishing") && generation.generatedText.trim()) return "成功";
    return "";
  }, [generation.stage, generation.generatedText]);

  const personalConfigReady = useMemo(() => {
    if (runtimeStatus) return runtimeStatus.personal_ready !== false;
    return Boolean(String(configStore.config.personal_base_url || "").trim() && String(configStore.config.personal_api_key || "").trim());
  }, [runtimeStatus, configStore.config.personal_base_url, configStore.config.personal_api_key]);

  const handleStartStop = async (): Promise<void> => {
    if (generation.isWriting) {
      await generation.stop();
      return;
    }
    try {
      const chapters = await listChapters();
      const chapterCount = Array.isArray(chapters) ? chapters.length : 0;
      const hasCache = Boolean(String(configStore.config.cache || "").trim());
      generation.setReferenceStatus(chapterCount > 0 || hasCache ? "已加载提要" : "首次创作");
    } catch {
      generation.setReferenceStatus("");
    }
    if (generation.recoveryInfo?.recoverable) {
      const resumed = await generation.resumeRecovery();
      if (resumed) {
        ui.addToast("已从中断点恢复写作", "success");
        return;
      }
    }
    await generation.start(configStore.config);
  };

  const handleSaveConfig = async (): Promise<void> => {
    await configStore.save();
    try {
      await saveProxyPort(configStore.config.proxy_port || "10808");
    } catch {
      // ignore proxy sync failure here
    }
    await refreshRuntimeStatus(true);
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
    const current = preferred.trim() || normalized[0] || "";
    configStore.patch({
      personal_models: normalized.join("\n"),
      personal_model: normalized.includes(current) ? current : (normalized[0] || ""),
    });
  };

  const updateDoubaoModels = (rows: string[], preferred = ""): void => {
    const normalized = normalizeModelList(rows.join("\n"), "doubao-seed-1-6-251015");
    const current = preferred.trim() || normalized[0] || "";
    configStore.patch({
      doubao_models: normalized.join("\n"),
      doubao_model: normalized.includes(current) ? current : (normalized[0] || ""),
    });
  };

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
    const content = draftStore.content;
    if (!content || content.trim().length < 10) {
      ui.addToast("草稿内容太少，无法分章", "error");
      return;
    }
    try {
      const payload = await generateChapterTitle(content);
      setChapterTitle(payload.title || "新章节");
      setChapterTitleOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成标题失败";
      ui.addToast(`生成标题失败: ${message}`, "error");
    }
  };

  const handleConfirmChapterSave = async (): Promise<void> => {
    if (!chapterTitle.trim()) {
      ui.addToast("标题不能为空", "error");
      return;
    }
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
      setChapterTitleOpen(false);
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

  const saveDoubaoConfigFromModal = async (): Promise<void> => {
    await handleSaveConfig();
    setDoubaoSettingsOpen(false);
  };

  const savePersonalConfigFromModal = async (): Promise<void> => {
    await handleSaveConfig();
    setPersonalConfigOpen(false);
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

  const openChapterIntoDraft = async (chapterId: number): Promise<void> => {
    try {
      const payload = await getChapter(chapterId);
      draftStore.setContent(String(payload.content || ""));
      setChaptersOpen(false);
      ui.addToast("章节内容已载入草稿箱", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取章节失败";
      ui.addToast(`读取章节失败: ${message}`, "error");
    }
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

  const generateOutlineFromModal = async (): Promise<void> => {
    const missing = OUTLINE_REQUIRED_FIELDS.find((x) => !String(outlineForm[x] || "").trim());
    if (missing) {
      ui.addToast("请先填写大纲必填字段", "error");
      return;
    }
    setOutlineGenerating(true);
    try {
      const prompt = buildOutlineSeed(outlineForm);
      const payload = await generateOutline({ ...configStore.config, outline: prompt });
      const nextOutline = String(payload.outline || "").trim();
      configStore.patch({ outline: nextOutline || prompt });
      setOutlineOpen(false);
      ui.addToast("大纲生成完成", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成大纲失败";
      ui.addToast(`生成大纲失败: ${message}`, "error");
    } finally {
      setOutlineGenerating(false);
    }
  };

  const runSelfCheck = async (auto = false): Promise<void> => {
    if (!auto) setSelfCheckOpen(true);
    setSelfCheckLoading(true);
    setSelfCheckSummary("正在检测环境，请稍候...");
    setSelfCheckRows([]);
    try {
      const payload = await getSelfCheck();
      const checks = Array.isArray(payload.checks) ? payload.checks : [];
      const requiredSet = new Set(Array.isArray(payload.required_ids) ? payload.required_ids.map((x) => String(x || "")) : []);
      const rows: SelfCheckRowView[] = checks.map((item) => {
        const id = String(item.id || "");
        return {
          id,
          label: String(item.name || item.label || id || "检查项"),
          ok: Boolean(item.ok),
          detail: String(item.detail || ""),
          required: requiredSet.has(id),
        };
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
      setSelfCheckRows([{ id: "self_check_api", label: "自检接口", ok: false, detail: message, required: true }]);
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

  return (
    <>
      <div id="app" className={ui.sidebarCollapsed ? "sidebar-collapsed" : ""}>
        <Sidebar
          config={configStore.config}
          saving={configStore.saving}
          isWriting={generation.isWriting}
          personalConfigReady={personalConfigReady}
          onPatch={configStore.patch}
          onSave={() => void handleSaveConfig()}
          onStartStop={() => void handleStartStop()}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPersonalConfig={() => {
            setPersonalConfigOpen(true);
          }}
          onImportFile={(target, file) => void handleImportFile(target, file)}
        />

        <main id="center-area">
          <Toolbar
            sidebarCollapsed={ui.sidebarCollapsed}
            discardedVisible={discarded.visible}
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
              configStore.patch({ engine_mode: mode });
              void refreshRuntimeStatus(true);
              ui.addToast(`已切换模型：${mode === "personal" ? "个人配置" : mode === "doubao" ? "Doubao" : mode === "claude" ? "Claude" : mode === "gemini" ? "Gemini" : "ChatGPT"}`, "success");
              if (mode === "personal") {
                setPersonalConfigOpen(true);
              }
            }}
          />

          <DiscardedPanel
            visible={discarded.visible}
            items={discarded.items}
            onRestore={(id) => void restoreDiscarded(id)}
            onDelete={(id) => void discarded.remove(id)}
          />

          <section id="writing-desk">
            <DraftPanel
              content={draftStore.content}
              loading={chapterSaving}
              cacheEnabled={cacheEnabled}
              cacheExpanded={cacheEnabled && cacheExpanded}
              onChange={draftStore.setContent}
              onSplitChapter={() => void handleSplitChapter()}
              onToggleCache={() => {
                if (!cacheEnabled) return;
                setCacheExpanded((prev) => !prev);
              }}
            />

            <GenerationPanel
              stage={generation.stage}
              stageDurations={stageDurations}
              statusText={statusText(generation.stage, generation.thinking)}
              thinkingText={generation.thinking}
              generatedText={generation.generatedText}
              referenceStatus={generation.referenceStatus}
              stageTimelineEnabled={stageTimelineEnabled}
              isWriting={generation.isWriting}
              isPaused={generation.isPaused}
              skipVisible={generation.skipVisible}
              autoScroll={generation.autoScroll}
              onStartStop={() => void handleStartStop()}
              onPauseResume={() => void generation.togglePause()}
              onSkip={generation.skipTypewriter}
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
              <div className="theme-options">
                <label className="theme-option">
                  <input type="radio" name="theme" value="light" checked={themeMode === "light"} onChange={() => setThemeMode("light")} />
                  <span className="theme-label">☀️ 浅色模式</span>
                </label>
                <label className="theme-option">
                  <input type="radio" name="theme" value="dark" checked={themeMode === "dark"} onChange={() => setThemeMode("dark")} />
                  <span className="theme-label">🌙 深色模式</span>
                </label>
                <label className="theme-option">
                  <input type="radio" name="theme" value="auto" checked={themeMode === "auto"} onChange={() => setThemeMode("auto")} />
                  <span className="theme-label">💻 跟随系统</span>
                </label>
              </div>
              <p className="settings-desc">选择界面的外观风格，"跟随系统"将自动匹配您的操作系统设置。</p>
            </div>

            <div className="settings-section">
              <h4>生成区设置</h4>
              <div className="settings-row">
                <label htmlFor="typewriter-speed" className="settings-label">打字机速度</label>
                <div className="settings-control">
                  <input
                    id="typewriter-speed"
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={Math.max(10, Math.min(80, generation.typewriterSpeed))}
                    onChange={(e) => generation.setTypewriterSpeed(Number(e.target.value || 30))}
                  />
                  <span id="typewriter-speed-value" className="settings-value">{Math.max(10, Math.min(80, generation.typewriterSpeed))}ms/字</span>
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
              <button id="doubao-config-btn" className="settings-entry-btn" type="button" onClick={() => setDoubaoSettingsOpen(true)}>
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

      <div id="assist-settings-modal" className={`modal-overlay ${assistSettingsOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setAssistSettingsOpen(false);
      }}>
        <div className="modal-content settings-modal-content">
          <div className="modal-header">
            <h3>辅助功能</h3>
            <button className="icon-btn" type="button" onClick={() => setAssistSettingsOpen(false)}>×</button>
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
              <p className="settings-desc">关闭后将隐藏对应界面模块，不影响实际写作生成流程。</p>
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
            <button className="icon-btn" type="button" onClick={() => setAccessSettingsOpen(false)}>×</button>
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
            <button className="icon-btn" type="button" onClick={() => setDoubaoSettingsOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">当前模型</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.doubao_model || doubaoModelRows[0] || ""}
                    onChange={(value) => configStore.patch({ doubao_model: value })}
                    options={doubaoModelRows.map((x) => ({ value: x, label: x }))}
                  />
                </div>
              </div>
              <div className="settings-row">
                <label className="settings-label">模型ID列表</label>
                <div className="settings-control">
                  <textarea
                    className="outline-input"
                    style={{ minHeight: 180 }}
                    value={configStore.config.doubao_models}
                    onChange={(e) => {
                      const models = normalizeModelList(e.target.value, "doubao-seed-1-6-251015");
                      updateDoubaoModels(models, configStore.config.doubao_model || "");
                    }}
                  />
                </div>
              </div>
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
              <p className="settings-desc">支持增减模型 ID。首位模型为默认使用模型，失败时按从上到下自动切换。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" type="button" onClick={() => void saveDoubaoConfigFromModal()}>保存并应用</button>
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
            <button className="icon-btn" type="button" onClick={() => setPersonalConfigOpen(false)}>×</button>
          </div>
          <div className="settings-modal-scroll">
            <div className="settings-section">
              <div className="settings-row">
                <label className="settings-label">当前模型</label>
                <div className="settings-control">
                  <ConfigSelect
                    value={configStore.config.personal_model || personalModelRows[0] || ""}
                    onChange={(value) => configStore.patch({ personal_model: value })}
                    options={personalModelRows.map((x) => ({ value: x, label: x }))}
                  />
                </div>
              </div>
              <div className="settings-row">
                <label className="settings-label">模型ID列表</label>
                <div className="settings-control">
                  <textarea
                    className="outline-input"
                    style={{ minHeight: 180 }}
                    value={configStore.config.personal_models}
                    onChange={(e) => {
                      const models = normalizeModelList(e.target.value, "deepseek-ai/deepseek-v3.2");
                      updatePersonalModels(models, configStore.config.personal_model || "");
                    }}
                  />
                </div>
              </div>
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
            <button className="btn btn-primary" type="button" onClick={() => void savePersonalConfigFromModal()}>保存并应用</button>
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
            <button className="icon-btn" type="button" onClick={() => setSettingsEditorOpen(false)}>×</button>
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
            <button className="icon-btn" type="button" onClick={() => setAuthEditorOpen(false)}>×</button>
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
        if (e.target === e.currentTarget && !configStore.config.first_run_required) setBookshelfOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>书架</h3>
            <button className="icon-btn" type="button" onClick={() => setBookshelfOpen(false)} disabled={Boolean(configStore.config.first_run_required)}>×</button>
          </div>
          <p className="consistency-summary">每本书会在独立文件夹中保存，大纲、草稿、章节互相隔离。</p>
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
                  <div className="consistency-item" key={book.id} style={{ marginBottom: 8 }}>
                    <div className="consistency-head" style={{ color: active ? "var(--success)" : "var(--text-primary)" }}>
                      {book.title}
                    </div>
                    <div className="consistency-line">{book.folder || ""}</div>
                    <div className="modal-actions" style={{ marginTop: 10 }}>
                      <button className={`btn ${active ? "btn-success" : "btn-primary"}`} type="button" disabled={active} onClick={() => void switchBookAction(book.id)}>
                        {active ? "当前书籍" : "切换到此书"}
                      </button>
                    </div>
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
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>章节管理</h3>
            <button className="icon-btn" type="button" onClick={() => setChaptersOpen(false)}>×</button>
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
                <div key={chapter.id} className="consistency-item">
                  <div className="consistency-head">#{chapter.id} · {chapter.title || "未命名章节"}</div>
                  <div className="consistency-line">{chapter.created_at || ""} · {chapter.char_count || 0}字</div>
                  <div className="modal-actions" style={{ marginTop: 10 }}>
                    <button className="btn btn-primary" type="button" onClick={() => void openChapterIntoDraft(chapter.id)}>载入草稿箱</button>
                    <button className="btn btn-danger" type="button" onClick={() => void deleteChapterItem(chapter.id)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div id="outline-modal" className={`modal-overlay ${outlineOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setOutlineOpen(false);
      }}>
        <div className="modal-content outline-modal-content">
          <div className="modal-header">
            <h3>生成大纲</h3>
            <button className="icon-btn" type="button" onClick={() => setOutlineOpen(false)}>×</button>
          </div>
          <div className="outline-modal-body">
            <div className="outline-section">
              <h4>小说框架</h4>
              <label className="outline-label">总体流程 *</label>
              <textarea className="outline-input" value={outlineForm.overall_flow} onChange={(e) => setOutlineForm((s) => ({ ...s, overall_flow: e.target.value }))} />
              <label className="outline-label">主要卖点</label>
              <textarea className="outline-input" value={outlineForm.selling_points} onChange={(e) => setOutlineForm((s) => ({ ...s, selling_points: e.target.value }))} />
              <label className="outline-label">关键事件</label>
              <textarea className="outline-input" value={outlineForm.key_events} onChange={(e) => setOutlineForm((s) => ({ ...s, key_events: e.target.value }))} />
              <label className="outline-label">故事节奏</label>
              <textarea className="outline-input" value={outlineForm.story_pace} onChange={(e) => setOutlineForm((s) => ({ ...s, story_pace: e.target.value }))} />
            </div>
            <div className="outline-section">
              <h4>世界观与人物</h4>
              <label className="outline-label">世界观描述 *</label>
              <textarea className="outline-input" value={outlineForm.worldview} onChange={(e) => setOutlineForm((s) => ({ ...s, worldview: e.target.value }))} />
              <label className="outline-label">主角性格标签 *</label>
              <textarea className="outline-input" value={outlineForm.protagonist_tags} onChange={(e) => setOutlineForm((s) => ({ ...s, protagonist_tags: e.target.value }))} />
              <label className="outline-label">角色动机与欲望</label>
              <textarea className="outline-input" value={outlineForm.motivation} onChange={(e) => setOutlineForm((s) => ({ ...s, motivation: e.target.value }))} />
              <label className="outline-label">人物关系图谱</label>
              <textarea className="outline-input" value={outlineForm.relations} onChange={(e) => setOutlineForm((s) => ({ ...s, relations: e.target.value }))} />
              <label className="outline-label">反派描绘</label>
              <textarea className="outline-input" value={outlineForm.antagonist} onChange={(e) => setOutlineForm((s) => ({ ...s, antagonist: e.target.value }))} />
              <label className="outline-label">重要伏笔</label>
              <textarea className="outline-input" value={outlineForm.foreshadowing} onChange={(e) => setOutlineForm((s) => ({ ...s, foreshadowing: e.target.value }))} />
            </div>
            <div className="outline-section">
              <h4>输出参数</h4>
              <label className="outline-label">预期字数 *</label>
              <input className="outline-text-input" value={outlineForm.target_words} onChange={(e) => setOutlineForm((s) => ({ ...s, target_words: e.target.value }))} />
              <label className="outline-label">结局偏好 *</label>
              <input className="outline-text-input" value={outlineForm.ending_pref} onChange={(e) => setOutlineForm((s) => ({ ...s, ending_pref: e.target.value }))} />
            </div>
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" disabled={outlineGenerating} onClick={() => void generateOutlineFromModal()}>
              {outlineGenerating ? "生成中..." : "生成大纲"}
            </button>
            <button className="btn btn-danger" type="button" onClick={() => setOutlineOpen(false)}>取消</button>
          </div>
        </div>
      </div>

      <div id="model-health-modal" className={`modal-overlay ${modelHealthOpen ? "" : "hidden"}`} onClick={(e) => {
        if (e.target === e.currentTarget) setModelHealthOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>模型健康面板</h3>
            <button className="icon-btn" type="button" onClick={() => setModelHealthOpen(false)}>×</button>
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
        if (e.target === e.currentTarget) setInfoBoxOpen(false);
      }}>
        <div className="modal-content consistency-modal-content">
          <div className="modal-header">
            <h3>信息箱</h3>
            <button className="icon-btn" type="button" onClick={() => setInfoBoxOpen(false)}>×</button>
          </div>
          <p className="consistency-summary">仅收集异常信息。</p>
          <div className="info-box-list">
            {ui.infoItems.length === 0 ? (
              <div className="info-box-empty">暂无异常信息</div>
            ) : (
              [...ui.infoItems].reverse().map((item) => (
                <div className="consistency-item" key={item.id}>
                  <div className="consistency-head">#{item.id}</div>
                  <div className="consistency-line">{item.message}</div>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button className="btn btn-warning" type="button" onClick={ui.clearInfoItems}>清空</button>
            <button className="btn btn-danger" type="button" onClick={() => setInfoBoxOpen(false)}>关闭</button>
          </div>
        </div>
      </div>

      <ToastStack />
    </>
  );
}

export default App;

