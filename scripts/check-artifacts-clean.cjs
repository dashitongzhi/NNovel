#!/usr/bin/env node

const { execFileSync } = require("node:child_process");

const ARTIFACT_EXTENSIONS = new Set([
  ".asar",
  ".blockmap",
  ".exe",
  ".msi",
  ".nsis",
  ".nupkg",
  ".7z",
  ".zip",
  ".tmp",
]);

const ARTIFACT_FILE_PATTERNS = [/^latest.*\.yml$/i];

const ARTIFACT_DIR_PREFIXES = [
  "release/",
  "out/",
  "build/",
  "electron-dist/",
  "installer/",
  ".cache/",
  ".vite/",
];

function toPosix(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function isArtifactPath(filePath) {
  const normalized = toPosix(filePath).replace(/^\.\//, "");
  const lower = normalized.toLowerCase();

  for (const dir of ARTIFACT_DIR_PREFIXES) {
    const dirLower = dir.toLowerCase();
    if (lower === dirLower.slice(0, -1) || lower.startsWith(dirLower)) {
      return true;
    }
  }

  const name = normalized.split("/").pop() || "";
  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";

  if (ARTIFACT_EXTENSIONS.has(ext)) {
    return true;
  }

  return ARTIFACT_FILE_PATTERNS.some((regex) => regex.test(name));
}

function getUnignoredUntrackedFiles() {
  const output = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

let untracked = [];
try {
  untracked = getUnignoredUntrackedFiles();
} catch (error) {
  console.error("[dist:check] failed to query git untracked files.");
  console.error(error && error.message ? error.message : String(error));
  process.exit(2);
}

const offenders = untracked.filter(isArtifactPath);

if (offenders.length > 0) {
  console.error("[dist:check] found unignored packaging artifacts in repository:");
  for (const file of offenders) {
    console.error(`  - ${file}`);
  }
  console.error("[dist:check] add ignore rules or clean these files before packaging.");
  process.exit(1);
}

console.log("[dist:check] ok: no unignored packaging artifacts in repository.");
