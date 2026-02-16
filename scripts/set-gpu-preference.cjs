/**
 * Register the Electron binary for "High Performance" GPU preference in Windows.
 *
 * On laptops with hybrid graphics (Intel + NVIDIA), Windows defaults to the
 * integrated GPU. Chromium's `--force_high_performance_gpu` flag alone is often
 * not enough; the OS-level Graphics Performance Preference must also be set.
 *
 * This script writes the registry key that Windows Settings → System → Display
 * → Graphics uses. A reboot or at least a sign-out/sign-in is recommended
 * after running this script for the change to take full effect.
 *
 * Usage:  node scripts/set-gpu-preference.cjs
 *         (must be run from an elevated / admin terminal)
 */

const { execSync } = require("node:child_process");
const path = require("node:path");

const electronPath = path.resolve(__dirname, "..", "node_modules", "electron", "dist", "electron.exe");
const regKey = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
// Value 2 = High Performance GPU
const regValue = "GpuPreference=2;";

console.log("[set-gpu-preference] Electron binary:", electronPath);
console.log("[set-gpu-preference] Registry key:", regKey);
console.log("[set-gpu-preference] Setting GpuPreference=2 (High Performance)...");

try {
  execSync(
    `reg add "${regKey}" /v "${electronPath}" /t REG_SZ /d "${regValue}" /f`,
    { stdio: "inherit" }
  );
  console.log("[set-gpu-preference] Done. Restart Windows or sign out/in for the change to take effect.");
} catch (err) {
  console.error("[set-gpu-preference] Failed:", err.message);
  console.error("[set-gpu-preference] Try running this script from an elevated (admin) terminal.");
  process.exit(1);
}
