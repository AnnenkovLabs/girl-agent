/**
 * Тесты mandate storage (Task 3.5 manager-mode).
 *
 * Покрывают `loadMandate`, `saveMandate` и `subscribeMandate` с hot-reload
 * через `fs.watch`. fs.watch на Windows иногда дебаунсит изменения, поэтому
 * timeout щедрый.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRoot: string;
let mod: typeof import("../../storage/md.js");
const SLUG = "test-mandate-profile";

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-mandate-"));
  process.env.MANAGER_AGENT_DATA = tmpRoot;
  mod = await import("../../storage/md.js");
});

afterAll(async () => {
  delete process.env.MANAGER_AGENT_DATA;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("mandate storage", () => {
  it("loadMandate возвращает пустую строку на новом профиле", async () => {
    expect(await mod.loadMandate(SLUG)).toBe("");
  });

  it("saveMandate + loadMandate — round-trip", async () => {
    const text = "# Mandate\n\n- Решаю сама: цены до 50 000\n- Эскалирую: всё остальное\n";
    await mod.saveMandate(SLUG, text);
    expect(await mod.loadMandate(SLUG)).toBe(text);
  });

  it("subscribeMandate реагирует на изменения файла через fs.watch", async () => {
    let received = "";
    const sub = mod.subscribeMandate(SLUG, (text) => { received = text; });
    // даём watcher'у инициализироваться
    await new Promise(r => setTimeout(r, 50));
    await mod.saveMandate(SLUG, "v2");
    // даём fs.watch время доставить событие
    for (let i = 0; i < 50; i++) {
      if (received === "v2") break;
      await new Promise(r => setTimeout(r, 100));
    }
    sub.close();
    expect(received).toBe("v2");
  }, 10000);

  it("subscribeMandate.close() идемпотентно", () => {
    const sub = mod.subscribeMandate(SLUG, () => { /* noop */ });
    sub.close();
    expect(() => sub.close()).not.toThrow();
  });
});
