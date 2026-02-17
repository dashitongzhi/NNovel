const { app, BrowserWindow } = require("electron");
const path = require("path");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
const FEATURE_FLAGS = ["CanvasOopRasterization", "UseSkiaRenderer"];
const FORCE_HARDWARE = String(process.env.NNOVEL_FORCE_HARDWARE || "") === "1";
const STRICT_HARDWARE = String(process.env.NNOVEL_STRICT_HARDWARE || "") === "1";
const NO_SANDBOX = String(process.env.NNOVEL_NO_SANDBOX || "") === "1";
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

function buildRendererUrl(baseUrl) {
  const launchUrl = new URL(baseUrl);
  launchUrl.searchParams.set("gpu_mode", rendererGpuHints.mode);
  launchUrl.searchParams.set("gpu_compositing", rendererGpuHints.gpuCompositing);
  launchUrl.searchParams.set("webgl", rendererGpuHints.webgl);
  launchUrl.searchParams.set("opengl", rendererGpuHints.opengl);
  launchUrl.searchParams.set("rasterization", rendererGpuHints.rasterization);
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

let recoveringRenderer = false;
let quittingByUser = false;

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

  win.loadURL(buildRendererUrl(DEV_URL));
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

app.whenReady().then(() => {
  console.log("[electron] force hardware:", FORCE_HARDWARE);
  console.log("[electron] strict hardware:", STRICT_HARDWARE);
  console.log("[electron] no sandbox:", NO_SANDBOX);
  console.log("[electron] angle backend:", ANGLE_BACKEND);
  console.log("[electron] gpu profile:", GPU_PROFILE);
  console.log("[electron] disable-gpu switch:", app.commandLine.hasSwitch("disable-gpu"));
  console.log("[electron] disable-gpu-compositing switch:", app.commandLine.hasSwitch("disable-gpu-compositing"));
  console.log("[electron] disable-software-rasterizer switch:", app.commandLine.hasSwitch("disable-software-rasterizer"));
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

    // complete waits for GPU process to finish init (~320ms)
    app.getGPUInfo("complete").then((info) => {
      const aux = (info && typeof info === "object" && info.auxAttributes) || {};
      console.log("[electron] GPU info (complete) — gl:", aux.glImplementationParts);
      console.log("[electron] GPU info (complete) — renderer:", aux.glRenderer);
      console.log("[electron] GPU info (complete) — skia:", aux.skiaBackendType);
      console.log("[electron] GPU info (complete) — initTime:", aux.initializationTime, "ms");
      console.log("[electron] GPU info (complete) — directComposition:", aux.overlayInfo && aux.overlayInfo.directComposition);

      // Re-check feature status AFTER GPU process is ready
      const gpuStatusLate = app.getGPUFeatureStatus();
      console.log("[electron] GPU feature status (after GPU init):", gpuStatusLate);
      setRendererGpuHints(gpuStatusLate);
    }).catch((err) => {
      console.error("[electron] GPU info (complete) failed:", err);
    });
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quittingByUser = true;
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
