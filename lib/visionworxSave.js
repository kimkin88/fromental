// lib/visionworxSave.js — client helper. No secrets; no-ops without vwx_* params.
const params = new URLSearchParams(
  typeof window !== "undefined" ? window.location.search : "",
);
const runId = params.get("vwx_run");
const callback = params.get("vwx_callback");

async function fileToAsset(file, index = 0) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return {
    data_base64: String(dataUrl).split(",")[1],
    content_type: file.type || "image/png",
    filename: file.name || "output-" + (index + 1) + ".png",
  };
}

/** Save one file, many files, or a partial batch. No-ops without vwx_* params. */
export async function saveToVisionworx(files, { final = true, metadata } = {}) {
  if (!runId || !callback) return null;

  const list = Array.isArray(files) ? files : [files];
  const assets = await Promise.all(list.map((file, i) => fileToAsset(file, i)));

  const response = await fetch("/api/visionworx-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, callback, assets, final, metadata }),
  });
  if (!response.ok) throw new Error("VisionWorx rejected the file(s)");
  return response.json();
}

/** Report failure for a VisionWorx-launched run. No-ops without vwx_* params. */
export async function reportVisionworxFailure(errorMessage) {
  if (!runId || !callback) return null;

  const response = await fetch("/api/visionworx-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId,
      callback,
      status: "failed",
      error: String(errorMessage || "Generation failed"),
    }),
  });
  if (!response.ok) throw new Error("VisionWorx rejected the failure report");
  return response.json();
}
