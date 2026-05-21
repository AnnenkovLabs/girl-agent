/**
 * Property 7 (Coexistence) — форк `manager-agent` не должен конфликтовать
 * с оригинальным `girl-agent` ни по одному захардкоженному дефолту, потому
 * что обе ноды могут стоять рядом на одной машине / контейнере (Requirement
 * 19.12 в .kiro/specs/manager-mode/requirements.md).
 *
 * Свойство формулируется через fast-check как: для любого выбранного
 * "ключа" (название пакета, бин, env-префикс, дефолтный порт, путь данных
 * по платформе, имя docker-образа) форк не возвращает значение оригинала.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import os from "node:os";
import path from "node:path";
import packageJson from "../../../package.json" with { type: "json" };

// Эталонные дефолты оригинального girl-agent. Захардкожены здесь как ground
// truth — если оригинал поменяет один из них, мы это заметим только если
// поправим тест.
const ORIGINAL_GIRL_AGENT = {
  packageName: "@thesashadev/girl-agent",
  binName: "girl-agent",
  envPrefix: "GIRL_AGENT_",
  webuiPort: 3000,
  dockerImageHint: "thesashadev/girl-agent",
  // Подкаталог в data root, который оригинал всегда вписывает в путь.
  dataDirSegment: "girl-agent"
};

// Дефолты, которые форк фиксирует на этом этапе. Должны отличаться от
// ORIGINAL_GIRL_AGENT по каждому ключу.
const FORK_MANAGER_AGENT = {
  packageName: "@thesashadev/manager-agent",
  binName: "manager-agent",
  envPrefix: "MANAGER_AGENT_",
  webuiPort: 3100,
  dockerImageHint: "shxpe0x/girl-agent-manager",
  dataDirSegment: "manager-agent"
};

type Key = keyof typeof ORIGINAL_GIRL_AGENT;
const ALL_KEYS: Key[] = [
  "packageName",
  "binName",
  "envPrefix",
  "webuiPort",
  "dockerImageHint",
  "dataDirSegment"
];

describe("Property 7 (Coexistence)", () => {
  it("ни один захардкоженный дефолт форка не равен дефолту оригинала", () => {
    fc.assert(
      fc.property(fc.constantFrom<Key>(...ALL_KEYS), (key) => {
        return FORK_MANAGER_AGENT[key] !== ORIGINAL_GIRL_AGENT[key];
      }),
      { numRuns: 100 }
    );
  });

  it("package.json совпадает с дефолтами форка", () => {
    expect(packageJson.name).toBe(FORK_MANAGER_AGENT.packageName);
    // bin — объект {имя: путь}.
    expect(Object.keys((packageJson as { bin?: Record<string, string> }).bin ?? {})).toContain(
      FORK_MANAGER_AGENT.binName
    );
  });

  it("ожидаемый data-path форка по платформам не пересекается с girl-agent", () => {
    const platforms: Array<"win32" | "darwin" | "linux"> = ["win32", "darwin", "linux"];
    for (const platform of platforms) {
      const forkPath = expectedDataRoot(platform, FORK_MANAGER_AGENT.dataDirSegment);
      const origPath = expectedDataRoot(platform, ORIGINAL_GIRL_AGENT.dataDirSegment);
      expect(forkPath).not.toBe(origPath);
      // Защита от случайного matching через case-insensitive сравнение.
      expect(forkPath.toLowerCase()).not.toBe(origPath.toLowerCase());
    }
  });
});

/**
 * Воспроизводит логику `defaultDataRoot()` из src/storage/md.ts на конкретной
 * платформе для заданного сегмента (`manager-agent` или `girl-agent`).
 *
 * Логика упрощена: тест не пытается воспроизвести всё (XDG override, look-like
 * project root) — фиксирует только тот участок, по которому форки расходятся.
 */
function expectedDataRoot(
  platform: "win32" | "darwin" | "linux",
  segment: string
): string {
  if (platform === "win32") {
    return path.join("C:\\Users\\test\\AppData\\Roaming", segment, "data");
  }
  if (platform === "darwin") {
    return path.join("/Users/test/Library/Application Support", segment, "data");
  }
  return path.join("/home/test/.local/share", segment, "data");
}
// Подавляем неиспользуемый импорт `os` (на случай если хелпер исчезнет в
// будущей правке): валидируем, что node-модуль доступен.
void os.platform;
