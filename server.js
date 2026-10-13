import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer as createViteServer, loadEnv } from "vite";
import visionworxSave from "./api/visionworx-save.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT) || 3000;

// Merge Vite-style env files (.env, .env.local, etc.) without exposing VWX_* to the client.
const mode = isProd ? "production" : "development";
const fileEnv = loadEnv(mode, process.cwd(), "");
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  app.all("/api/visionworx-save", (req, res) => {
    Promise.resolve(visionworxSave(req, res)).catch((err) => {
      console.error("visionworx-save error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  });

  if (isProd) {
    const dist = path.join(__dirname, "dist");
    app.use(express.static(dist));
    // Express 5 catch-all for SPA client routes
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  return app;
}

createApp()
  .then((app) => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Fromental visualizer listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
