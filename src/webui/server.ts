import http from "node:http";
import { URL } from "node:url";
import os from "node:os";
import { Router, HttpError, readBody, sendJson, setCors } from "./http.js";
import { serveStatic } from "./static.js";
import { attachWebSockets } from "./websocket.js";
import { bus } from "./runtime-bus.js";
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerPresetRoutes } from "./routes/presets.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerAddonRoutes } from "./routes/addons.js";
import { registerAssistantRoutes } from "./routes/assistant.js";
import { registerTgAuthRoutes } from "./routes/tg-auth.js";
import { listProfiles, readConfig } from "../storage/md.js";

export interface WebUIServerOptions {
  port?: number;
  host?: string;
  /** автостартовать профиль при подключении первого WebUI клиента, если он один */
  autoStart?: boolean;
  /** не открывать браузер */
  noBrowser?: boolean;
}

const DEFAULT_PORT = Number(process.env.GIRL_AGENT_PORT ?? 3000);
const DEFAULT_HOST = process.env.GIRL_AGENT_HOST ?? "127.0.0.1";

export interface WebUIInstance {
  server: http.Server;
  port: number;
  host: string;
  url: string;
  stop(): Promise<void>;
}

function buildRouter(): Router {
  const r = new Router();
  registerProfileRoutes(r);
  registerPresetRoutes(r);
  registerSystemRoutes(r);
  registerAddonRoutes(r);
  registerAssistantRoutes(r);
  registerTgAuthRoutes(r);
  return r;
}

export async function startWebUIServer(opts: WebUIServerOptions = {}): Promise<WebUIInstance> {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;
  const router = buildRouter();

  const server = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        const matched = router.match(req.method ?? "GET", pathname);
        if (!matched) {
          sendJson(res, 404, { error: "not found", path: pathname });
          return;
        }
        let body: unknown = undefined;
        try { body = await readBody(req); }
        catch (e) {
          if (e instanceof HttpError) { sendJson(res, e.status, { error: e.message }); return; }
          throw e;
        }
        try {
          const result = await matched.route.handler({
            req,
            res,
            params: matched.params,
            url,
            body,
            searchParams: url.searchParams
          });
          if (!res.writableEnded) sendJson(res, 200, result);
        } catch (e) {
          if (e instanceof HttpError) { sendJson(res, e.status, { error: e.message, details: e.details }); return; }
          const msg = (e as Error)?.message ?? String(e);
          process.stderr.write(`[webui] route error ${pathname}: ${msg}\n`);
          sendJson(res, 500, { error: msg });
        }
        return;
      }

      // Static frontend
      await serveStatic(req, res, pathname);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      try {
        sendJson(res, 500, { error: msg });
      } catch { /* response may have started */ }
      process.stderr.write(`[webui] handler error: ${msg}\n`);
    }
  });

  attachWebSockets(server);

  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => { reject(e); };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const ifaces = os.networkInterfaces();
  let displayHost = host;
  if (host === "0.0.0.0") {
    for (const k of Object.keys(ifaces)) {
      for (const i of ifaces[k] ?? []) {
        if (i.family === "IPv4" && !i.internal) { displayHost = i.address; break; }
      }
      if (displayHost !== "0.0.0.0") break;
    }
  }
  const url = `http://${displayHost === "0.0.0.0" ? "127.0.0.1" : displayHost}:${port}`;

  // Auto-start single profile if requested
  if (opts.autoStart) {
    try {
      const slugs = await listProfiles();
      if (slugs.length === 1) {
        const cfg = await readConfig(slugs[0]);
        if (cfg) await bus.startWithConfig(cfg);
      }
    } catch (e) {
      process.stderr.write(`[webui] auto-start failed: ${(e as Error)?.message ?? e}\n`);
    }
  }

  return {
    server,
    port,
    host,
    url,
    async stop() {
      await bus.stopAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
