/**
 * Тесты миграции 0115-manager-mode (Task 3.6).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProfileConfig } from "../../types.js";

let tmpRoot: string;
let mod: typeof import("../../migrations/0115-manager-mode.js");
let storage: typeof import("../../storage/md.js");

const SLUG = "legacy-girl-agent-profile";

const LEGACY_CONFIG: ProfileConfig = {
  slug: SLUG,
  name: "Аня",
  age: 22,
  nationality: "RU",
  tz: "Europe/Moscow",
  mode: "bot",
  llm: {
    presetId: "claudehub",
    proto: "anthropic",
    apiKey: "secret",
    model: "claude-sonnet"
  },
  telegram: { botToken: "bot:token" },
  ownerId: 1234567,
  privacy: "owner-only",
  stage: "tg-given-cold",
  createdAt: new Date(2024, 0, 1).toISOString(),
  sleepFrom: 23,
  sleepTo: 8,
  nightWakeChance: 0.05,
  vibe: "warm",
  communication: { notifications: "normal", messageStyle: "balanced", initiative: "medium", lifeSharing: "low" }
};

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-mig-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  storage = await import("../../storage/md.js");
  mod = await import("../../migrations/0115-manager-mode.js");
  // Готовим фейковый старый профиль с relationship/conflict/boundaries.
  const dir = path.join(tmpRoot, SLUG);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "relationship.md"), "stage:tg-given-cold", "utf8");
  await fs.writeFile(path.join(dir, "conflict.json"), "{}", "utf8");
  await fs.writeFile(path.join(dir, "boundaries.md"), "old boundaries", "utf8");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("migration 0115-manager-mode", () => {
  it("выставляет дефолты и удаляет устаревшие файлы", async () => {
    const logs: string[] = [];
    const next = await mod.migration0115.migrate({
      profilePath: path.join(tmpRoot, SLUG),
      config: { ...LEGACY_CONFIG },
      log: (m) => logs.push(m)
    });

    expect(next.tone).toBe("mixed-by-tier");
    expect(next.personaStyle).toBe("gender-neutral-assistant");
    expect(next.gateLevel).toBe("gated");
    expect(next.afterHoursPolicy).toBe("vip-only");
    expect(next.proactiveClients).toBe(false);
    expect(next.proactiveBoss).toBe(false);
    expect(next.escalationTimeoutMin).toBe(240);
    expect(next.digestPeriodHours).toBe(24);
    expect(next.digestTime).toBe("09:00");
    expect(next.profileType).toBe("manager");
    expect(next.vibe).toBeUndefined();
    expect(next.communication).toBeUndefined();
    expect(next.stage).toBe("manager-default");
    expect(next.whitelist).toBeUndefined();

    // Файлы удалены.
    await expect(fs.access(path.join(tmpRoot, SLUG, "relationship.md"))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, SLUG, "conflict.json"))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, SLUG, "boundaries.md"))).rejects.toThrow();

    // Файлы созданы.
    await expect(fs.access(path.join(tmpRoot, SLUG, "mandate.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpRoot, SLUG, "tickets.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpRoot, SLUG, "contacts"))).resolves.toBeUndefined();

    const tickets = await storage.loadTickets(SLUG);
    expect(tickets).toEqual({ version: 1, nextId: 1, tickets: [] });

    const mandate = await storage.loadMandate(SLUG);
    expect(mandate).toContain("# Mandate");
  });

  it("логирует warning если ownerId не задан", async () => {
    const logs: string[] = [];
    await mod.migration0115.migrate({
      profilePath: path.join(tmpRoot, SLUG),
      config: { ...LEGACY_CONFIG, ownerId: 0 },
      log: (m) => logs.push(m)
    });
    expect(logs.some(m => m.includes("ownerId не задан"))).toBe(true);
  });

  it("сохраняет существующий mandate.md и tickets.json при повторном запуске", async () => {
    // Первый запуск создал шаблон. Меняем mandate, прогоняем повторно.
    await storage.saveMandate(SLUG, "# custom mandate\nкастомное содержимое");
    const before = await storage.loadMandate(SLUG);

    await mod.migration0115.migrate({
      profilePath: path.join(tmpRoot, SLUG),
      config: { ...LEGACY_CONFIG, ownerId: 42 },
      log: () => { /* noop */ }
    });

    expect(await storage.loadMandate(SLUG)).toBe(before);
  });
});
