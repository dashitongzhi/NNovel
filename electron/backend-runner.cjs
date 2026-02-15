const path = require("node:path");
const { spawn } = require("node:child_process");

const runtimeRoot = path.resolve(__dirname, "..");
const nnovelRoot = path.resolve(__dirname, "..", "..", "..", "NNovel");
const backendPort = Number(process.env.NNOVEL_BACKEND_PORT || 5050);
const pythonCode = [
  "import sys",
  `sys.path.insert(0, r'''${nnovelRoot}''')`,
  "import app as nnovel_app",
  `nnovel_app.app.run(host='127.0.0.1', port=${backendPort}, debug=False, use_reloader=False)`,
].join(";");

const baseEnv = {
  ...process.env,
  NNOVEL_RUNTIME_ROOT: runtimeRoot,
};

// Force backend auto-detection instead of inheriting stale/invalid global values.
delete baseEnv.CLAUDE_CODE_GIT_BASH_PATH;

const candidates = [
  { bin: "python", args: ["-c", pythonCode] },
  { bin: "py", args: ["-3", "-c", pythonCode] },
];

function launch(index) {
  if (index >= candidates.length) {
    console.error("[backend-dev] no available python runtime (python/py).");
    process.exit(1);
    return;
  }

  const selected = candidates[index];
  const child = spawn(selected.bin, selected.args, {
    stdio: "inherit",
    env: baseEnv,
    windowsHide: false,
  });

  child.on("error", (error) => {
    if (error && error.code === "ENOENT") {
      launch(index + 1);
      return;
    }
    console.error(`[backend-dev] failed to launch with ${selected.bin}:`, error);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

launch(0);
