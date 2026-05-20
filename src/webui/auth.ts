import crypto from "node:crypto";
import http from "node:http";

const COOKIE = "manager_agent_auth";
const TOKEN_BYTES = 24;

const authSecret = process.env.MANAGER_AGENT_WEBUI_PASSWORD?.trim()
  || process.env.MANAGER_AGENT_WEBUI_TOKEN?.trim()
  || "";

const sessions = new Set<string>();

export function authEnabled(): boolean {
  return !!authSecret;
}

export function authStatus(): { enabled: boolean } {
  return { enabled: authEnabled() };
}

export function verifyPassword(password: string): boolean {
  if (!authSecret) return true;
  const a = Buffer.from(password);
  const b = Buffer.from(authSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(res: http.ServerResponse): void {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  sessions.add(token);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

export function clearSession(req: http.IncomingMessage, res: http.ServerResponse): void {
  const token = readCookie(req);
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function isAuthorized(req: http.IncomingMessage): boolean {
  if (!authSecret) return true;
  const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && verifyPassword(bearer)) return true;
  const token = readCookie(req);
  return !!token && sessions.has(token);
}

function readCookie(req: http.IncomingMessage): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) return rest.join("=");
  }
  return undefined;
}
