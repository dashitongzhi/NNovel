const path = require("node:path");
const { spawn } = require("node:child_process");

const electronBinary = require("electron");
const mainEntry = path.join(__dirname, "main.cjs");

const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174",
};

// Some shells export ELECTRON_RUN_AS_NODE globally, which prevents window launch.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [mainEntry], {
  stdio: "inherit",
  env,
  windowsHide: false,
});

child.on("error", (err) => {
  console.error("[electron-dev] failed to launch:", err);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
