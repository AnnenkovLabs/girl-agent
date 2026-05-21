/**
 * Тесты engine/gate.ts (Task 4.8 .kiro/specs/manager-mode/tasks.md).
 *
 * Покрывают все три значения `cfg.gateLevel` (Req 17.1-17.6) и hot-reload
 * через идею «функция читает gateLevel/whitelist на каждом вызове, без
 * внутреннего кеша». Полный runtime-тест fs.watch вынесен в task 4.12 —
 * здесь мы валидируем чистую функцию, чтобы поведение runtime было
 * предсказуемо.
 */
import { describe, it, expect } from "vitest";

import {
  evaluateGate,
  matchesWhitelist,
  GATED_COLD_STRANGER_LIMIT,
  type GateContact
} from "../../engine/gate.js";
import type { Tier, WhitelistEntry } from "../../types.js";

function makeContact(overrides: Partial<GateContact> = {}): GateContact {
  return {
    chatId: "100",
    tier: "cold-stranger",
    manualOverride: false,
    ...overrides
  };
}

describe("evaluateGate: gateLevel=open (Req 17.3)", () => {
  it("пропускает любого контакта, включая cold-stranger", () => {
    const result = evaluateGate({
      gateLevel: "open",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: 999
    });
    expect(result.action).toBe("allow");
  });

  it("пропускает blocked-контакта (caller отвечает за isBlocked-проверку)", () => {
    const result = evaluateGate({
      gateLevel: "open",
      contact: makeContact({ tier: "blocked" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("пропускает при пустом whitelist (whitelist игнорируется при open)", () => {
    const result = evaluateGate({
      gateLevel: "open",
      whitelist: [],
      contact: makeContact(),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });
});

describe("evaluateGate: gateLevel=gated (Req 17.4-17.5)", () => {
  it("cold-stranger с 0 ответами → allow", () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("cold-stranger с 1 ответом → allow", () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: 1
    });
    expect(result.action).toBe("allow");
  });

  it("cold-stranger с 2 ответами → allow", () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: 2
    });
    expect(result.action).toBe("allow");
  });

  it(`cold-stranger с ${GATED_COLD_STRANGER_LIMIT} ответами → force-escalate`, () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: GATED_COLD_STRANGER_LIMIT
    });
    expect(result).toEqual({
      action: "force-escalate",
      reason: "gated-quota-exceeded"
    });
  });

  it("cold-stranger с 4+ ответами → force-escalate", () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: 10
    });
    expect(result.action).toBe("force-escalate");
  });

  it("cold-stranger с manualOverride=true игнорирует квоту → allow", () => {
    const result = evaluateGate({
      gateLevel: "gated",
      contact: makeContact({ tier: "cold-stranger", manualOverride: true }),
      recentReplyCount24h: 100
    });
    expect(result.action).toBe("allow");
  });

  it("introduced/regular/trusted-partner/vip независимо от счётчика → allow", () => {
    const tiers: Tier[] = ["introduced", "regular", "trusted-partner", "vip"];
    for (const tier of tiers) {
      const result = evaluateGate({
        gateLevel: "gated",
        contact: makeContact({ tier }),
        recentReplyCount24h: 100
      });
      expect(result.action, `tier=${tier} should be allow`).toBe("allow");
    }
  });
});

describe("evaluateGate: gateLevel=whitelist (Req 17.6)", () => {
  const wl: WhitelistEntry[] = [
    { kind: "id", chatId: 12345 },
    { kind: "username", username: "alice" }
  ];

  it("совпадение по chatId → allow", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: wl,
      contact: makeContact({ chatId: "12345", tier: "cold-stranger" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("совпадение по @username (lowercase) → allow", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: wl,
      contact: makeContact({ chatId: "999", username: "alice", tier: "cold-stranger" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("регистронезависимое совпадение по @username (Req 17.6)", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "Alice" }],
      contact: makeContact({ chatId: "999", username: "ALICE" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("ведущий @ в whitelist игнорируется", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "@bob" }],
      contact: makeContact({ chatId: "999", username: "bob" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("ведущий @ в username контакта игнорируется", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "carol" }],
      contact: makeContact({ chatId: "999", username: "@carol" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("несовпадение → block", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: wl,
      contact: makeContact({ chatId: "999", username: "eve" }),
      recentReplyCount24h: 0
    });
    expect(result).toEqual({ action: "block", reason: "not-whitelisted" });
  });

  it("пустой whitelist → block", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [],
      contact: makeContact({ chatId: "12345", username: "alice" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("block");
  });

  it("undefined whitelist → block", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      contact: makeContact({ chatId: "12345" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("block");
  });

  it("числовой chatId совпадает со строковым chatId контакта", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "id", chatId: 42 }],
      contact: makeContact({ chatId: "42" }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("allow");
  });

  it("username без значения у контакта → нет совпадения по username", () => {
    const result = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "alice" }],
      contact: makeContact({ chatId: "999", username: undefined }),
      recentReplyCount24h: 0
    });
    expect(result.action).toBe("block");
  });
});

describe("matchesWhitelist (helper)", () => {
  it("kind=id строковое равенство", () => {
    expect(
      matchesWhitelist({ kind: "id", chatId: 7 }, { chatId: "7", tier: "regular" })
    ).toBe(true);
    expect(
      matchesWhitelist({ kind: "id", chatId: 7 }, { chatId: "8", tier: "regular" })
    ).toBe(false);
  });

  it("kind=username регистронезависимо с @-префиксом", () => {
    expect(
      matchesWhitelist(
        { kind: "username", username: "@Bob" },
        { chatId: "1", username: "BOB", tier: "regular" }
      )
    ).toBe(true);
  });

  it("kind=username не совпадает с пустым username контакта", () => {
    expect(
      matchesWhitelist(
        { kind: "username", username: "alice" },
        { chatId: "1", tier: "regular" }
      )
    ).toBe(false);
  });
});

describe("evaluateGate: undefined gateLevel дефолтно gated (Req 17.2)", () => {
  it("undefined → ведёт себя как gated (cold-stranger при превышении квоты → force-escalate)", () => {
    const result = evaluateGate({
      gateLevel: undefined,
      contact: makeContact({ tier: "cold-stranger" }),
      recentReplyCount24h: GATED_COLD_STRANGER_LIMIT
    });
    expect(result.action).toBe("force-escalate");
  });
});

/**
 * Hot-reload property (Req 17.7): функция чистая и читает `gateLevel` и
 * `whitelist` из аргументов на каждом вызове. В сочетании с runtime,
 * который держит `cfg.gateLevel`/`cfg.whitelist` в `this.cfg` и
 * пере-применяет их через `subscribeConfig`, это даёт «без рестарта»
 * за ≤5 секунд (тайминг fs.watch покрывается test-suite-ом storage).
 *
 * Этот тест моделирует «изменение конфигурации между сообщениями»: один
 * и тот же контакт вызывает функцию дважды с разными `gateLevel` и
 * получает разные решения, доказывая отсутствие внутреннего кеша.
 */
describe("evaluateGate: hot-reload через переданный gateLevel (Req 17.7)", () => {
  it("смена gateLevel между вызовами меняет решение для того же контакта", () => {
    const contact = makeContact({
      chatId: "555",
      username: "stranger",
      tier: "cold-stranger"
    });

    // 1) gated с превышенной квотой → force-escalate
    const gated = evaluateGate({
      gateLevel: "gated",
      contact,
      recentReplyCount24h: 5
    });
    expect(gated.action).toBe("force-escalate");

    // 2) Владелец меняет gateLevel на open в WebUI → allow
    const open = evaluateGate({
      gateLevel: "open",
      contact,
      recentReplyCount24h: 5
    });
    expect(open.action).toBe("allow");

    // 3) Владелец меняет на whitelist без записей → block
    const whitelist = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [],
      contact,
      recentReplyCount24h: 0
    });
    expect(whitelist.action).toBe("block");

    // 4) Добавляет контакт в whitelist → allow
    const whitelistAllow = evaluateGate({
      gateLevel: "whitelist",
      whitelist: [{ kind: "username", username: "stranger" }],
      contact,
      recentReplyCount24h: 0
    });
    expect(whitelistAllow.action).toBe("allow");
  });
});


/**
 * Integration-тест hot-reload (Req 17.7): `subscribeConfig` подхватывает
 * изменения `config.json` через `fs.watch` и пере-выдаёт обновлённый
 * `ProfileConfig` на колбэк за ≤5 секунд. Runtime использует это для
 * применения новых `gateLevel`/`whitelist` без рестарта.
 *
 * Тест выполнен в стиле существующего mandate.spec — pure I/O без сетевых
 * вызовов; на Windows fs.watch иногда дебаунсит, поэтому таймаут щедрый.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("subscribeConfig: hot-reload gateLevel/whitelist (Req 17.7)", () => {
  it("колбэк дёргается при изменении config.json (≤5 секунд)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manager-agent-cfg-watch-"));
    process.env.MANAGER_AGENT_DATA = tmpRoot;
    try {
      const slug = "watch-spec";
      const dir = path.join(tmpRoot, slug);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, "config.json");

      const baseCfg = {
        slug,
        name: "Watch Spec",
        age: 30,
        nationality: "RU",
        tz: "Europe/Moscow",
        mode: "bot",
        stage: "tg-given-cold",
        llm: {
          presetId: "claudehub",
          proto: "anthropic",
          apiKey: "x",
          model: "claude-sonnet-4.6"
        },
        telegram: {},
        privacy: "owner-only",
        createdAt: new Date().toISOString(),
        sleepFrom: 23,
        sleepTo: 8,
        nightWakeChance: 0.05,
        gateLevel: "open"
      };
      await fs.writeFile(file, JSON.stringify(baseCfg, null, 2), "utf8");

      const storage = await import("../../storage/md.js");
      const observed: string[] = [];
      const sub = storage.subscribeConfig(slug, (cfg) => {
        if (cfg.gateLevel) observed.push(cfg.gateLevel);
      });

      try {
        // Даём watcher-у инициализироваться.
        await new Promise(r => setTimeout(r, 80));

        // Меняем gateLevel.
        const next = { ...baseCfg, gateLevel: "whitelist", whitelist: [{ kind: "id", chatId: 1 }] };
        await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");

        // fs.watch на Windows может дебаунсить — ждём до 5 секунд.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !observed.includes("whitelist")) {
          await new Promise(r => setTimeout(r, 100));
        }
        expect(observed).toContain("whitelist");
      } finally {
        sub.close();
      }
    } finally {
      delete process.env.MANAGER_AGENT_DATA;
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  }, 10000);
});
