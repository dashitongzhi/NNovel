const { app, BrowserWindow } = require("electron");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";

// Prefer GPU compositing/rasterization for smoother glass effects.
// Keep software fallback enabled (do not disable software rasterizer) for compatibility.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

function createWindow(gpuStatus = null) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "NNovel React",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const targetUrl = new URL(DEV_URL);
  if (gpuStatus && typeof gpuStatus === "object") {
    const gpuCompositing = String(gpuStatus.gpu_compositing || "");
    const webgl = String(gpuStatus.webgl || "");
    const softwareLikely = gpuCompositing.includes("disabled") || webgl.includes("disabled");
    targetUrl.searchParams.set("gpu_mode", softwareLikely ? "software" : "hardware");
    targetUrl.searchParams.set("gpu_compositing", gpuCompositing);
    targetUrl.searchParams.set("webgl", webgl);
  }

  win.loadURL(targetUrl.toString());
}

app.whenReady().then(() => {
  const gpuStatus = app.getGPUFeatureStatus();
  console.log("[electron] GPU feature status:", gpuStatus);
  createWindow(gpuStatus);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(gpuStatus);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
