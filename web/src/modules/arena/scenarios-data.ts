// Dữ liệu và ánh xạ kịch bản Deadlock Arena (STR116 / Task168).
// Nguồn kịch bản đọc trực tiếp từ SCENARIOS trong conflict-sim engine.
// Tuyệt đối không lưu, không log, không gửi SQL của người dùng ra mạng (Core Rule 7).

import { SCENARIOS } from "@/modules/conflict-sim/engine/scenarios";
import { simulate } from "@/modules/conflict-sim/engine/simulate";
import type { ScenarioId } from "@/modules/conflict-sim/engine/types";
import type { ArenaScenarioConfig } from "./types";

export const ARENA_SCENARIO_IDS: ScenarioId[] = [
  "deadlock_reverse_order",
  "lost_update",
  "write_skew",
  "double_booking",
  "non_repeatable_read",
];

const DEADLOCK_REVERSE_ORDER_CONFIG: ArenaScenarioConfig = {
  id: "deadlock_reverse_order",
  nameKey: "scenarios.deadlock_reverse_order",
  aboutKey: "scenarios.about.deadlock_reverse_order",
  totalSteps: 5,
  steps: [
    {
      stepIndex: 0,
      titleKey: "steps.deadlock_reverse_order.step0.title",
      descriptionKey: "steps.deadlock_reverse_order.step0.description",
      transactions: {
        A: {
          session: "A",
          sql: "-- accounts (id=1: 100, id=2: 100)",
          status: "idle",
        },
        B: {
          session: "B",
          sql: "-- accounts (id=1: 100, id=2: 100)",
          status: "idle",
        },
      },
    },
    {
      stepIndex: 1,
      titleKey: "steps.deadlock_reverse_order.step1.title",
      descriptionKey: "steps.deadlock_reverse_order.step1.description",
      transactions: {
        A: {
          session: "A",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
        B: {
          session: "B",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
      },
    },
    {
      stepIndex: 2,
      titleKey: "steps.deadlock_reverse_order.step2.title",
      descriptionKey: "steps.deadlock_reverse_order.step2.description",
      transactions: {
        A: {
          session: "A",
          sql: "UPDATE accounts SET balance = balance - 10 WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "UPDATE accounts SET balance = balance - 10 WHERE id = 2",
          status: "active",
        },
      },
    },
    {
      stepIndex: 3,
      titleKey: "steps.deadlock_reverse_order.step3.title",
      descriptionKey: "steps.deadlock_reverse_order.step3.description",
      transactions: {
        A: {
          session: "A",
          sql: "UPDATE accounts SET balance = balance + 10 WHERE id = 2",
          status: "aborted",
        },
        B: {
          session: "B",
          sql: "UPDATE accounts SET balance = balance + 10 WHERE id = 1",
          status: "waiting",
        },
      },
      deadlockDetected: true,
      sqlstate: "40P01",
      errorMessageKey: "view.deadlockAlert",
    },
    {
      stepIndex: 4,
      titleKey: "steps.deadlock_reverse_order.step4.title",
      descriptionKey: "steps.deadlock_reverse_order.step4.description",
      transactions: {
        A: {
          session: "A",
          sql: "COMMIT",
          status: "aborted",
        },
        B: {
          session: "B",
          sql: "COMMIT",
          status: "committed",
        },
      },
    },
  ],
};

const LOST_UPDATE_CONFIG: ArenaScenarioConfig = {
  id: "lost_update",
  nameKey: "scenarios.lost_update",
  aboutKey: "scenarios.about.lost_update",
  totalSteps: 5,
  steps: [
    {
      stepIndex: 0,
      titleKey: "steps.lost_update.step0.title",
      descriptionKey: "steps.lost_update.step0.description",
      transactions: {
        A: {
          session: "A",
          sql: "-- accounts (id=1: 100)",
          status: "idle",
        },
        B: {
          session: "B",
          sql: "-- accounts (id=1: 100)",
          status: "idle",
        },
      },
    },
    {
      stepIndex: 1,
      titleKey: "steps.lost_update.step1.title",
      descriptionKey: "steps.lost_update.step1.description",
      transactions: {
        A: {
          session: "A",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
        B: {
          session: "B",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
      },
    },
    {
      stepIndex: 2,
      titleKey: "steps.lost_update.step2.title",
      descriptionKey: "steps.lost_update.step2.description",
      transactions: {
        A: {
          session: "A",
          sql: "SELECT balance FROM accounts WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "SELECT balance FROM accounts WHERE id = 1",
          status: "active",
        },
      },
    },
    {
      stepIndex: 3,
      titleKey: "steps.lost_update.step3.title",
      descriptionKey: "steps.lost_update.step3.description",
      transactions: {
        A: {
          session: "A",
          sql: "UPDATE accounts SET balance = 110 WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "UPDATE accounts SET balance = 120 WHERE id = 1",
          status: "waiting",
        },
      },
      conflictDetected: true,
      errorMessageKey: "view.conflictAlert",
    },
    {
      stepIndex: 4,
      titleKey: "steps.lost_update.step4.title",
      descriptionKey: "steps.lost_update.step4.description",
      transactions: {
        A: {
          session: "A",
          sql: "COMMIT",
          status: "committed",
        },
        B: {
          session: "B",
          sql: "COMMIT",
          status: "committed",
        },
      },
    },
  ],
};

const WRITE_SKEW_CONFIG: ArenaScenarioConfig = {
  id: "write_skew",
  nameKey: "scenarios.write_skew",
  aboutKey: "scenarios.about.write_skew",
  totalSteps: 5,
  steps: [
    {
      stepIndex: 0,
      titleKey: "steps.write_skew.step0.title",
      descriptionKey: "steps.write_skew.step0.description",
      transactions: {
        A: {
          session: "A",
          sql: "-- doctors (id=1: true, id=2: true)",
          status: "idle",
        },
        B: {
          session: "B",
          sql: "-- doctors (id=1: true, id=2: true)",
          status: "idle",
        },
      },
    },
    {
      stepIndex: 1,
      titleKey: "steps.write_skew.step1.title",
      descriptionKey: "steps.write_skew.step1.description",
      transactions: {
        A: {
          session: "A",
          sql: "BEGIN ISOLATION LEVEL REPEATABLE READ",
          status: "active",
        },
        B: {
          session: "B",
          sql: "BEGIN ISOLATION LEVEL REPEATABLE READ",
          status: "active",
        },
      },
    },
    {
      stepIndex: 2,
      titleKey: "steps.write_skew.step2.title",
      descriptionKey: "steps.write_skew.step2.description",
      transactions: {
        A: {
          session: "A",
          sql: "SELECT count(*) FROM doctors WHERE on_call = true",
          status: "active",
        },
        B: {
          session: "B",
          sql: "SELECT count(*) FROM doctors WHERE on_call = true",
          status: "active",
        },
      },
    },
    {
      stepIndex: 3,
      titleKey: "steps.write_skew.step3.title",
      descriptionKey: "steps.write_skew.step3.description",
      transactions: {
        A: {
          session: "A",
          sql: "UPDATE doctors SET on_call = false WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "UPDATE doctors SET on_call = false WHERE id = 2",
          status: "active",
        },
      },
      conflictDetected: true,
      errorMessageKey: "view.conflictAlert",
    },
    {
      stepIndex: 4,
      titleKey: "steps.write_skew.step4.title",
      descriptionKey: "steps.write_skew.step4.description",
      transactions: {
        A: {
          session: "A",
          sql: "COMMIT",
          status: "committed",
        },
        B: {
          session: "B",
          sql: "COMMIT",
          status: "committed",
        },
      },
    },
  ],
};

const DOUBLE_BOOKING_CONFIG: ArenaScenarioConfig = {
  id: "double_booking",
  nameKey: "scenarios.double_booking",
  aboutKey: "scenarios.about.double_booking",
  totalSteps: 5,
  steps: [
    {
      stepIndex: 0,
      titleKey: "steps.double_booking.step0.title",
      descriptionKey: "steps.double_booking.step0.description",
      transactions: {
        A: {
          session: "A",
          sql: "-- bookings & rooms (slot=1 empty)",
          status: "idle",
        },
        B: {
          session: "B",
          sql: "-- bookings & rooms (slot=1 empty)",
          status: "idle",
        },
      },
    },
    {
      stepIndex: 1,
      titleKey: "steps.double_booking.step1.title",
      descriptionKey: "steps.double_booking.step1.description",
      transactions: {
        A: {
          session: "A",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
        B: {
          session: "B",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
      },
    },
    {
      stepIndex: 2,
      titleKey: "steps.double_booking.step2.title",
      descriptionKey: "steps.double_booking.step2.description",
      transactions: {
        A: {
          session: "A",
          sql: "SELECT 1 FROM bookings WHERE slot = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "SELECT 1 FROM bookings WHERE slot = 1",
          status: "active",
        },
      },
    },
    {
      stepIndex: 3,
      titleKey: "steps.double_booking.step3.title",
      descriptionKey: "steps.double_booking.step3.description",
      transactions: {
        A: {
          session: "A",
          sql: "INSERT INTO bookings (slot, who) VALUES (1, 'A')",
          status: "active",
        },
        B: {
          session: "B",
          sql: "INSERT INTO bookings (slot, who) VALUES (1, 'B')",
          status: "active",
        },
      },
      conflictDetected: true,
      errorMessageKey: "view.conflictAlert",
    },
    {
      stepIndex: 4,
      titleKey: "steps.double_booking.step4.title",
      descriptionKey: "steps.double_booking.step4.description",
      transactions: {
        A: {
          session: "A",
          sql: "COMMIT",
          status: "committed",
        },
        B: {
          session: "B",
          sql: "COMMIT",
          status: "committed",
        },
      },
    },
  ],
};

const NON_REPEATABLE_READ_CONFIG: ArenaScenarioConfig = {
  id: "non_repeatable_read",
  nameKey: "scenarios.non_repeatable_read",
  aboutKey: "scenarios.about.non_repeatable_read",
  totalSteps: 5,
  steps: [
    {
      stepIndex: 0,
      titleKey: "steps.non_repeatable_read.step0.title",
      descriptionKey: "steps.non_repeatable_read.step0.description",
      transactions: {
        A: {
          session: "A",
          sql: "-- accounts (id=1: 100)",
          status: "idle",
        },
        B: {
          session: "B",
          sql: "-- accounts (id=1: 100)",
          status: "idle",
        },
      },
    },
    {
      stepIndex: 1,
      titleKey: "steps.non_repeatable_read.step1.title",
      descriptionKey: "steps.non_repeatable_read.step1.description",
      transactions: {
        A: {
          session: "A",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
        B: {
          session: "B",
          sql: "BEGIN ISOLATION LEVEL READ COMMITTED",
          status: "active",
        },
      },
    },
    {
      stepIndex: 2,
      titleKey: "steps.non_repeatable_read.step2.title",
      descriptionKey: "steps.non_repeatable_read.step2.description",
      transactions: {
        A: {
          session: "A",
          sql: "SELECT balance FROM accounts WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "UPDATE accounts SET balance = 200 WHERE id = 1; COMMIT;",
          status: "committed",
        },
      },
    },
    {
      stepIndex: 3,
      titleKey: "steps.non_repeatable_read.step3.title",
      descriptionKey: "steps.non_repeatable_read.step3.description",
      transactions: {
        A: {
          session: "A",
          sql: "SELECT balance FROM accounts WHERE id = 1",
          status: "active",
        },
        B: {
          session: "B",
          sql: "-- Đã commit trước đó",
          status: "idle",
        },
      },
      conflictDetected: true,
      errorMessageKey: "view.conflictAlert",
    },
    {
      stepIndex: 4,
      titleKey: "steps.non_repeatable_read.step4.title",
      descriptionKey: "steps.non_repeatable_read.step4.description",
      transactions: {
        A: {
          session: "A",
          sql: "COMMIT",
          status: "committed",
        },
        B: {
          session: "B",
          sql: "-- Không có thao tác",
          status: "idle",
        },
      },
    },
  ],
};

const CONFIG_MAP: Record<ScenarioId, ArenaScenarioConfig> = {
  deadlock_reverse_order: DEADLOCK_REVERSE_ORDER_CONFIG,
  lost_update: LOST_UPDATE_CONFIG,
  write_skew: WRITE_SKEW_CONFIG,
  double_booking: DOUBLE_BOOKING_CONFIG,
  non_repeatable_read: NON_REPEATABLE_READ_CONFIG,
};

/**
 * Trả về cấu hình kịch bản Arena kèm kết quả kiểm chứng từ simulate engine.
 */
export function getArenaScenario(id: ScenarioId): ArenaScenarioConfig {
  const base = SCENARIOS[id];
  if (!base) {
    throw new Error(`Scenario ${id} not found in SCENARIOS`);
  }
  // Xác thực rằng engine simulate chạy được trên kịch bản này
  const sim = simulate(base);
  if (sim.kind !== "conclusion") {
    throw new Error(`Simulation failed for scenario ${id}`);
  }
  return CONFIG_MAP[id] ?? DEADLOCK_REVERSE_ORDER_CONFIG;
}

export function getArenaScenarioList(): ScenarioId[] {
  return [...ARENA_SCENARIO_IDS];
}
