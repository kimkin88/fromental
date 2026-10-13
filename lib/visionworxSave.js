// lib/visionworxSave.js — client helper. No secrets; no-ops without vwx_* params.

function getVisionworxLaunch() {
  if (typeof window === "undefined") return { runId: null, callback: null };
  const params = new URLSearchParams(window.location.search);
  let runId = params.get("vwx_run");
  let callback = params.get("vwx_callback");
  // VisionWorx may pass the callback URL-encoded once or twice.
  if (callback) {
    try {
      callback = decodeURIComponent(callback);
      if (/%[0-9A-Fa-f]{2}/.test(callback)) {
        callback = decodeURIComponent(callback);
      }
    } catch {
      // keep original
    }
  }
  return { runId, callback };
}

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

/** Shrink large PNGs so the Vercel → VisionWorx POST stays under body limits. */
export async function compressImageForVisionworx(dataUrl, filename = "result.jpg") {
  if (typeof document === "undefined") {
    const base64 = String(dataUrl).split(",")[1] || "";
    return {
      data_base64: base64,
      content_type: "image/png",
      filename: filename.replace(/\.jpe?g$/i, ".png"),
    };
  }

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return {
    data_base64: jpegDataUrl.split(",")[1],
    content_type: "image/jpeg",
    filename: filename.replace(/\.[^.]+$/, "") + ".jpg",
  };
}

async function postSave(payload) {
  const response = await fetch("/api/visionworx-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      result.error ||
      result.message ||
      (result.result && (result.result.error || result.result.message)) ||
      `HTTP ${response.status}`;
    throw new Error(String(detail));
  }
  return result;
}

/** Save one file, many files, or a partial batch. No-ops without vwx_* params. */
export async function saveToVisionworx(files, { final = true, metadata } = {}) {
  const { runId, callback } = getVisionworxLaunch();
  if (!runId || !callback) return null;

  const list = Array.isArray(files) ? files : [files];
  const assets = await Promise.all(list.map((file, i) => fileToAsset(file, i)));

  return postSave({ runId, callback, assets, final, metadata });
}

/** Save a generated data-URL image (preferred path for this app). */
export async function saveDataUrlToVisionworx(dataUrl, { final = true, metadata, filename } = {}) {
  const { runId, callback } = getVisionworxLaunch();
  if (!runId || !callback) return null;

  const asset = await compressImageForVisionworx(
    dataUrl,
    filename || `fromental-visualization-${Date.now()}.jpg`,
  );

  return postSave({ runId, callback, assets: [asset], final, metadata });
}

/** Report failure for a VisionWorx-launched run. No-ops without vwx_* params. */
export async function reportVisionworxFailure(errorMessage) {
  const { runId, callback } = getVisionworxLaunch();
  if (!runId || !callback) return null;

  return postSave({
    runId,
    callback,
    status: "failed",
    error: String(errorMessage || "Generation failed"),
  });
}
