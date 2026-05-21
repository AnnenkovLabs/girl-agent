/**
 * CLI tests for `manager-agent` (Task 5.9 manager-mode).
 *
 * Покрытие Requirement 20:
 *   - 20.4: несуществующий --profile=<slug> печатает существующие.
 *   - 20.5: подкоманда `server` имеет флаги --config / --headless / --print-config.
 *   - 20.6: невалидный --config=<path> возвращает ошибку с указанием пути.
 *   - 20.7: --print-config печатает шаблон с MANAGER_AGENT_*.
 *   - 20.8: ни одна команда / флаг не содержит подстроку girl-agent.
 *
 * Тесты импортируют чистые helper-функции из `cli-args.ts` и
 * `server.ts` — без вызова `main()` cli.ts (он содержит side-effects).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KNOWN_CLI_FLAGS,
  KNOWN_SUBCOMMANDS,
  containsLegacyName,
  describeInvalidConfigPath,
  describeMissingProfile
} from "../cli-args.js";
import { buildConfigTemplate, tryLoadConfigFile } from "../server.js";

describe("CLI helpers (Task 5.9 manager-mode, Requirement 20)", () => {
  describe("--print-config (Req 20.7)", () => {
    it("печатает валидный JSON и завершается без побочных эффектов", () => {
      const out = buildConfigTemplate();
      expect(out.length).toBeGreaterThan(0);
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it("шаблон документирует переменные окружения с префиксом MANAGER_AGENT_", () => {
      const out = buildConfigTemplate();
      expect(out).toContain("MANAGER_AGENT_DATA");
      expect(out).toContain("MANAGER_AGENT_PORT");
      expect(out).toContain("MANAGER_AGENT_OWNER_ID");
      expect(out).toContain("MANAGER_AGENT_API_KEY");
      // Все упоминания env-vars начинаются с правильного префикса.
      const matches = out.match(/MANAGER_AGENT_[A-Z_]+/g) ?? [];
      expect(matches.length).toBeGreaterThan(5);
      for (const m of matches) {
        expect(m.startsWith("MANAGER_AGENT_")).toBe(true);
      }
    });

    it("шаблон не содержит подстроку GIRL_AGENT_ (Req 20.8)", () => {
      const out = buildConfigTemplate();
      expect(out).not.toContain("GIRL_AGENT_");
    });
  });

  describe("--profile=<slug> для несуществующих профилей (Req 20.3, 20.4)", () => {
    it("печатает существующие профили в виде маркированного списка", () => {
      const msg = describeMissingProfile("ghost", ["anya", "boss-test", "qa"]);
      expect(msg).toContain("профиль не найден: ghost");
      expect(msg).toContain("- anya");
      expect(msg).toContain("- boss-test");
      expect(msg).toContain("- qa");
      expect(msg).toContain("(3)");
    });

    it("при отсутствии профилей печатает подсказку о WebUI / server", () => {
      const msg = describeMissingProfile("ghost", []);
      expect(msg).toContain("профиль не найден: ghost");
      expect(msg.toLowerCase()).toContain("webui");
      expect(msg.toLowerCase()).toContain("server");
    });
  });

  describe("--config=<path> валидация (Req 20.5, 20.6)", () => {
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-cli-spec-"));
    });

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("несуществующий путь → ok=false, reason содержит сообщение fs", async () => {
      const missing = path.join(tmpDir, "does-not-exist.json");
      const res = await tryLoadConfigFile(missing);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.absPath).toBe(missing);
        expect(res.reason.length).toBeGreaterThan(0);
        // describeInvalidConfigPath собирает ровно ту строку, которую печатает CLI.
        const formatted = describeInvalidConfigPath(res.absPath, res.reason);
        expect(formatted).toContain(missing);
        expect(formatted).toContain("[server]");
      }
    });

    it("невалидный JSON → ok=false с указанием пути и причины", async () => {
      const file = path.join(tmpDir, "broken.json");
      await fs.writeFile(file, "{ this is not json", "utf-8");
      const res = await tryLoadConfigFile(file);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.absPath).toBe(file);
        expect(res.reason.toLowerCase()).toContain("json");
      }
    });

    it("валидный JSON, но без обязательных полей → ok=false с перечислением полей", async () => {
      const file = path.join(tmpDir, "empty.json");
      await fs.writeFile(file, JSON.stringify({ name: "anya" }), "utf-8");
      const res = await tryLoadConfigFile(file);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("age");
      }
    });

    it("валидный шаблон --print-config проходит через tryLoadConfigFile", async () => {
      const tmpl = buildConfigTemplate();
      const file = path.join(tmpDir, "from-template.json");
      await fs.writeFile(file, tmpl, "utf-8");
      const res = await tryLoadConfigFile(file);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.config.name.length).toBeGreaterThan(0);
        expect(res.config.llm.presetId.length).toBeGreaterThan(0);
      }
    });

    it("относительный путь резолвится от cwd", async () => {
      const res = await tryLoadConfigFile("totally-not-existing-relative.json");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(path.isAbsolute(res.absPath)).toBe(true);
      }
    });
  });

  describe("girl-agent leak guard (Req 20.8)", () => {
    it("ни одна публичная подкоманда не содержит girl-agent", () => {
      for (const sub of KNOWN_SUBCOMMANDS) {
        expect(containsLegacyName(sub), `subcommand "${sub}" leaks girl-agent`).toBe(false);
      }
    });

    it("ни один CLI-флаг не содержит girl-agent", () => {
      for (const flag of KNOWN_CLI_FLAGS) {
        expect(containsLegacyName(flag), `flag "--${flag}" leaks girl-agent`).toBe(false);
      }
    });

    it("containsLegacyName распознаёт обе формы: kebab и нижний регистр", () => {
      expect(containsLegacyName("girl-agent")).toBe(true);
      expect(containsLegacyName("Girl-Agent")).toBe(true);
      expect(containsLegacyName("manager-agent")).toBe(false);
      expect(containsLegacyName("girl_agent")).toBe(false); // только дефисная форма
    });
  });
});
