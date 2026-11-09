import { describe, expect, it, vi } from "vitest";
import { MysqlConflictRunner } from "./conflict-runner";
import { MYSQL_SCENARIOS } from "./scenarios";

describe("MysqlConflictRunner (AC1 & AC2)", () => {
  it("coordinates execution between 2 independent connections 'a' and 'b'", async () => {
    const executed: { sql: string; connection?: "a" | "b" }[] = [];
    const mockExecute = vi.fn(async (sql: string, opts?: { connection?: "a" | "b" }) => {
      executed.push({ sql, connection: opts?.connection });
      return [{ columns: ["ok"], rows: [[1]] }];
    });

    const runner = new MysqlConflictRunner(MYSQL_SCENARIOS.gap_lock_paralysis, {
      execute: mockExecute,
      sessionId: async () => "session-12345",
    });

    await runner.start();
    // Setup queries were run on connection a
    expect(executed.length).toBeGreaterThan(0);
    expect(executed[0].connection).toBe("a");

    executed.length = 0;
    // Step 1: connection a
    await runner.next();
    expect(executed[0].connection).toBe("a");
    expect(runner.getState().stepIndex).toBe(1);

    // Step 2: connection b
    await runner.next();
    expect(executed[1].connection).toBe("b");
    expect(runner.getState().stepIndex).toBe(2);

    runner.dispose();
  });

  it("handles deadlock error (1213) by flagging cycle and aborted session", async () => {
    const mockExecute = vi.fn(async (sql: string) => {
      if (sql.includes("+ 200 WHERE id = 1")) {
        throw new Error("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction");
      }
      return [{ columns: [], rows: [] }];
    });

    const runner = new MysqlConflictRunner(MYSQL_SCENARIOS.bank_transfer_deadlock, {
      execute: mockExecute,
      sessionId: async () => "session-12345",
    });

    await runner.start();
    // Chạy tới bước 6 (bước gây deadlock)
    for (let i = 0; i < 6; i++) {
      await runner.next();
    }

    const state = runner.getState();
    expect(state.cycle).toBe(true);
    expect(state.abortedSession).toBe("B");
    expect(state.sessionStates.B).toBe("aborted");
    expect(state.logs[5].status).toBe("deadlock");

    runner.dispose();
  });

  it("parses lock_change event and builds wait edges for Cytoscape", async () => {
    let stateChangeCount = 0;
    const runner = new MysqlConflictRunner(MYSQL_SCENARIOS.gap_lock_paralysis, {
      execute: vi.fn().mockResolvedValue([]),
      sessionId: async () => "session-12345",
      onStateChange: () => {
        stateChangeCount++;
      },
    });

    await runner.start();

    // Giả lập nhận event lock_change
    const sampleLockData = JSON.stringify({
      waits: {
        rows: [
          [20, 10, "RECORD", "X,GAP", "lab_orders", "idx_user_id"],
        ],
      },
      locks: { rows: [] },
      connections: { a: 10, b: 20 },
    });

    // Gọi hàm parse qua reflection/event
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runner as any).handleLockChange(sampleLockData);

    const state = runner.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0]).toEqual({
      waiter: "B",
      holder: "A",
      resource: "idx_user_id",
    });
    expect(state.sessionStates.B).toBe("waiting");
    expect(stateChangeCount).toBeGreaterThan(0);

    runner.dispose();
  });

  it("supports reset and variant switching", async () => {
    const mockExecute = vi.fn().mockResolvedValue([]);
    const runner = new MysqlConflictRunner(
      MYSQL_SCENARIOS.flash_sale_inventory,
      {
        execute: mockExecute,
        sessionId: async () => "session-12345",
      },
      "for_update"
    );

    await runner.start();
    expect(runner.getState().variantId).toBe("for_update");
    expect(runner.getState().totalSteps).toBe(7);

    await runner.next();
    expect(runner.getState().stepIndex).toBe(1);

    await runner.reset();
    expect(runner.getState().stepIndex).toBe(0);
    expect(runner.getState().logs).toHaveLength(0);

    runner.dispose();
  });
});
