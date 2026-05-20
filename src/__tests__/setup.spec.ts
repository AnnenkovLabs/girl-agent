import { describe, it, expect } from "vitest";

// Smoke-тест проверки запуска vitest. Удаляется задачей 1.4
// (см. .kiro/specs/manager-mode/tasks.md), когда появится первое
// property-based свойство на fast-check.
describe("vitest setup", () => {
  it("выполняет dummy-тест 1 + 1 === 2", () => {
    expect(1 + 1).toBe(2);
  });
});
