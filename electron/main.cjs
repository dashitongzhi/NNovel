const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
const PROD_INDEX_PATH = path.join(__dirname, "..", "dist", "index.html");
const PROD_URL = pathToFileURL(PROD_INDEX_PATH).toString();
const BACKEND_PORT = Number(process.env.NNOVEL_BACKEND_PORT || 5050);
const BACKEND_SOURCE_FILES = ["app.py", "chapter_manager.py", "codex_engine.py", "config.py", "data_store.py"];
const FEATURE_FLAGS = ["CanvasOopRasterization", "UseSkiaRenderer"];
const FORCE_HARDWARE = String(process.env.NNOVEL_FORCE_HARDWARE || "1") === "1";
const STRICT_HARDWARE = String(process.env.NNOVEL_STRICT_HARDWARE || (FORCE_HARDWARE ? "1" : "0")) === "1";
const NO_SANDBOX = String(process.env.NNOVEL_NO_SANDBOX || (STRICT_HARDWARE ? "1" : "0")) === "1";
const IS_DEV = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEV_KEEPALIVE = String(process.env.NNOVEL_DEV_KEEPALIVE || "") === "1";
const ANGLE_BACKEND = String(process.env.NNOVEL_ANGLE_BACKEND || "d3d11").trim() || "d3d11";
const GPU_PROFILE = String(process.env.NNOVEL_GPU_PROFILE || "balanced").trim().toLowerCase();
const GPU_DIAG = String(process.env.NNOVEL_GPU_DIAG || "") === "1";
const GPU_VERBOSE = String(process.env.NNOVEL_GPU_VERBOSE || "") === "1";
const GPU_DISABLED_HINT = "disabled_software";

let rendererGpuHints = {
  mode: "unknown",
  gpuCompositing: "unknown",
  webgl: "unknown",
  opengl: "unknown",
  rasterization: "unknown",
};

let recoveringRenderer = false;
let quittingByUser = false;
let backendProcess = null;
let preparedBackendDir = "";

function buildPythonCandidates(pythonCode) {
  const explicitBin = String(process.env.NNOVEL_PYTHON_CMD || '').trim();
  const explicitArgsRaw = String(process.env.NNOVEL_PYTHON_ARGS || '').trim();
  const explicitArgs = explicitArgsRaw ? explicitArgsRaw.split(/\s+/).filter(Boolean) : [];

  const candidates = [];
  if (explicitBin) {
    candidates.push({
      bin: explicitBin,
      probeArgs: [...explicitArgs, '--version'],
      args: [...explicitArgs, '-c', pythonCode],
      source: 'env',
    });
  }

  candidates.push(
    { bin: 'python', probeArgs: ['--version'], args: ['-c', pythonCode], source: 'python' },
    { bin: 'py', probeArgs: ['-3', '--version'], args: ['-3', '-c', pythonCode], source: 'py' }
  );

  return candidates;
}

function deriveRendererGpuHints(featureStatus) {
  const gpuCompositing = String((featureStatus && featureStatus.gpu_compositing) || "unknown");
  const webgl = String((featureStatus && featureStatus.webgl) || "unknown");
  const opengl = String((featureStatus && featureStatus.opengl) || "unknown");
  const rasterization = String((featureStatus && featureStatus.rasterization) || "unknown");
  const softwareMode = [gpuCompositing, webgl, opengl, rasterization]
    .some((value) => value.toLowerCase().includes(GPU_DISABLED_HINT));
  return {
    mode: softwareMode ? "software" : "hardware",
    gpuCompositing,
    webgl,
    opengl,
    rasterization,
  };
}

function setRendererGpuHints(featureStatus) {
  rendererGpuHints = deriveRendererGpuHints(featureStatus);
  console.log("[electron] renderer gpu hint:", rendererGpuHints);
}

function getRendererBaseUrl() {
  return IS_DEV ? DEV_URL : PROD_URL;
}

function getRendererQuery() {
  return {
    gpu_mode: rendererGpuHints.mode,
    gpu_compositing: rendererGpuHints.gpuCompositing,
    webgl: rendererGpuHints.webgl,
    opengl: rendererGpuHints.opengl,
    rasterization: rendererGpuHints.rasterization,
  };
}

function buildRendererUrl(baseUrl) {
  const launchUrl = new URL(baseUrl);
  const query = getRendererQuery();
  for (const [key, value] of Object.entries(query)) {
    launchUrl.searchParams.set(key, String(value));
  }
  return launchUrl.toString();
}

function appendFeatureFlags(flags) {
  const current = String(app.commandLine.getSwitchValue("enable-features") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...current, ...flags]));
  if (merged.length) {
    app.commandLine.appendSwitch("enable-features", merged.join(","));
  }
}

function ensurePackagedBackendSources(writableRoot) {
  const runtimeTempRoot = path.join(writableRoot, "tmp");
  fs.mkdirSync(runtimeTempRoot, { recursive: true });

  const backendRoot = path.join(runtimeTempRoot, `backend-${process.pid}`);
  fs.rmSync(backendRoot, { recursive: true, force: true });
  fs.mkdirSync(backendRoot, { recursive: true });

  const sourceRoot = path.join(__dirname, "..");
  for (const file of BACKEND_SOURCE_FILES) {
    const sourcePath = path.join(sourceRoot, file);
    const targetPath = path.join(backendRoot, file);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`missing backend source file: ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, targetPath);
  }

  return backendRoot;
}
function startBackendIfNeeded() {
  if (IS_DEV) return true;
  if (backendProcess) return true;

  const resourcesRoot = process.resourcesPath;
  const writableRoot = path.join(app.getPath("userData"), "runtime");

  let backendRoot = "";
  try {
    backendRoot = ensurePackagedBackendSources(writableRoot);
    preparedBackendDir = backendRoot;
  } catch (error) {
    console.error("[electron] failed to prepare packaged backend sources:", error);
    dialog.showErrorBox("启动失败", "无法准备后端运行文件，请重新安装 NNovel。");
    return false;
  }

  const pythonCode = [
    "import sys",
    `sys.path.insert(0, r'''${backendRoot}''')`,
    "import app as nnovel_app",
    `nnovel_app.app.run(host='127.0.0.1', port=${BACKEND_PORT}, debug=False, use_reloader=False)`,
  ].join(";");

  const baseEnv = {
    ...process.env,
    NNOVEL_RUNTIME_ROOT: writableRoot,
    NNOVEL_BACKEND_PORT: String(BACKEND_PORT),
    NNOVEL_RESOURCES_ROOT: resourcesRoot,
  };
  delete baseEnv.CLAUDE_CODE_GIT_BASH_PATH;

  const candidates = buildPythonCandidates(pythonCode);

  let selected = null;
  for (const c of candidates) {
    try {
      const probe = spawnSync(c.bin, c.probeArgs, { stdio: 'ignore', windowsHide: true });
      if (!probe.error && probe.status === 0) {
        selected = c;
        break;
      }
    } catch {
      // continue probing
    }
  }

  if (!selected) {
    dialog.showErrorBox(
      "缺少 Python 运行时",
      "未检测到 Python（python/py）。请先安装 Python 3.10+ 后再启动 NNovel。"
    );
    return false;
  }

  console.log('[electron] selected python candidate:', selected.source || selected.bin, selected.bin, selected.args.join(' '));

  backendProcess = spawn(selected.bin, selected.args, {
    stdio: "inherit",
    env: baseEnv,
    windowsHide: true,
  });

  backendProcess.on("error", (error) => {
    console.error("[electron] backend process launch failed:", error);
  });

  backendProcess.on("exit", (code) => {
    if (!quittingByUser) {
      console.error("[electron] backend process exited:", code);
    }
    backendProcess = null;
    cleanupPreparedBackendDir();
  });

  return true;
}

function cleanupPreparedBackendDir() {
  if (!preparedBackendDir) return;
  try {
    fs.rmSync(preparedBackendDir, { recursive: true, force: true });
  } catch (err) {
    console.error("[electron] failed to cleanup backend runtime dir:", err);
  }
  preparedBackendDir = "";
}

function stopBackendIfRunning() {
  if (!backendProcess || backendProcess.killed) return;
  try {
    backendProcess.kill();
  } catch (err) {
    console.error("[electron] failed to stop backend:", err);
  }
  cleanupPreparedBackendDir();
}

// ── Verbose GPU logging ──────────────────────────────────────────────
// NNOVEL_GPU_VERBOSE=1 enables Chromium-level GPU init logging.
// Logs go to <project>/gpu-debug.log AND stderr.
if (GPU_VERBOSE) {
  const logPath = path.join(__dirname, "..", "gpu-debug.log");
  app.commandLine.appendSwitch("enable-logging");
  app.commandLine.appendSwitch("log-file", logPath);
  app.commandLine.appendSwitch("v", "1");
  // GPU-specific verbose categories
  app.commandLine.appendSwitch("vmodule",
    "gpu_process_host=3," +
    "gpu_init=3," +
    "angle*=3," +
    "gl_surface*=3," +
    "gpu_channel*=2," +
    "gpu_data_manager*=2," +
    "gpu_feature_info=2," +
    "gpu_info_collector*=3," +
    "command_buffer*=2," +
    "d3d*=3," +
    "egl*=3," +
    "viz_compositor*=2," +
    "display_compositor*=2"
  );
  console.log("[electron] GPU verbose logging enabled → " + logPath);
}

// liquid-glass-react uses SVG filters + CSS backdrop-filter (NOT WebGL).
// GPU compositing is what matters for performance. Request the discrete GPU
// on Optimus/hybrid laptops so Chromium composits on the NVIDIA GPU.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("use-angle", ANGLE_BACKEND);
app.commandLine.appendSwitch("force_high_performance_gpu");

// When NNOVEL_NO_SANDBOX=1, disable the GPU sandbox.  On some systems
// (especially hybrid GPU laptops) the Electron sandbox prevents D3D11
// device creation, causing ANGLE to fail with gl=none,angle=none while
// Chrome (which has a more relaxed sandbox) works fine.
if (NO_SANDBOX) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}

if (GPU_PROFILE !== "compat") {
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
  appendFeatureFlags(FEATURE_FLAGS);
}
if (FORCE_HARDWARE && STRICT_HARDWARE) {
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.disableDomainBlockingFor3DAPIs();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "NNovel React",
    show: false,
    backgroundColor: "#0b111c",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (IS_DEV) {
    win.loadURL(buildRendererUrl(getRendererBaseUrl()));
  } else {
    win.loadFile(PROD_INDEX_PATH, { query: getRendererQuery() });
  }
  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] render-process-gone:", details);
    recoveringRenderer = true;
    if (!win.isDestroyed()) {
      win.destroy();
    }
    setTimeout(() => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
      recoveringRenderer = false;
    }, 260);
  });

  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error("[electron] did-fail-load:", code, description);
  });
}

async function initializeGpuState() {
  const gpuStatusEarly = app.getGPUFeatureStatus();
  console.log("[electron] GPU feature status (early):", gpuStatusEarly);
  setRendererGpuHints(gpuStatusEarly);

  if (GPU_DIAG || GPU_VERBOSE) {
    // basic returns immediately (before GPU process init)
    app.getGPUInfo("basic").then((info) => {
      const aux = (info && typeof info === "object" && info.auxAttributes) || {};
      const devices = (info && typeof info === "object" && Array.isArray(info.gpuDevice)) ? info.gpuDevice : [];
      console.log("[electron] GPU info (basic):", JSON.stringify({
        auxAttributes: aux,
        gpuDevice: devices.map((d) => ({
          vendorId: d.vendorId,
          deviceId: d.deviceId,
          vendorString: d.vendorString,
          deviceString: d.deviceString,
          active: d.active,
        })),
      }, null, 2));
    }).catch((err) => {
      console.error("[electron] GPU info (basic) failed:", err);
    });
  }

  // Wait for GPU process to fully initialize before creating the renderer window.
  try {
    const info = await app.getGPUInfo("complete");
    const aux = (info && typeof info === "object" && info.auxAttributes) || {};
    console.log("[electron] GPU info (complete) — gl:", aux.glImplementationParts);
    console.log("[electron] GPU info (complete) — renderer:", aux.glRenderer);
    console.log("[electron] GPU info (complete) — skia:", aux.skiaBackendType);
    console.log("[electron] GPU info (complete) — initTime:", aux.initializationTime, "ms");
    console.log("[electron] GPU info (complete) — directComposition:", aux.overlayInfo && aux.overlayInfo.directComposition);
  } catch (err) {
    console.error("[electron] GPU info (complete) failed:", err);
  }

  const gpuStatusLate = app.getGPUFeatureStatus();
  console.log("[electron] GPU feature status (after GPU init):", gpuStatusLate);
  setRendererGpuHints(gpuStatusLate);
}

app.whenReady().then(async () => {
  console.log("[electron] force hardware:", FORCE_HARDWARE);
  console.log("[electron] strict hardware:", STRICT_HARDWARE);
  console.log("[electron] no sandbox:", NO_SANDBOX);
  console.log("[electron] angle backend:", ANGLE_BACKEND);
  console.log("[electron] gpu profile:", GPU_PROFILE);
  console.log("[electron] is dev:", IS_DEV);
  console.log("[electron] renderer base:", getRendererBaseUrl());
  console.log("[electron] disable-gpu switch:", app.commandLine.hasSwitch("disable-gpu"));
  console.log("[electron] disable-gpu-compositing switch:", app.commandLine.hasSwitch("disable-gpu-compositing"));
  console.log("[electron] disable-software-rasterizer switch:", app.commandLine.hasSwitch("disable-software-rasterizer"));
  await initializeGpuState();
  if (FORCE_HARDWARE && STRICT_HARDWARE && rendererGpuHints.mode !== "hardware") {
    console.error("[electron] strict hardware requested but renderer is still software; aborting launch.");
    app.quit();
    return;
  }
  if (!startBackendIfNeeded()) {
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quittingByUser = true;
  stopBackendIfRunning();
});

app.on("will-quit", () => {
  stopBackendIfRunning();
});

app.on("window-all-closed", () => {
  if (recoveringRenderer) return;
  if (process.platform === "darwin") return;
  if (IS_DEV && DEV_KEEPALIVE && !quittingByUser) {
    setTimeout(() => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    }, 260);
    return;
  }
  app.quit();
});
