/**
 * Тесты роутов `/api/contacts/:slug` (Task 5.4 manager-mode, Req 10.1-10.6).
 * Паттерн совпадает с `mandate.spec.ts`/`whitelist.spec.ts` — реальный
 * HTTP-сервер с auth-guard'ом и роутером, запросы через `fetch`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContactRecord, Tier } from "../../types.js";

let tmpRoot: string;
let server: http.Server;
let baseUrl: string;
const AUTH_PASSWORD = "test-contacts-secret-7q";
const AUTH_HEADER = { Authorization: `Bearer ${AUTH_PASSWORD}` };
const SLUG_OK = "test-contacts-routes";
const SLUG_MISSING = "no-such-profile-zzz";

let storage: typeof import("../../storage/md.js");

async function writeFakeConfig(slug: string): Promise<void> {
  const dir = path.join(tmpRoot, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ slug, name: "Test" }), "utf8");
}

function makeContact(
  chatId: string,
  tier: Tier,
  lastMessageAt: string | undefined,
  extra: Partial<ContactRecord> = {}
): ContactRecord {
  return {
    chatId,
    tier,
    manualOverride: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastMessageAt,
    score: { relevance: 0, trust: 0, urgency: 0, annoyance: 0, spamScore: 0 },
    messagesSinceTransition: 0,
    ...extra
  };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-webui-contacts-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  process.env.MANAGER_AGENT_WEBUI_PASSWORD = AUTH_PASSWORD;

  storage = await import("../../storage/md.js");
  const httpMod = await import("../../webui/http.js");
  const routesMod = await import("../../webui/routes/contacts.js");
  const auth = await import("../../webui/auth.js");

  await writeFakeConfig(SLUG_OK);
  // 4 контакта с разными `lastMessageAt` (один без даты — для теста хвоста).
  await storage.saveContact(SLUG_OK, makeContact("c-alpha", "regular",    "2024-05-10T10:00:00.000Z"));
  await storage.saveContact(SLUG_OK, makeContact("c-beta",  "regular",    "2024-05-12T10:00:00.000Z"));
  await storage.saveContact(SLUG_OK, makeContact("c-gamma", "vip",        "2024-05-11T10:00:00.000Z"));
  await storage.saveContact(SLUG_OK, makeContact("c-delta", "introduced", undefined));

  const router = new httpMod.Router();
  routesMod.registerContactRoutes(router);

  server = http.createServer(async (req, res) => {
    httpMod.setCors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? "/", `http://localhost`);
    if (!url.pathname.startsWith("/api/")) { httpMod.sendJson(res, 404, { error: "not found" }); return; }
    if (!auth.isAuthorized(req)) { httpMod.sendJson(res, 401, { error: "auth required" }); return; }
    const matched = router.match(req.method ?? "GET", url.pathname);
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
      if (e instanceof httpMod.HttpError) { httpMod.sendJson(res, e.status, { error: e.message }); return; }
      httpMod.sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
    }
  });

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => resolve()); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MANAGER_AGENT_DATA;
  delete process.env.MANAGER_AGENT_WEBUI_PASSWORD;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function patchContact(slug: string, chatId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/contacts/${slug}/${chatId}`, {
    method: "PATCH",
    headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("GET /api/contacts/:slug", () => {
  it("возвращает все контакты, по умолчанию desc по lastMessageAt (без даты — в хвост)", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(200);
    const { contacts } = (await r.json()) as { contacts: ContactRecord[] };
    expect(contacts.map(c => c.chatId)).toEqual(["c-beta", "c-gamma", "c-alpha", "c-delta"]);
  });

  it("сортирует asc при ?sort=asc, без даты — в хвост", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}?sort=asc`, { headers: AUTH_HEADER });
    const { contacts } = (await r.json()) as { contacts: ContactRecord[] };
    expect(contacts.map(c => c.chatId)).toEqual(["c-alpha", "c-gamma", "c-beta", "c-delta"]);
  });

  it("фильтрует по ?tier=regular", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}?tier=regular`, { headers: AUTH_HEADER });
    const { contacts } = (await r.json()) as { contacts: ContactRecord[] };
    expect(contacts.map(c => c.chatId).sort()).toEqual(["c-alpha", "c-beta"]);
    expect(contacts.every(c => c.tier === "regular")).toBe(true);
  });

  it("отклоняет невалидный ?tier с 400", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}?tier=not-a-tier`, { headers: AUTH_HEADER });
    expect(r.status).toBe(400);
  });

  it("возвращает 404 для несуществующего профиля", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_MISSING}`, { headers: AUTH_HEADER });
    expect(r.status).toBe(404);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}`);
    expect(r.status).toBe(401);
  });
});

describe("PATCH /api/contacts/:slug/:chatId", () => {
  it("меняет tier, ставит manualOverride=true и обнуляет messagesSinceTransition", async () => {
    const slug = "patch-tier-1";
    await writeFakeConfig(slug);
    await storage.saveContact(slug, makeContact("c1", "regular", "2024-05-10T10:00:00.000Z", {
      manualOverride: false, messagesSinceTransition: 7
    }));

    const t0 = Date.now();
    const r = await patchContact(slug, "c1", { tier: "vip" });
    const elapsed = Date.now() - t0;

    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(2000); // Req 10.3
    const persisted = await storage.loadContact(slug, "c1");
    expect(persisted?.tier).toBe("vip");
    expect(persisted?.manualOverride).toBe(true);
    expect(persisted?.messagesSinceTransition).toBe(0);
  });

  it("меняет notes, не трогая tier и manualOverride", async () => {
    const slug = "patch-notes-1";
    await writeFakeConfig(slug);
    await storage.saveContact(slug, makeContact("c1", "regular", "2024-05-10T10:00:00.000Z"));
    const r = await patchContact(slug, "c1", { notes: "Звонит по средам, любит чай" });
    expect(r.status).toBe(200);
    const persisted = await storage.loadContact(slug, "c1");
    expect(persisted?.notes).toBe("Звонит по средам, любит чай");
    expect(persisted?.tier).toBe("regular");
    expect(persisted?.manualOverride).toBe(false);
  });

  it("сохраняет существующие поля (score, createdAt, lastMessageAt, username)", async () => {
    const slug = "patch-preserve";
    await writeFakeConfig(slug);
    const original = makeContact("c1", "regular", "2024-05-10T10:00:00.000Z", {
      score: { relevance: 5, trust: 10, urgency: 0, annoyance: 2, spamScore: 0 },
      username: "alice"
    });
    await storage.saveContact(slug, original);
    await patchContact(slug, "c1", { tier: "vip" });
    const persisted = await storage.loadContact(slug, "c1");
    expect(persisted?.score).toEqual(original.score);
    expect(persisted?.createdAt).toBe(original.createdAt);
    expect(persisted?.lastMessageAt).toBe(original.lastMessageAt);
    expect(persisted?.username).toBe("alice");
  });

  it("отклоняет невалидный tier 400 без модификации файла (Req 10.5)", async () => {
    const slug = "patch-invalid-tier";
    await writeFakeConfig(slug);
    const original = makeContact("c1", "regular", "2024-05-10T10:00:00.000Z");
    await storage.saveContact(slug, original);
    const r = await patchContact(slug, "c1", { tier: "not-a-tier" });
    expect(r.status).toBe(400);
    expect(await storage.loadContact(slug, "c1")).toEqual(original);
  });

  it("отклоняет notes длиной 2001 c 400 без модификации файла (Req 10.5)", async () => {
    const slug = "patch-notes-too-long";
    await writeFakeConfig(slug);
    const original = makeContact("c1", "regular", "2024-05-10T10:00:00.000Z", { notes: "ok" });
    await storage.saveContact(slug, original);
    const r = await patchContact(slug, "c1", { notes: "x".repeat(2001) });
    expect(r.status).toBe(400);
    expect(await storage.loadContact(slug, "c1")).toEqual(original);
  });

  it("принимает notes ровно длиной 2000 (граница)", async () => {
    const slug = "patch-notes-boundary";
    await writeFakeConfig(slug);
    await storage.saveContact(slug, makeContact("c1", "regular", "2024-05-10T10:00:00.000Z"));
    const r = await patchContact(slug, "c1", { notes: "y".repeat(2000) });
    expect(r.status).toBe(200);
    expect((await storage.loadContact(slug, "c1"))?.notes?.length).toBe(2000);
  });

  it("отклоняет пустое тело (ни tier, ни notes) c 400", async () => {
    const slug = "patch-empty-body";
    await writeFakeConfig(slug);
    await storage.saveContact(slug, makeContact("c1", "regular", "2024-05-10T10:00:00.000Z"));
    expect((await patchContact(slug, "c1", {})).status).toBe(400);
  });

  it("возвращает 404 для несуществующего chatId", async () => {
    expect((await patchContact(SLUG_OK, "ghost-id-9999", { tier: "vip" })).status).toBe(404);
  });

  it("возвращает 401 без Authorization заголовка", async () => {
    const r = await fetch(`${baseUrl}/api/contacts/${SLUG_OK}/c-alpha`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "vip" })
    });
    expect(r.status).toBe(401);
  });

  it("сериализует конкурентные PATCH-ы одного контакта (mutex)", async () => {
    const slug = "patch-mutex";
    await writeFakeConfig(slug);
    await storage.saveContact(slug, makeContact("c1", "regular", "2024-05-10T10:00:00.000Z"));
    // 5 параллельных запросов: все 200, итоговый файл валиден.
    const results = await Promise.all([
      patchContact(slug, "c1", { tier: "introduced" }),
      patchContact(slug, "c1", { tier: "regular" }),
      patchContact(slug, "c1", { tier: "trusted-partner" }),
      patchContact(slug, "c1", { tier: "vip" }),
      patchContact(slug, "c1", { notes: "конкурентная заметка" })
    ]);
    expect(results.every(r => r.status === 200)).toBe(true);
    const persisted = await storage.loadContact(slug, "c1");
    expect(persisted).not.toBeNull();
    expect(persisted?.manualOverride).toBe(true);
  });
});
