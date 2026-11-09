import type { QueryResult } from "@/contracts/engine";
import type { MysqlScenario, MysqlStep } from "./scenarios";

export type SessionKey = "A" | "B";
export type SessionState = "idle" | "running" | "waiting" | "aborted" | "committed" | "rolledBack";

export interface WaitEdge {
  waiter: SessionKey;
  holder: SessionKey;
  resource: string;
}

export interface StepLog {
  stepIndex: number;
  connection: "a" | "b";
  sql: string;
  descKey: string;
  status: "ran" | "waiting" | "deadlock" | "error" | "resumed";
  errorMsg?: string;
  result?: unknown[][];
}

export interface MysqlRunnerState {
  scenario: MysqlScenario;
  variantId?: string;
  stepIndex: number;
  totalSteps: number;
  isRunning: boolean;
  isPaused: boolean;
  edges: WaitEdge[];
  cycle: boolean;
  abortedSession: SessionKey | null;
  sessionStates: Record<SessionKey, SessionState>;
  logs: StepLog[];
}

export interface MysqlConflictRunnerOptions {
  execute: (
    sql: string,
    options?: { signal?: AbortSignal; internal?: boolean; connection?: "a" | "b" }
  ) => Promise<QueryResult[]>;
  sessionId: () => Promise<string>;
  onStateChange?: (state: MysqlRunnerState) => void;
  stepIntervalMs?: number;
}

export class MysqlConflictRunner {
  private scenario: MysqlScenario;
  private variantId?: string;
  private steps: MysqlStep[];
  private stepIndex = 0;
  private isRunning = false;
  private isPaused = false;
  private edges: WaitEdge[] = [];
  private cycle = false;
  private abortedSession: SessionKey | null = null;
  private sessionStates: Record<SessionKey, SessionState> = { A: "idle", B: "idle" };
  private logs: StepLog[] = [];

  private sse: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastWaitsCount = 0;

  constructor(
    initialScenario: MysqlScenario,
    private readonly opts: MysqlConflictRunnerOptions,
    variantId?: string
  ) {
    this.scenario = initialScenario;
    this.variantId = variantId;
    this.steps = this.resolveSteps(initialScenario, variantId);
  }

  private resolveSteps(scenario: MysqlScenario, variantId?: string): MysqlStep[] {
    if (variantId && scenario.variants) {
      const v = scenario.variants.find((item) => item.id === variantId);
      if (v) return v.steps;
    }
    return scenario.steps;
  }

  getState(): MysqlRunnerState {
    return {
      scenario: this.scenario,
      variantId: this.variantId,
      stepIndex: this.stepIndex,
      totalSteps: this.steps.length,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      edges: [...this.edges],
      cycle: this.cycle,
      abortedSession: this.abortedSession,
      sessionStates: { ...this.sessionStates },
      logs: [...this.logs],
    };
  }

  private notify() {
    if (!this.disposed && this.opts.onStateChange) {
      this.opts.onStateChange(this.getState());
    }
  }

  /**
   * Khởi động kịch bản: chạy DDL setup, mở SSE stream theo dõi locks
   */
  async start(scenario?: MysqlScenario, variantId?: string): Promise<void> {
    if (scenario) {
      this.scenario = scenario;
      this.variantId = variantId;
      this.steps = this.resolveSteps(scenario, variantId);
    }
    this.stepIndex = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.edges = [];
    this.cycle = false;
    this.abortedSession = null;
    this.sessionStates = { A: "idle", B: "idle" };
    this.logs = [];

    // Chạy các lệnh setup trên connection a
    for (const sql of this.scenario.setupSql) {
      await this.opts.execute(sql, { internal: true, connection: "a" });
    }

    // Kết nối SSE stream
    await this.connectSSE();
    this.notify();
  }

  private async connectSSE() {
    this.disconnectSSE();
    if (this.disposed) return;

    try {
      const sid = await this.opts.sessionId();
      if (typeof EventSource !== "undefined") {
        const es = new EventSource(`/api/mysql/sessions/${sid}/events`);
        this.sse = es;

        es.addEventListener("lock_change", (evt: MessageEvent) => {
          this.handleLockChange(evt.data);
        });

        es.addEventListener("deadlock", () => {
          this.cycle = true;
          this.notify();
        });

        es.addEventListener("released", () => {
          this.edges = [];
          if (this.sessionStates.A === "waiting") this.sessionStates.A = "running";
          if (this.sessionStates.B === "waiting") this.sessionStates.B = "running";
          this.notify();
        });

        es.onerror = () => {
          // SSE đứt hoặc không khả dụng -> fallback polling
          this.startPolling(sid);
        };
      } else {
        this.startPolling(sid);
      }
    } catch {
      // Bỏ qua lỗi kết nối ban đầu, sẽ thử lại khi bước
    }
  }

  private disconnectSSE() {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPolling(sid: string) {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (this.disposed) return;
      try {
        const res = await fetch(`/api/mysql/sessions/${sid}/locks`, {
          credentials: "same-origin",
        });
        if (res.ok) {
          const data = await res.json();
          this.parseLockData(data);
        }
      } catch {
        /* Bỏ qua lỗi mạng poll */
      }
    }, 800);
  }

  private handleLockChange(rawJSON: string) {
    try {
      const data = JSON.parse(rawJSON);
      this.parseLockData(data);
    } catch {
      /* JSON không hợp lệ */
    }
  }

  private parseLockData(data: {
    waits?: { rows?: unknown[][] };
    locks?: { rows?: unknown[][] };
    connections?: Record<string, number>;
  }) {
    const waitsRows = data?.waits?.rows ?? [];
    const conns = data?.connections ?? {};

    // Map connection ID sang "A" và "B"
    const connMap: Record<number, SessionKey> = {};
    if (conns.a) connMap[conns.a] = "A";
    if (conns.b) connMap[conns.b] = "B";

    const newEdges: WaitEdge[] = [];
    for (const r of waitsRows) {
      const reqId = Number(r[0]);
      const blkId = Number(r[1]);
      const objName = String(r[4] ?? "");
      const idxName = String(r[5] ?? "");
      const resource = idxName || objName || "data_lock";

      const waiter = connMap[reqId] ?? (reqId === conns.b ? "B" : "A");
      const holder = connMap[blkId] ?? (waiter === "A" ? "B" : "A");

      newEdges.push({ waiter, holder, resource });
      this.sessionStates[waiter] = "waiting";
    }

    if (this.lastWaitsCount > 0 && waitsRows.length === 0) {
      // Đã giải phóng
      if (this.sessionStates.A === "waiting") this.sessionStates.A = "running";
      if (this.sessionStates.B === "waiting") this.sessionStates.B = "running";
    }
    this.lastWaitsCount = waitsRows.length;
    this.edges = newEdges;
    this.notify();
  }

  /**
   * Chạy bước tiếp theo
   */
  async next(): Promise<boolean> {
    if (this.stepIndex >= this.steps.length) {
      this.isRunning = false;
      this.notify();
      return false;
    }

    const step = this.steps[this.stepIndex];
    const sKey: SessionKey = step.connection === "a" ? "A" : "B";
    this.sessionStates[sKey] = "running";

    let status: StepLog["status"] = "ran";
    let errorMsg: string | undefined;
    let resultRows: unknown[][] | undefined;

    try {
      const res = await this.opts.execute(step.sql, {
        connection: step.connection,
        internal: true,
      });
      if (res && res.length > 0) {
        resultRows = res[res.length - 1]?.rows;
      }

      const upper = step.sql.toUpperCase();
      if (upper.includes("COMMIT")) {
        this.sessionStates[sKey] = "committed";
      } else if (upper.includes("ROLLBACK")) {
        this.sessionStates[sKey] = "rolledBack";
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errorMsg = msg;
      if (msg.includes("1213") || msg.toLowerCase().includes("deadlock")) {
        status = "deadlock";
        this.cycle = true;
        this.sessionStates[sKey] = "aborted";
        this.abortedSession = sKey;
      } else {
        status = "error";
      }
    }

    this.logs.push({
      stepIndex: this.stepIndex,
      connection: step.connection,
      sql: step.sql,
      descKey: step.descKey,
      status,
      errorMsg,
      result: resultRows,
    });

    this.stepIndex++;
    this.notify();
    return true;
  }

  /**
   * Chạy tự động (Play)
   */
  play(): void {
    if (this.stepIndex >= this.steps.length) {
      this.stepIndex = 0;
      this.logs = [];
      this.cycle = false;
      this.edges = [];
      this.sessionStates = { A: "idle", B: "idle" };
    }
    this.isRunning = true;
    this.isPaused = false;
    this.notify();

    const loop = async () => {
      if (!this.isRunning || this.isPaused || this.disposed) return;
      const hasMore = await this.next();
      if (hasMore && this.isRunning && !this.isPaused && !this.cycle) {
        this.playTimer = setTimeout(loop, this.opts.stepIntervalMs ?? 1200);
      } else {
        this.isRunning = false;
        this.notify();
      }
    };

    void loop();
  }

  pause(): void {
    this.isRunning = false;
    this.isPaused = true;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this.notify();
  }

  async reset(): Promise<void> {
    this.pause();
    this.stepIndex = 0;
    this.logs = [];
    this.edges = [];
    this.cycle = false;
    this.abortedSession = null;
    this.sessionStates = { A: "idle", B: "idle" };

    try {
      for (const sql of this.scenario.cleanupSql) {
        await this.opts.execute(sql, { internal: true, connection: "a" });
      }
      for (const sql of this.scenario.setupSql) {
        await this.opts.execute(sql, { internal: true, connection: "a" });
      }
    } catch {
      /* Bỏ qua lỗi reset cleanup */
    }
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.disconnectSSE();
  }
}
