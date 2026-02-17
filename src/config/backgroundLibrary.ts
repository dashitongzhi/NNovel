export interface BackgroundItem {
  id: string;
  name: string;
  url: string;
}

const files = import.meta.glob("../../background/*.{jpg,jpeg,png,webp,avif,gif}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function fileNameFromPath(path: string): string {
  const seg = path.split("/");
  return seg[seg.length - 1] || path;
}

function normalizeLabel(fileName: string): string {
  const decoded = decodeURIComponent(fileName);
  return decoded.replace(/\.[^.]+$/, "").trim();
}

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export const BACKGROUND_LIBRARY: BackgroundItem[] = Object.entries(files)
  .map(([path, url]) => {
    const fileName = fileNameFromPath(path);
    return {
      id: fileName,
      name: normalizeLabel(fileName),
      url,
    };
  })
  .sort((a, b) => collator.compare(a.name, b.name));

export const DEFAULT_BACKGROUND_ID = BACKGROUND_LIBRARY[0]?.id || "";
