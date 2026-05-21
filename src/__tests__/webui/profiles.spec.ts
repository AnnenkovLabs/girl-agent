/**
 * Юнит-тесты для расширенной валидации `POST /api/profiles` и атомарного
 * создания профиля менеджера (Task 5.1 manager-mode, Requirement 1.1–1.10).
 *
 * Тесты вызывают handler роутера напрямую (без spin-up HTTP-сервера) — этого
 * достаточно, чтобы покрыть валидационную логику и rollback. Для теста
 * rollback используем `vi.doMock`, чтобы заставить `saveTickets` бросить
 * исключение в одном конкретном вызове.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let storage: typeof import("../../storage/md.js");
let routesMod: typeof import("../../webui/routes/profiles.js");
let httpMod: typeof import("../../webui/http.js");
let failNextSaveTickets = false;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-webui-profiles-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;

  // Подменяем `saveTickets`, чтобы в одном тесте смоделировать ошибку записи
  // и проверить rollback. Все остальные вызовы остаются настоящими.
  vi.doMock("../../storage/md.js", async () => {
    const actual = await vi.importActual<typeof import("../../storage/md.js")>("../../storage/md.js");
    return {
      ...actual,
      saveTickets: async (slug: string, file: import("../../types.js").TicketsFile) => {
        if (failNextSaveTickets) {
          failNextSaveTickets = false;
          throw new Error("forced disk failure");
        }
        return actual.saveTickets(slug, file);
      }
    };
  });

  storage = await import("../../storage/md.js");
  httpMod = await import("../../webui/http.js");
  routesMod = await import("../../webui/routes/profiles.js");
});

afterAll(async () => {
  vi.doUnmock("../../storage/md.js");
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  failNextSaveTickets = false;
  // Чистим директорию данных перед каждым тестом, чтобы slug-коллизии и
  // частичные файлы из предыдущего теста не влияли на следующий.
  for (const entry of await fs.readdir(tmpRoot, { withFileTypes: true })) {
    await fs.rm(path.join(tmpRoot, entry.name), { recursive: true, force: true });
  }
});

interface CallResult {
  status: number;
  body: { config?: import("../../types.js").ProfileConfig; error?: string; details?: unknown };
}

async function postProfile(body: unknown): Promise<CallResult> {
  const r = new httpMod.Router();
  routesMod.registerProfileRoutes(r);
  const matched = r.match("POST", "/api/profiles");
  if (!matched) throw new Error("route /api/profiles not registered");
  try {
    const result = await matched.route.handler({
      params: matched.params,
      body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: {} as any,
      url: new URL("http://localhost/api/profiles"),
      searchParams: new URLSearchParams()
    });
    return { status: 200, body: result as CallResult["body"] };
  } catch (e) {
    if (e instanceof httpMod.HttpError) {
      return { status: e.status, body: { error: e.message, details: e.details } };
    }
    throw e;
  }
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Тестовый Менеджер",
    slug: "test-mgr",
    ownerId: 12345,
    tone: "mixed-by-tier",
    personaStyle: "gender-neutral-assistant",
    gateLevel: "gated",
    afterHoursPolicy: "vip-only",
    proactiveClients: false,
    proactiveBoss: false,
    mandate: "Отвечаю по ценам, всё остальное — боссу.",
    escalationTimeoutMin: 240,
    digestPeriodHours: 24,
    digestTime: "09:00",
    ...overrides
  };
}

function profileExists(slug: string): boolean {
  return existsSync(path.join(tmpRoot, slug));
}

describe("POST /api/profiles — расширенная валидация (Req 1)", () => {
  // Req 1.7 — успешное создание полного payload.
  it("создаёт профиль с config.json, mandate.md, tickets.json и contacts/", async () => {
    const r = await postProfile(validPayload());
    expect(r.status).toBe(200);
    expect(r.body.config?.slug).toBe("test-mgr");
    expect(r.body.config?.profileType).toBe("manager");

    const dir = path.join(tmpRoot, "test-mgr");
    expect(existsSync(path.join(dir, "config.json"))).toBe(true);
    expect(existsSync(path.join(dir, "mandate.md"))).toBe(true);
    expect(existsSync(path.join(dir, "tickets.json"))).toBe(true);
    expect(existsSync(path.join(dir, "contacts"))).toBe(true);

    const tickets = await storage.loadTickets("test-mgr");
    expect(tickets).toEqual({ version: 1, nextId: 1, tickets: [] });

    const mandate = await storage.loadMandate("test-mgr");
    expect(mandate).toBe("Отвечаю по ценам, всё остальное — боссу.");
  });

  // Req 1.4 — ownerId обязателен.
  it("отклоняет отсутствующий ownerId с 400", async () => {
    const r = await postProfile(validPayload({ ownerId: undefined }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.ownerId).toBeDefined();
    expect(profileExists("test-mgr")).toBe(false);
  });

  // Req 1.4 — ownerId=0 запрещён.
  it("отклоняет ownerId=0 с 400", async () => {
    const r = await postProfile(validPayload({ ownerId: 0 }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.ownerId).toBeDefined();
    expect(profileExists("test-mgr")).toBe(false);
  });

  // Req 1.4 — ownerId выше предела отклоняется.
  it("отклоняет ownerId > 9_999_999_999_999", async () => {
    const r = await postProfile(validPayload({ ownerId: 10_000_000_000_000 }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.ownerId).toBeDefined();
  });

  // Req 1.5 — slug-валидация.
  it("отклоняет slug короче 3 символов", async () => {
    const r = await postProfile(validPayload({ slug: "ab" }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.slug).toBeDefined();
  });

  it("отклоняет slug с недопустимыми символами", async () => {
    const r = await postProfile(validPayload({ slug: "Bad_Slug!" }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.slug).toBeDefined();
  });

  it("отклоняет дубликат slug с 400", async () => {
    const first = await postProfile(validPayload());
    expect(first.status).toBe(200);
    const second = await postProfile(validPayload({ name: "Другой" }));
    expect(second.status).toBe(400);
    expect((second.body.details as { errors: Record<string, string> }).errors.slug).toBeDefined();
  });

  // Req 1.2 + 1.10 — mandate ≤4000.
  it("отклоняет mandate длиной 4001 символ", async () => {
    const huge = "a".repeat(4001);
    const r = await postProfile(validPayload({ mandate: huge }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.mandate).toBeDefined();
    expect(profileExists("test-mgr")).toBe(false);
  });

  // Req 1.9 — whitelist обязателен (не пуст) при gateLevel=whitelist.
  it("отклоняет gateLevel=whitelist с пустым whitelist", async () => {
    const r = await postProfile(validPayload({ gateLevel: "whitelist", whitelist: [] }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.whitelist).toBeDefined();
  });

  it("отклоняет gateLevel=whitelist без поля whitelist", async () => {
    const r = await postProfile(validPayload({ gateLevel: "whitelist" }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.whitelist).toBeDefined();
  });

  // Req 1.9 — валидный whitelist принимается.
  it("принимает gateLevel=whitelist с валидными записями id и username", async () => {
    const r = await postProfile(validPayload({
      gateLevel: "whitelist",
      whitelist: [
        { kind: "id", chatId: 123456789 },
        { kind: "username", username: "vitya_helper" }
      ]
    }));
    expect(r.status).toBe(200);
    expect(r.body.config?.whitelist).toHaveLength(2);
    // username сохраняется в нижнем регистре (Req 17.6).
    expect(r.body.config?.whitelist?.[1]).toEqual({ kind: "username", username: "vitya_helper" });
  });

  // Req 1.9 — невалидные записи whitelist.
  it("отклоняет whitelist с chatId=0", async () => {
    const r = await postProfile(validPayload({
      gateLevel: "whitelist",
      whitelist: [{ kind: "id", chatId: 0 }]
    }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.whitelist).toBeDefined();
  });

  it("отклоняет whitelist с пустым username", async () => {
    const r = await postProfile(validPayload({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "" }]
    }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.whitelist).toBeDefined();
  });

  // Req 5.6 — escalationTimeoutMin диапазон.
  it("отклоняет escalationTimeoutMin=4 (ниже минимума)", async () => {
    const r = await postProfile(validPayload({ escalationTimeoutMin: 4 }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.escalationTimeoutMin).toBeDefined();
  });

  it("отклоняет escalationTimeoutMin=1441 (выше максимума)", async () => {
    const r = await postProfile(validPayload({ escalationTimeoutMin: 1441 }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.escalationTimeoutMin).toBeDefined();
  });

  // Req 9.2 — digestPeriodHours диапазон.
  it("отклоняет digestPeriodHours=0 и =169", async () => {
    const r1 = await postProfile(validPayload({ digestPeriodHours: 0 }));
    expect(r1.status).toBe(400);
    const r2 = await postProfile(validPayload({ digestPeriodHours: 169 }));
    expect(r2.status).toBe(400);
  });

  // digestTime формат HH:MM.
  it("отклоняет digestTime='25:00'", async () => {
    const r = await postProfile(validPayload({ digestTime: "25:00" }));
    expect(r.status).toBe(400);
    expect((r.body.details as { errors: Record<string, string> }).errors.digestTime).toBeDefined();
  });

  // Req 1.3 + 1.10 — дефолты применяются и сохраняются.
  it("применяет дефолты при отсутствии manager-полей", async () => {
    const r = await postProfile({
      name: "Минимальный",
      slug: "min-mgr",
      ownerId: 42
    });
    expect(r.status).toBe(200);
    const cfg = r.body.config!;
    expect(cfg.tone).toBe("mixed-by-tier");
    expect(cfg.personaStyle).toBe("gender-neutral-assistant");
    expect(cfg.gateLevel).toBe("gated");
    expect(cfg.afterHoursPolicy).toBe("vip-only");
    expect(cfg.proactiveClients).toBe(false);
    expect(cfg.proactiveBoss).toBe(false);
    expect(cfg.escalationTimeoutMin).toBe(240);
    expect(cfg.digestPeriodHours).toBe(24);
    expect(cfg.digestTime).toBe("09:00");

    // Read back saved config to confirm Req 1.10 (re-open shows identical values).
    const stored = await storage.readConfig("min-mgr");
    expect(stored?.tone).toBe("mixed-by-tier");
    expect(stored?.gateLevel).toBe("gated");
    expect(stored?.escalationTimeoutMin).toBe(240);
    expect(stored?.digestTime).toBe("09:00");
    expect(stored?.profileType).toBe("manager");
  });

  // Req 1.8 — rollback при ошибке записи.
  it("откатывает создание профиля при ошибке записи tickets.json", async () => {
    failNextSaveTickets = true;
    const r = await postProfile(validPayload({ slug: "rollback-mgr" }));
    expect(r.status).toBe(500);
    expect(r.body.error).toContain("profile creation failed");
    // Профиль удалён целиком — никаких частичных артефактов.
    expect(profileExists("rollback-mgr")).toBe(false);
  });
});
