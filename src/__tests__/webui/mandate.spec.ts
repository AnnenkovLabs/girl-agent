/**
 * Тесты роутов `/api/mandate/:slug` (Task 5.2 manager-mode, Req 3.1, 3.2).
 *
 * Стратегия: поднимаем минимальный HTTP-сервер с тем же auth-guard'ом, что и
 * в `webui/server.ts`, и подаём реальные запросы через `fetch`. Это покрывает
 * и хендлеры маршрутов, и слой аутентификации (401 без `Authorization`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let server: http.Server;
let baseUrl: string;
const AUTH_PASSWORD = "test-mandate-secret-zz";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_PASSWORD}` };
const SLUG_OK = "test-mandate-routes";
const SLUG_MISSING = "no-such-profile-xyz";

let storage: typeof import("../../storage/md.js");

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-webui-mandate-"));
  // Эти env'ы должны быть выставлены ДО динамических импортов: модули
  // `storage/md.ts` и `webui/auth.ts` читают их один раз при загрузке.
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  process.env.MANAGER_AGENT_WEBUI_PASSWORD = AUTH_PASSWORD;

  storage = await import("../../storage/md.js");
  const httpMod = await import("../../webui/http.js");
  const routesMod = await import("../../webui/routes/mandate.js");
  const auth = await import("../../webui/auth.js");

  // Создаём фейковый профиль на диске. Для проверки маршрутов достаточно,
  // чтобы `readConfig` вернул non-null объект; полная схема `ProfileConfig`
  // не нужна — пишем минимальный валидный JSON.
  const dir = path.join(tmpRoot, SLUG_OK);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({ slug: SLUG_OK, name: "Test Manager" }),
    "utf8"
  );

  // Минимальный HTTP-сервер с тем же auth-guard'ом, что и production-сервер.
  // Веб-сокеты и runtime-bus здесь не нужны.
  const router = new httpMod.Router();
  routesMod.registerMandateRoutes(router);

  server = http.createServer(async (req, res) => {
    httpMod.setCors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const pathname = url.pathname;
      if (!pathname.startsWith("/api/")) {
        httpMod.sendJson(res, 404, { error: "not found" });
        return;
      }
      if (!auth.isAuthorized(req)) {
        httpMod.sendJson(res, 401, { error: "auth required" });
        return;
      }
      const matched = router.match(req.method ?? "GET", pathname);
      if (!matched) { httpMod.sendJson(res, 404, { error: "not found" }); return; }
      let body: unknown;
      try { body = await httpMod.readBody(req); }
      catch (e) {
        if (e instanceof httpMod.HttpError) { httpMod.sendJson(res, e.status, { error: e.message }); return; }
        throw e;
      }
      try {
        const result = await matched.route.handler({
          req, res, params: matched.params, url, body, searchParams: url.searchParams
        });
        if (!res.writableEnded) httpMod.sendJson(res, 200, result);
      } catch (e) {
        if (e instanceof httpMod.HttpError) {
          httpMod.sendJson(res, e.status, { error: e.message, details: e.details });
          return;
        }
        httpMod.sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
      }
    } catch (e) {
      httpMod.sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MANAGER_AGENT_DATA;
  delete process.env.MANAGER_AGENT_WEBUI_PASSWORD;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/mandate/:slug", () => {
  it("возвращает текст mandate.md существующего профиля", async () => {
    const expected = "# Mandate\n\n- цены до 50000 — сама\n- остальное — боссу\n";
    await storage.saveMandate(SLUG_OK, expected);
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const json = (await r.json()) as { text: string };
    expect(json.text).toBe(expected);
  });

  it("возвращает 404 для несуществующего профиля", async () => {
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_MISSING}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`);
    expect(r.status).toBe(401);
  });
});

describe("PUT /api/mandate/:slug", () => {
  it("сохраняет mandate.md (round-trip через loadMandate)", async () => {
    const text = "новый текст мандата v2";
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`, {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(await storage.loadMandate(SLUG_OK)).toBe(text);
  });

  it("отклоняет text длиной 4001 символ с 400", async () => {
    const huge = "a".repeat(4001);
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`, {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ text: huge })
    });
    expect(r.status).toBe(400);
  });

  it("отклоняет text не-строкой с 400", async () => {
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`, {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ text: 123 })
    });
    expect(r.status).toBe(400);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/mandate/${SLUG_OK}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "noauth" })
    });
    expect(r.status).toBe(401);
  });
});
