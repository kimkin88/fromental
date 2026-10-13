import crypto from "crypto";

// api/visionworx-save.js — server-only VisionWorx callback (Express locally, Vercel serverless in prod).
// Secrets stay here. Never put VWX_SECRET in browser code.

function env(name) {
  const value = process.env[name];
  return value == null ? "" : String(value).trim();
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
      "X-VWX-Key-Id": keyId,
      "X-VWX-Timestamp": ts,
      "X-VWX-Signature": "sha256=" + sig,
      "Idempotency-Key": idempotencyKey,
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

function upstreamError(posted) {
  const r = posted.result || {};
  const detail =
    r.error ||
    r.message ||
    r.detail ||
    (Array.isArray(r.errors) ? r.errors.join(", ") : null) ||
    (typeof r === "string" ? r : null);
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
  try {
    // Normalize once so host checks and fetch use a valid absolute URL.
    callbackUrl = decodeURIComponent(callbackUrl);
  } catch {
    // keep trimmed value
  }
  try {
    // Throws if not a valid absolute URL.
    // eslint-disable-next-line no-new
    new URL(callbackUrl);
  } catch {
    return res.status(400).json({ error: "Invalid callback URL", callback: callbackUrl.slice(0, 120) });
  }

  const allowedHost = normalizeHost(env("VWX_APP_HOST"));
  if (allowedHost) {
    const gotHost = new URL(callbackUrl).host;
    if (gotHost !== allowedHost) {
      return res.status(400).json({
        error: `Unexpected callback host (got ${gotHost}, expected ${allowedHost})`,
      });
    }
  }

  if (!env("VWX_KEY_ID") || !env("VWX_SECRET")) {
    return res.status(500).json({ error: "VWX_KEY_ID / VWX_SECRET are not configured" });
  }

  if (status === "failed") {
    const posted = await postSigned(
      callbackUrl,
      {
        run_id: runId,
        status: "failed",
        error: String(error || "Generation failed").slice(0, 500),
      },
      runId + ":failed",
    );
    if (!posted.ok) {
      return res.status(502).json({ error: upstreamError(posted), result: posted.result });
    }
    return res.status(200).json(posted.result);
  }

  const assetList =
    Array.isArray(assets) && assets.length > 0
      ? assets
      : imageBase64
        ? [{ data_base64: imageBase64, content_type: contentType, filename }]
        : null;

  if (!assetList) {
    return res.status(400).json({
      error: "assets (or imageBase64) are required for a successful save",
    });
  }

  // Guard empty base64 which VisionWorx rejects with 400.
  if (assetList.some((a) => !a?.data_base64)) {
    return res.status(400).json({ error: "Each asset needs data_base64" });
  }

  const payload = {
    run_id: runId,
    status: "completed",
    final: final !== false,
    assets: assetList,
    ...(metadata && typeof metadata === "object" ? { metadata } : {}),
  };

  let posted;
  try {
    posted = await postSigned(
      callbackUrl,
      payload,
      runId + ":" + (final === false ? "part-" + Date.now() : "final"),
    );
  } catch (err) {
    return res.status(502).json({
      error: `Could not reach VisionWorx callback: ${err?.message || err}`,
    });
  }

  if (!posted.ok) {
    // Use 502 so the Network tab is not confused with our own validation 400s.
    return res.status(502).json({
      error: upstreamError(posted),
      result: posted.result,
    });
  }
  return res.status(200).json(posted.result);
}
