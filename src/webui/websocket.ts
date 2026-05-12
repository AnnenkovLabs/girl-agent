import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { bus, type BufferedEvent, type RuntimeStatus } from "./runtime-bus.js";
import { readRelationship } from "../storage/md.js";

/**
 * WS-эндпоинты согласно §6.2 ТЗ.
 *  /ws/logs/:slug    — стрим событий runtime'а в реальном времени.
 *  /ws/status/:slug  — стрим статусных снапшотов (score, stage, online/offline).
 */
export function attachWebSockets(server: http.Server): void {
  const wssLogs = new WebSocketServer({ noServer: true });
  const wssStatus = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const logsMatch = url.match(/^\/ws\/logs\/([^/?#]+)/);
    if (logsMatch) {
      const slug = decodeURIComponent(logsMatch[1] ?? "");
      wssLogs.handleUpgrade(req, socket as any, head, (ws) => {
        wssLogs.emit("connection", ws, req, slug);
      });
      return;
    }
    const statusMatch = url.match(/^\/ws\/status\/([^/?#]+)/);
    if (statusMatch) {
      const slug = decodeURIComponent(statusMatch[1] ?? "");
      wssStatus.handleUpgrade(req, socket as any, head, (ws) => {
        wssStatus.emit("connection", ws, req, slug);
      });
      return;
    }
    socket.destroy();
  });

  wssLogs.on("connection", (ws: WebSocket, _req: http.IncomingMessage, slug: string) => {
    // Backlog
    for (const ev of bus.recentLogs(slug)) {
      try { ws.send(JSON.stringify({ kind: "event", event: ev })); } catch { /* ignore */ }
    }
    const onLog = (ev: BufferedEvent) => {
      try { ws.send(JSON.stringify({ kind: "event", event: ev })); } catch { /* ignore */ }
    };
    bus.on(`log:${slug}`, onLog);
    ws.on("close", () => bus.off(`log:${slug}`, onLog));
    ws.on("error", () => bus.off(`log:${slug}`, onLog));
  });

  wssStatus.on("connection", async (ws: WebSocket, _req: http.IncomingMessage, slug: string) => {
    const send = async () => {
      try {
        const status = bus.status(slug);
        let score: unknown = null;
        let stage: string | undefined;
        try {
          const rel = await readRelationship(slug);
          score = rel.score;
          stage = rel.stage;
        } catch { /* no relationship yet */ }
        ws.send(JSON.stringify({ kind: "status", status, score, stage, t: Date.now() }));
      } catch { /* ignore */ }
    };
    await send();
    const onStatus = (s: RuntimeStatus) => { if (s.slug === slug) void send(); };
    const onLog = (ev: BufferedEvent) => {
      // refresh status periodically when new events come
      if (ev.type === "score" || ev.type === "info") void send();
    };
    bus.on("status", onStatus);
    bus.on(`log:${slug}`, onLog);
    const interval = setInterval(send, 5000);
    ws.on("close", () => {
      bus.off("status", onStatus);
      bus.off(`log:${slug}`, onLog);
      clearInterval(interval);
    });
    ws.on("error", () => {
      bus.off("status", onStatus);
      bus.off(`log:${slug}`, onLog);
      clearInterval(interval);
    });
  });
}
