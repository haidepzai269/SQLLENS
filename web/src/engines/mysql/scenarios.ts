export type MysqlScenarioId =
  | "gap_lock_paralysis"
  | "bank_transfer_deadlock"
  | "flash_sale_inventory"
  | "dirty_read_uncommitted";

export type MysqlStep = {
  connection: "a" | "b";
  sql: string;
  descKey: string;
  expectedBlock?: boolean;
  expectedDeadlock?: boolean;
};

export interface MysqlVariant {
  id: string;
  nameKey: string;
  steps: MysqlStep[];
}

export interface MysqlScenario {
  id: MysqlScenarioId;
  nameKey: string;
  aboutKey: string;
  learnKey: string;
  setupSql: string[];
  cleanupSql: string[];
  steps: MysqlStep[];
  variants?: MysqlVariant[];
}

export const MYSQL_SCENARIO_IDS: readonly MysqlScenarioId[] = [
  "gap_lock_paralysis",
  "bank_transfer_deadlock",
  "flash_sale_inventory",
  "dirty_read_uncommitted",
] as const;

export const MYSQL_SCENARIOS: Record<MysqlScenarioId, MysqlScenario> = {
  gap_lock_paralysis: {
    id: "gap_lock_paralysis",
    nameKey: "conflictSim.mysqlScenarios.gapLock.name",
    aboutKey: "conflictSim.mysqlScenarios.gapLock.about",
    learnKey: "conflictSim.mysqlScenarios.gapLock.learn",
    setupSql: [
      "DROP TABLE IF EXISTS lab_orders;",
      `CREATE TABLE lab_orders (
        id INT PRIMARY KEY,
        user_id INT NOT NULL,
        amount INT NOT NULL,
        INDEX idx_user_id (user_id)
      ) ENGINE=InnoDB;`,
      "INSERT INTO lab_orders (id, user_id, amount) VALUES (1, 10, 100), (2, 20, 200);",
    ],
    cleanupSql: ["DROP TABLE IF EXISTS lab_orders;"],
    steps: [
      {
        connection: "a",
        sql: "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; BEGIN;",
        descKey: "conflictSim.mysqlScenarios.gapLock.step1",
      },
      {
        connection: "b",
        sql: "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; BEGIN;",
        descKey: "conflictSim.mysqlScenarios.gapLock.step2",
      },
      {
        connection: "a",
        sql: "UPDATE lab_orders SET amount = 150 WHERE user_id = 10;",
        descKey: "conflictSim.mysqlScenarios.gapLock.step3",
      },
      {
        connection: "b",
        sql: "INSERT INTO lab_orders (id, user_id, amount) VALUES (3, 15, 300);",
        descKey: "conflictSim.mysqlScenarios.gapLock.step4",
        expectedBlock: true,
      },
      {
        connection: "a",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.gapLock.step5",
      },
      {
        connection: "b",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.gapLock.step6",
      },
    ],
  },

  bank_transfer_deadlock: {
    id: "bank_transfer_deadlock",
    nameKey: "conflictSim.mysqlScenarios.deadlock.name",
    aboutKey: "conflictSim.mysqlScenarios.deadlock.about",
    learnKey: "conflictSim.mysqlScenarios.deadlock.learn",
    setupSql: [
      "DROP TABLE IF EXISTS lab_accounts;",
      `CREATE TABLE lab_accounts (
        id INT PRIMARY KEY,
        balance INT NOT NULL
      ) ENGINE=InnoDB;`,
      "INSERT INTO lab_accounts (id, balance) VALUES (1, 1000), (2, 1000);",
    ],
    cleanupSql: ["DROP TABLE IF EXISTS lab_accounts;"],
    steps: [
      {
        connection: "a",
        sql: "BEGIN;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step1",
      },
      {
        connection: "b",
        sql: "BEGIN;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step2",
      },
      {
        connection: "a",
        sql: "UPDATE lab_accounts SET balance = balance - 100 WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step3",
      },
      {
        connection: "b",
        sql: "UPDATE lab_accounts SET balance = balance - 200 WHERE id = 2;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step4",
      },
      {
        connection: "a",
        sql: "UPDATE lab_accounts SET balance = balance + 100 WHERE id = 2;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step5",
        expectedBlock: true,
      },
      {
        connection: "b",
        sql: "UPDATE lab_accounts SET balance = balance + 200 WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step6",
        expectedDeadlock: true,
      },
      {
        connection: "a",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step7",
      },
      {
        connection: "b",
        sql: "ROLLBACK;",
        descKey: "conflictSim.mysqlScenarios.deadlock.step8",
      },
    ],
  },

  flash_sale_inventory: {
    id: "flash_sale_inventory",
    nameKey: "conflictSim.mysqlScenarios.flashSale.name",
    aboutKey: "conflictSim.mysqlScenarios.flashSale.about",
    learnKey: "conflictSim.mysqlScenarios.flashSale.learn",
    setupSql: [
      "DROP TABLE IF EXISTS lab_items;",
      `CREATE TABLE lab_items (
        id INT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        stock INT NOT NULL
      ) ENGINE=InnoDB;`,
      "INSERT INTO lab_items (id, name, stock) VALUES (1, 'Voucher 99%', 1);",
    ],
    cleanupSql: ["DROP TABLE IF EXISTS lab_items;"],
    steps: [
      {
        connection: "a",
        sql: "BEGIN;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step1",
      },
      {
        connection: "b",
        sql: "BEGIN;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step2",
      },
      {
        connection: "a",
        sql: "SELECT stock FROM lab_items WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step3",
      },
      {
        connection: "b",
        sql: "SELECT stock FROM lab_items WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step4",
      },
      {
        connection: "a",
        sql: "UPDATE lab_items SET stock = stock - 1 WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step5",
      },
      {
        connection: "a",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step6",
      },
      {
        connection: "b",
        sql: "UPDATE lab_items SET stock = stock - 1 WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step7",
      },
      {
        connection: "b",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.flashSale.race.step8",
      },
    ],
    variants: [
      {
        id: "for_update",
        nameKey: "conflictSim.mysqlScenarios.flashSale.variantForUpdate",
        steps: [
          {
            connection: "a",
            sql: "BEGIN;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step1",
          },
          {
            connection: "b",
            sql: "BEGIN;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step2",
          },
          {
            connection: "a",
            sql: "SELECT stock FROM lab_items WHERE id = 1 FOR UPDATE;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step3",
          },
          {
            connection: "b",
            sql: "SELECT stock FROM lab_items WHERE id = 1 FOR UPDATE;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step4",
            expectedBlock: true,
          },
          {
            connection: "a",
            sql: "UPDATE lab_items SET stock = stock - 1 WHERE id = 1;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step5",
          },
          {
            connection: "a",
            sql: "COMMIT;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step6",
          },
          {
            connection: "b",
            sql: "ROLLBACK;",
            descKey: "conflictSim.mysqlScenarios.flashSale.forUpdate.step7",
          },
        ],
      },
    ],
  },

  dirty_read_uncommitted: {
    id: "dirty_read_uncommitted",
    nameKey: "conflictSim.mysqlScenarios.dirtyRead.name",
    aboutKey: "conflictSim.mysqlScenarios.dirtyRead.about",
    learnKey: "conflictSim.mysqlScenarios.dirtyRead.learn",
    setupSql: [
      "DROP TABLE IF EXISTS lab_accounts;",
      `CREATE TABLE lab_accounts (
        id INT PRIMARY KEY,
        balance INT NOT NULL
      ) ENGINE=InnoDB;`,
      "INSERT INTO lab_accounts (id, balance) VALUES (1, 100);",
    ],
    cleanupSql: ["DROP TABLE IF EXISTS lab_accounts;"],
    steps: [
      {
        connection: "a",
        sql: "SET TRANSACTION ISOLATION LEVEL READ COMMITTED; BEGIN;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step1",
      },
      {
        connection: "b",
        sql: "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; BEGIN;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step2",
      },
      {
        connection: "a",
        sql: "UPDATE lab_accounts SET balance = 500 WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step3",
      },
      {
        connection: "b",
        sql: "SELECT balance FROM lab_accounts WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step4",
      },
      {
        connection: "a",
        sql: "ROLLBACK;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step5",
      },
      {
        connection: "b",
        sql: "SELECT balance FROM lab_accounts WHERE id = 1;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step6",
      },
      {
        connection: "b",
        sql: "COMMIT;",
        descKey: "conflictSim.mysqlScenarios.dirtyRead.step7",
      },
    ],
  },
};
