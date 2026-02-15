export async function uploadTxt(target: "outline" | "reference", file: File): Promise<{ ok: boolean; content: string }> {
  const formData = new FormData();
  formData.append("target", target);
  formData.append("file", file);

  const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
  const url = apiBase
    ? `${apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase}/api/upload-file`
    : "/api/upload-file";

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "文件上传失败");
  }
  return payload as { ok: boolean; content: string };
}
