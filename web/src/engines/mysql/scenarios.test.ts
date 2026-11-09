import { describe, expect, it } from "vitest";
import { MYSQL_SCENARIO_IDS, MYSQL_SCENARIOS } from "./scenarios";

describe("MySQL Scenarios (AC3)", () => {
  it("defines exactly the 4 required battle scenarios", () => {
    expect(MYSQL_SCENARIO_IDS).toEqual([
      "gap_lock_paralysis",
      "bank_transfer_deadlock",
      "flash_sale_inventory",
      "dirty_read_uncommitted",
    ]);
  });

  it("ensures each scenario has setup and cleanup DDL for disk safety", () => {
    for (const id of MYSQL_SCENARIO_IDS) {
      const scenario = MYSQL_SCENARIOS[id];
      expect(scenario.setupSql.length).toBeGreaterThan(0);
      expect(scenario.cleanupSql.length).toBeGreaterThan(0);
      expect(scenario.cleanupSql.some((s) => s.toUpperCase().includes("DROP TABLE"))).toBe(true);
    }
  });

  it("ensures all steps use valid connection 'a' or 'b'", () => {
    for (const id of MYSQL_SCENARIO_IDS) {
      const scenario = MYSQL_SCENARIOS[id];
      for (const step of scenario.steps) {
        expect(["a", "b"]).toContain(step.connection);
        expect(step.sql.trim().length).toBeGreaterThan(0);
        expect(step.descKey.length).toBeGreaterThan(0);
      }
      if (scenario.variants) {
        for (const variant of scenario.variants) {
          for (const step of variant.steps) {
            expect(["a", "b"]).toContain(step.connection);
            expect(step.sql.trim().length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("verifies flash_sale_inventory includes pessimistic locking variant (FOR UPDATE)", () => {
    const flashSale = MYSQL_SCENARIOS.flash_sale_inventory;
    expect(flashSale.variants).toBeDefined();
    expect(flashSale.variants?.some((v) => v.id === "for_update")).toBe(true);
    const forUpdateVariant = flashSale.variants?.find((v) => v.id === "for_update");
    expect(forUpdateVariant?.steps.some((s) => s.sql.toUpperCase().includes("FOR UPDATE"))).toBe(true);
  });

  it("verifies bank_transfer_deadlock has expected deadlock flagged step", () => {
    const deadlock = MYSQL_SCENARIOS.bank_transfer_deadlock;
    expect(deadlock.steps.some((s) => s.expectedDeadlock)).toBe(true);
  });
});
