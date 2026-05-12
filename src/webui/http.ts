import http from "node:http";
import { URL } from "node:url";

/**
 * Минимальный HTTP-роутер на встроенном node:http.
 * Не тащим Express/Fastify — для небольшого числа endpoints это лишний вес.
 *
 * Конвенции:
 * - JSON-ответы автоматом сериализуются + Content-Type: application/json
 * - Ошибки бросаем через HttpError(status, message)
 * - Path-параметры — через :name (например /api/profiles/:slug)
 */

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  url: URL;
  body: unknown;
  searchParams: URLSearchParams;
}

export type Handler = (ctx: RouteContext) => Promise<unknown> | unknown;

interface Route {
  method: Method;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: Method, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const parts = path.split("/").map(part => {
      if (part.startsWith(":")) {
        paramNames.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
    });
    const re = parts.join("/");
    this.routes.push({
      method,
      pattern: new RegExp(`^${re}$`),
      paramNames,
      handler
    });
  }

  get(path: string, h: Handler) { this.add("GET", path, h); }
  post(path: string, h: Handler) { this.add("POST", path, h); }
  put(path: string, h: Handler) { this.add("PUT", path, h); }
  delete(path: string, h: Handler) { this.add("DELETE", path, h); }
  patch(path: string, h: Handler) { this.add("PATCH", path, h); }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(pathname);
      if (m) {
        const params: Record<string, string> = {};
        r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1] ?? ""); });
        return { route: r, params };
      }
    }
    return null;
  }
}

export async function readBody(req: http.IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return await new Promise<unknown>((resolve, reject) => {
    let len = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      len += c.length;
      if (len > 32 * 1024 * 1024) {
        reject(new HttpError(413, "request too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve(undefined); return; }
      const ct = String(req.headers["content-type"] ?? "");
      if (ct.includes("application/json")) {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new HttpError(400, "invalid json")); }
      } else {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  });
  res.end(data);
}

export function sendText(res: http.ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

export function setCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}
