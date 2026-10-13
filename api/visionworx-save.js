import crypto from "crypto";

// api/visionworx-save.js — server-only VisionWorx callback (Express locally, Vercel serverless in prod).
// Secrets stay here. Never put VWX_SECRET in browser code.

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

async function postSigned(callback, payload, idempotencyKey) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto
    .createHmac("sha256", process.env.VWX_SECRET)
    .update(ts + "." + body)
    .digest("hex");

  const response = await fetch(callback, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VWX-Key-Id": process.env.VWX_KEY_ID,
      "X-VWX-Timestamp": ts,
      "X-VWX-Signature": "sha256=" + sig,
      "Idempotency-Key": idempotencyKey,
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
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

  const allowedHost = process.env.VWX_APP_HOST;
  if (allowedHost) {
    try {
      if (new URL(callback).host !== allowedHost) {
        return res.status(400).json({ error: "Unexpected callback host" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid callback URL" });
    }
  }

  if (!process.env.VWX_KEY_ID || !process.env.VWX_SECRET) {
    return res.status(500).json({ error: "VWX_KEY_ID / VWX_SECRET are not configured" });
  }

  if (status === "failed") {
    const posted = await postSigned(
      callback,
      {
        run_id: runId,
        status: "failed",
        error: String(error || "Generation failed").slice(0, 500),
      },
      runId + ":failed",
    );
    return res.status(posted.ok ? 200 : posted.status).json(posted.result);
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

  const payload = {
    run_id: runId,
    status: "completed",
    final: final !== false,
    assets: assetList,
    ...(metadata && typeof metadata === "object" ? { metadata } : {}),
  };

  const posted = await postSigned(
    callback,
    payload,
    runId + ":" + (final === false ? "part-" + Date.now() : "final"),
  );
  return res.status(posted.ok ? 200 : posted.status).json(posted.result);
}
