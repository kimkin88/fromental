import crypto from "crypto";

// api/visionworx-save.js — server-only VisionWorx callback (Express locally, Vercel serverless in prod).
// Secrets stay here. Never put VWX_SECRET in browser code.

const DEFAULT_CALLBACK_HOSTS = ["www.vision-worx.com", "vision-worx.com"];

function env(name) {
  const value = process.env[name];
  return value == null ? "" : String(value).trim();
}

/** Production VisionWorx hosts + Vercel preview/staging deployments. */
function isAllowedCallbackHost(host) {
  const configured = normalizeHost(env("VWX_APP_HOST"));
  if (configured) return host === configured;
  if (DEFAULT_CALLBACK_HOSTS.includes(host)) return true;
  // Gen Tools often call back to VisionWorx preview apps on Vercel.
  if (host.endsWith(".vercel.app") && host.includes("visionworx")) return true;
  return false;
}

async function readJsonBody(req) {
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString("utf8");
      return raw ? JSON.parse(raw) : {};
    }
    if (typeof req.body === "string") {
      return req.body ? JSON.parse(req.body) : {};
    }
    if (typeof req.body === "object") {
      return req.body;
    }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** Accept host, host:port, or full URL in VWX_APP_HOST. */
function normalizeHost(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  try {
    if (trimmed.includes("://")) return new URL(trimmed).host;
  } catch {
    // fall through
  }
  return trimmed.replace(/^\/+/, "").split("/")[0];
}

function sanitizeAsset(asset, index = 0) {
  let data = String(asset?.data_base64 || "").trim();
  // Strip accidental data-URL prefix.
  if (data.includes(",")) data = data.split(",").pop() || "";
  data = data.replace(/\s+/g, "");

  let contentType = String(asset?.content_type || "image/png").trim().toLowerCase();
  if (!contentType.includes("/")) contentType = "image/png";

  let filename = String(asset?.filename || `output-${index + 1}.png`)
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
  if (!filename.includes(".")) {
    const ext =
      contentType === "image/jpeg" || contentType === "image/jpg"
        ? "jpg"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "image/gif"
            ? "gif"
            : contentType.startsWith("video/")
              ? "mp4"
              : "png";
    filename = `${filename}.${ext}`;
  }

  return {
    data_base64: data,
    content_type: contentType === "image/jpg" ? "image/jpeg" : contentType,
    filename,
  };
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) continue;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") {
      out[String(key).slice(0, 64)] = t === "string" ? value.slice(0, 500) : value;
    }
  }
  return Object.keys(out).length ? out : null;
}

async function postSigned(callback, payload, idempotencyKey) {
  const keyId = env("VWX_KEY_ID");
  const secret = env("VWX_SECRET");
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", secret).update(ts + "." + body).digest("hex");

  const response = await fetch(callback, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-VWX-Key-Id": keyId,
      "X-VWX-Timestamp": ts,
      "X-VWX-Signature": "sha256=" + sig,
      "Idempotency-Key": idempotencyKey,
    },
    body,
  });

  const rawText = await response.text();
  let result = {};
  if (rawText) {
    try {
      result = JSON.parse(rawText);
    } catch {
      result = { message: rawText.slice(0, 500) };
    }
  }
  return { ok: response.ok, status: response.status, result, rawText: rawText.slice(0, 500) };
}

function upstreamError(posted) {
  const r = posted.result || {};
  const detail =
    r.error ||
    r.message ||
    r.detail ||
    (Array.isArray(r.errors) ? r.errors.join(", ") : null) ||
    (typeof r === "string" ? r : null) ||
    posted.rawText;
  return detail
    ? `VisionWorx callback HTTP ${posted.status}: ${detail}`
    : `VisionWorx callback failed (HTTP ${posted.status})`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    runId,
    callback,
    assets,
    imageBase64,
    contentType = "image/png",
    filename = "result.png",
    final = true,
    metadata,
    status,
    error,
  } = body || {};

  if (!runId || !callback) {
    return res.status(400).json({ error: "runId and callback are required" });
  }

  let callbackUrl = String(callback).trim();
  // URLSearchParams already decodes once; only decode again if still percent-encoded.
  if (/%[0-9A-Fa-f]{2}/.test(callbackUrl)) {
    try {
      callbackUrl = decodeURIComponent(callbackUrl);
    } catch {
      // keep trimmed value
    }
  }
  try {
    // eslint-disable-next-line no-new
    new URL(callbackUrl);
  } catch {
    return res.status(400).json({ error: "Invalid callback URL", callback: callbackUrl.slice(0, 120) });
  }

  const gotHost = new URL(callbackUrl).host;
  if (!isAllowedCallbackHost(gotHost)) {
    const expected = env("VWX_APP_HOST")
      ? normalizeHost(env("VWX_APP_HOST"))
      : "www.vision-worx.com, vision-worx.com, or a *visionworx*.vercel.app host";
    return res.status(400).json({
      error: `Unexpected callback host (got ${gotHost}, expected ${expected})`,
    });
  }

  if (!env("VWX_KEY_ID") || !env("VWX_SECRET")) {
    return res.status(500).json({ error: "VWX_KEY_ID / VWX_SECRET are not configured" });
  }

  if (status === "failed") {
    const posted = await postSigned(
      callbackUrl,
      {
        run_id: String(runId),
        status: "failed",
        error: String(error || "Generation failed").slice(0, 500),
      },
      String(runId) + ":failed",
    );
    if (!posted.ok) {
      return res.status(502).json({ error: upstreamError(posted), result: posted.result });
    }
    return res.status(200).json(posted.result);
  }

  const rawAssets =
    Array.isArray(assets) && assets.length > 0
      ? assets
      : imageBase64
        ? [{ data_base64: imageBase64, content_type: contentType, filename }]
        : null;

  if (!rawAssets) {
    return res.status(400).json({
      error: "assets (or imageBase64) are required for a successful save",
    });
  }

  const assetList = rawAssets.map((asset, i) => sanitizeAsset(asset, i));
  if (assetList.some((a) => !a.data_base64)) {
    return res.status(400).json({ error: "Each asset needs data_base64" });
  }

  const cleanMeta = sanitizeMetadata(metadata);
  const payload = {
    run_id: String(runId),
    status: "completed",
    final: final !== false,
    assets: assetList,
    ...(cleanMeta ? { metadata: cleanMeta } : {}),
  };

  let posted;
  try {
    posted = await postSigned(
      callbackUrl,
      payload,
      String(runId) + ":" + (final === false ? "part-" + Date.now() : "final"),
    );
  } catch (err) {
    return res.status(502).json({
      error: `Could not reach VisionWorx callback: ${err?.message || err}`,
    });
  }

  if (!posted.ok) {
    return res.status(502).json({
      error: upstreamError(posted),
      result: posted.result,
    });
  }
  return res.status(200).json(posted.result);
}
