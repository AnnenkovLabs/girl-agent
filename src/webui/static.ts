import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json"
};

let cachedRoot: string | null = null;

/**
 * Найти dist/webui/ относительно текущего исполняемого файла.
 * Поддерживает как dev-режим (tsx из src/), так и собранный (dist/cli.js).
 */
async function findWebUIRoot(): Promise<string | null> {
  if (cachedRoot) return cachedRoot;
  const here = (() => {
    try { return path.dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); }
  })();
  // Порядок важен: prod-сборка должна найтись первой, потом dev-fallback.
  const candidates = [
    path.resolve(here, "webui"),                            // dist/cli.js -> dist/webui/
    path.resolve(here, "..", "dist", "webui"),              // src/webui/static.ts -> dist/webui/
    path.resolve(here, "..", "..", "dist", "webui"),        // src/webui/static.ts -> dist/webui/
    path.resolve(here, "..", "..", "..", "dist", "webui"),
    path.resolve(process.cwd(), "dist", "webui")
  ];
  for (const c of candidates) {
    try {
      const stat = await fs.stat(path.join(c, "index.html"));
      if (stat.isFile()) { cachedRoot = c; return c; }
    } catch { /* try next */ }
  }
  return null;
}

export async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string): Promise<boolean> {
  const root = await findWebUIRoot();
  if (!root) {
    res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
    res.end(FALLBACK_HTML);
    return true;
  }

  let cleanPath = urlPath.split("?")[0]!;
  if (cleanPath === "/" || cleanPath === "") cleanPath = "/index.html";
  if (cleanPath.includes("..")) {
    res.writeHead(400);
    res.end();
    return true;
  }

  const filePath = path.join(root, cleanPath);
  if (!filePath.startsWith(root)) {
    res.writeHead(400);
    res.end();
    return true;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) return await sendFile(res, path.join(filePath, "index.html"));
    return await sendFile(res, filePath);
  } catch {
    // SPA fallback to index.html
    return await sendFile(res, path.join(root, "index.html"));
  }
}

async function sendFile(res: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>girl-agent</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#0a0010;color:#fff8ff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.box{max-width:540px;padding:24px;border:1px solid rgba(255,255,255,0.1);border-radius:16px;background:rgba(255,255,255,0.04);backdrop-filter:blur(12px)}
h1{margin:0 0 12px 0;font-size:20px;color:#ff7ad6}
code{background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px}
</style></head><body><div class="box">
<h1>girl-agent — WebUI ещё не собран</h1>
<p>Соберите фронтенд:</p>
<pre><code>npm run build:webui</code></pre>
<p>API доступен по адресу <code>/api/system/health</code>.</p>
</div></body></html>`;
