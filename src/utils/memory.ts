export interface MemoryEntry {
  key: string;
  type: string;
  name: string;
  summary: string;
}

export interface MemoryDiff {
  added: MemoryEntry[];
  replaced: Array<MemoryEntry & { oldSummary: string }>;
  unchanged: MemoryEntry[];
}

const memoryRegex = /^\s*([^|｜]+)\s*[|｜]\s*([^|｜]+)\s*[|｜]\s*(.+?)\s*$/u;

function parseMemory(input: string): Map<string, MemoryEntry> {
  const map = new Map<string, MemoryEntry>();
  const lines = String(input || "").split("\n");
  for (const line of lines) {
    const match = line.match(memoryRegex);
    if (!match) continue;
    const type = match[1].trim();
    const name = match[2].trim();
    const summary = match[3].trim();
    const key = `${type}|${name}`;
    map.set(key, { key, type, name, summary });
  }
  return map;
}

export function diffMemory(oldText: string, newText: string): MemoryDiff {
  const before = parseMemory(oldText);
  const after = parseMemory(newText);
  const added: MemoryEntry[] = [];
  const replaced: Array<MemoryEntry & { oldSummary: string }> = [];
  const unchanged: MemoryEntry[] = [];

  after.forEach((next, key) => {
    const prev = before.get(key);
    if (!prev) {
      added.push(next);
      return;
    }
    if (prev.summary !== next.summary) {
      replaced.push({ ...next, oldSummary: prev.summary });
      return;
    }
    unchanged.push(next);
  });

  return { added, replaced, unchanged };
}
