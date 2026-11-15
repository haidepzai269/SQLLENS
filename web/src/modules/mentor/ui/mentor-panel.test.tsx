import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EngineAdapter, TryChangeResult } from "@/contracts/engine";
import type { EvidencePack, MentorRequest } from "@/contracts/mentor";
import type { Plan } from "@/contracts/plan";
import errMessages from "../../../../messages/en/error.json";
import mentorMessages from "../../../../messages/en/mentor.json";
import {
  buildContextSummary,
  ConversationThread,
  type Turn,
} from "./conversation-thread";
import { MAX_TURNS, MentorPanel } from "./mentor-panel";

// Mock dependencies
vi.mock("@/modules/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "user",
    markAnon: vi.fn(),
    sqlRef: { current: "" },
  }),
}));

vi.mock("@/modules/auth/login-dialog", () => ({
  LoginDialog: () => null,
}));

vi.mock("@/modules/what-if/compare-ui/what-if-compare", () => ({
  WhatIfCompare: () => <div data-testid="mock-what-if" />,
}));

vi.mock("../verify", () => ({
  verifyAnswer: vi.fn().mockResolvedValue({
    parts: [{ kind: "text", text: "Verified answer" }],
    hiddenCount: 0,
  }),
}));

const mockReadEvents = vi.fn();
vi.mock("./stream", () => ({
  readEvents: (...args: unknown[]) => mockReadEvents(...args),
}));

const dummyAdapter: Pick<EngineAdapter, "engine" | "explain" | "tryChange" | "cancel" | "rebuild"> = {
  engine: "postgres",
  explain: vi.fn().mockResolvedValue({} as unknown as Plan),
  tryChange: vi.fn().mockResolvedValue({} as unknown as TryChangeResult),
  cancel: vi.fn().mockResolvedValue(undefined),
  rebuild: vi.fn().mockResolvedValue(undefined),
};

const dummyEvidence: EvidencePack = {
  engine: "postgres",
  sql: "SELECT * FROM orders WHERE id = 1;",
};

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages, error: errMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("buildContextSummary", () => {
  test("trả về undefined nếu không có turn nào", () => {
    expect(buildContextSummary([])).toBeUndefined();
  });

  test("trả về undefined nếu các turn đều không có text", () => {
    const turns: Turn[] = [
      { id: 1, question: "Why slow?", text: "", phase: "failed" },
    ];
    expect(buildContextSummary(turns)).toBeUndefined();
  });

  test("trích xuất câu hỏi và câu trả lời tóm tắt của turn gần nhất", () => {
    const turns: Turn[] = [
      {
        id: 1,
        question: "Why is seq scan used on orders table?",
        text: "The table lacks an index on customer_id. You should create one.",
        phase: "done",
      },
    ];
    const summary = buildContextSummary(turns);
    expect(summary).toBeDefined();
    expect(summary).toContain("User asked: \"Why is seq scan used on orders table?\"");
    expect(summary).toContain("AI answered: \"The table lacks an index on customer_id. You should create one.\"");
  });

  test("thay thế các khối SQL block bằng [SQL proposal] trong summary để giữ ngắn gọn", () => {
    const turns: Turn[] = [
      {
        id: 1,
        question: "How to fix slow query?",
        text: "Add an index:\n```sql\nCREATE INDEX idx_orders ON orders(created_at);\n```\nThis speeds up lookup.",
        phase: "done",
      },
    ];
    const summary = buildContextSummary(turns);
    expect(summary).toBeDefined();
    expect(summary).toContain("[SQL proposal]");
    expect(summary).not.toContain("CREATE INDEX");
  });
});

describe("ConversationThread component", () => {
  afterEach(cleanup);

  test("AC1: hiển thị empty view khi chưa có turn nào", () => {
    wrap(
      <ConversationThread
        turns={[]}
        maxTurns={5}
        tr={(k) => k}
        onApply={vi.fn()}
        onLogin={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mentor-empty")).toBeDefined();
  });

  test("AC1: hiển thị danh sách các lượt hỏi đáp (Thread view) liên tục", () => {
    const turns: Turn[] = [
      {
        id: 1,
        question: "Question 1",
        text: "Answer 1",
        phase: "done",
      },
      {
        id: 2,
        question: "Question 2",
        text: "Answer 2",
        phase: "done",
      },
    ];

    wrap(
      <ConversationThread
        turns={turns}
        maxTurns={5}
        tr={(k) => k}
        onApply={vi.fn()}
        onLogin={vi.fn()}
      />,
    );

    const turnElements = screen.getAllByTestId("mentor-turn");
    expect(turnElements.length).toBe(2);

    const askedElements = screen.getAllByTestId("mentor-asked");
    expect(askedElements[0].textContent).toBe("Question 1");
    expect(askedElements[1].textContent).toBe("Question 2");

    const textElements = screen.getAllByTestId("mentor-text");
    expect(textElements[0].textContent).toBe("Answer 1");
    expect(textElements[1].textContent).toBe("Answer 2");
  });
});

describe("MentorPanel integration", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  async function mockSuccessfulStream(answerText: string) {
    mockReadEvents.mockImplementation(async function* () {
      yield { type: "delta", text: answerText };
      yield { type: "done" };
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {},
      headers: new Headers(),
    });
  }

  test("AC2: tự động trích xuất contextSummary khi gửi câu hỏi thứ 2", async () => {
    await mockSuccessfulStream("AI first answer about missing index.");

    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} />);

    // Turn 1
    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Why is query slow?" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    // Kiểm tra request turn 1 không có contextSummary
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init1 = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body1 = JSON.parse(String(init1?.body)) as MentorRequest;
    expect(body1.question).toBe("Why is query slow?");
    expect(body1.contextSummary).toBeUndefined();

    // Turn 2
    fireEvent.change(input, { target: { value: "Can we add composite index?" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getAllByTestId("mentor-turn").length).toBe(2);
    });

    // Kiểm tra request turn 2 CÓ contextSummary
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const init2 = mockFetch.mock.calls[1]?.[1] as RequestInit;
    const body2 = JSON.parse(String(init2?.body)) as MentorRequest;
    expect(body2.question).toBe("Can we add composite index?");
    expect(body2.contextSummary).toBeDefined();
    expect(body2.contextSummary).toContain("Why is query slow?");
    expect(body2.contextSummary).toContain("AI first answer");
  });

  test("AC4: truyền evidence_plan vào payload khi planEvidence có giá trị", async () => {
    await mockSuccessfulStream("AI answer with plan evidence");

    const planStr = "[PLAN_EVIDENCE: Seq Scan on users | Actual Rows: 5 | Buffers: 3 hit]";
    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} planEvidence={planStr} />);

    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Vì sao câu này chạy chậm?" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init?.body)) as MentorRequest;

    expect(body.question).toBe("Vì sao câu này chạy chậm?");
    expect(body.evidence_plan).toBe(planStr);
  });

  test("AC4: nút 'Hội thoại mới' reset thread và xóa sạch danh sách", async () => {
    await mockSuccessfulStream("Some answer");

    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} />);

    // Chưa có turn: nút New chat không hiển thị
    expect(screen.queryByTestId("mentor-new-chat")).toBeNull();

    // Gửi câu hỏi
    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Question A" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-new-chat")).toBeDefined();
    });

    // Bấm nút New Chat
    fireEvent.click(screen.getByTestId("mentor-new-chat"));

    await waitFor(() => {
      expect(screen.queryByTestId("mentor-turn")).toBeNull();
      expect(screen.getByTestId("mentor-empty")).toBeDefined();
    });
  });

  test("chặn gửi câu hỏi thứ 6 khi đã đạt giới hạn 5 turns", async () => {
    await mockSuccessfulStream("Short answer");

    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} />);

    const input = screen.getByTestId("mentor-question") as HTMLTextAreaElement;
    const sendBtn = screen.getByTestId("mentor-send") as HTMLButtonElement;

    // Gửi lần lượt 5 câu hỏi
    for (let i = 1; i <= MAX_TURNS; i++) {
      fireEvent.change(input, { target: { value: `Question number ${i}` } });
      fireEvent.click(sendBtn);
      await waitFor(() => {
        expect(screen.getAllByTestId("mentor-turn").length).toBe(i);
      });
    }

    // Đạt 5 turns: cảnh báo hiện lên, input và nút send bị disabled
    expect(screen.getByTestId("mentor-max-turns")).toBeDefined();
    expect(input.disabled).toBe(true);
    expect(sendBtn.disabled).toBe(true);
  });

  test("ca biên: tự động reset thread khi query thay đổi", async () => {
    await mockSuccessfulStream("Answer for query 1");

    const { rerender } = wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} />);

    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Question on query 1" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    // Đổi query khác trong evidence
    const newEvidence: EvidencePack = {
      engine: "postgres",
      sql: "SELECT * FROM users WHERE active = true;",
    };

    rerender(
      <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages, error: errMessages }}>
        <MentorPanel adapter={dummyAdapter} evidence={newEvidence} />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("mentor-turn")).toBeNull();
      expect(screen.getByTestId("mentor-empty")).toBeDefined();
    });
  });

  test("AC1: click toggle PlanEvidencePill tắt đính kèm plan trong MentorRequest", async () => {
    await mockSuccessfulStream("Answer without plan");

    const planStr = "[PLAN_EVIDENCE: Seq Scan on users | Rows: 5]";
    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} planEvidence={planStr} />);

    // Kiểm tra Pill hiển thị trạng thái Kèm Plan
    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill.getAttribute("aria-checked")).toBe("true");

    // Click toggle để tắt Plan
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-checked")).toBe("false");

    // Gửi câu hỏi
    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Why slow?" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init?.body)) as MentorRequest;

    expect(body.question).toBe("Why slow?");
    expect(body.evidence_plan).toBeUndefined();
  });

  test("AC2: click QuickActionChips lập tức gửi câu hỏi vào khung chat kèm evidence_plan", async () => {
    await mockSuccessfulStream("Plan analysis response");

    const planStr = "[PLAN_EVIDENCE: Index Scan on orders_pkey | Rows: 1]";
    wrap(<MentorPanel adapter={dummyAdapter} evidence={dummyEvidence} planEvidence={planStr} />);

    // QuickActionChips xuất hiện
    expect(screen.getByTestId("quick-action-chips")).toBeDefined();
    const slowChip = screen.getByTestId("chip-slow");

    // Click chip slow query
    fireEvent.click(slowChip);

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init?.body)) as MentorRequest;

    expect(body.question).toBe("⚡ Why is this query slow?");
    expect(body.evidence_plan).toBe(planStr);
  });

  test("AC3: MySQL Engine Guard chặn đính kèm plan tự động khi gõ chat tự do", async () => {
    await mockSuccessfulStream("MySQL answer");

    const mysqlAdapter: typeof dummyAdapter = {
      ...dummyAdapter,
      engine: "mysql",
    };
    const mysqlEvidence: EvidencePack = {
      engine: "mysql",
      sql: "SELECT * FROM customers WHERE id = 10;",
    };
    const planStr = "[PLAN_EVIDENCE: Table scan on customers]";

    wrap(<MentorPanel adapter={mysqlAdapter} evidence={mysqlEvidence} planEvidence={planStr} />);

    // Kiểm tra Pill hiển thị hướng dẫn bấm nút cho MySQL
    const pill = screen.getByTestId("plan-evidence-pill");
    expect(pill.textContent).toContain("MySQL: Click button to analyze");

    // Gõ chat tự do vào input và bấm Send
    const input = screen.getByTestId("mentor-question");
    fireEvent.change(input, { target: { value: "Tell me about this query" } });
    fireEvent.click(screen.getByTestId("mentor-send"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init?.body)) as MentorRequest;

    expect(body.question).toBe("Tell me about this query");
    // Tuyệt đối không gửi evidence_plan khi gõ tự do trên MySQL
    expect(body.evidence_plan).toBeUndefined();
  });

  test("AC3: MySQL Engine Guard cho phép đính kèm plan khi bấm Quick-Action Chip tường minh", async () => {
    await mockSuccessfulStream("MySQL plan answer");

    const mysqlAdapter: typeof dummyAdapter = {
      ...dummyAdapter,
      engine: "mysql",
    };
    const mysqlEvidence: EvidencePack = {
      engine: "mysql",
      sql: "SELECT * FROM customers WHERE id = 10;",
    };
    const planStr = "[PLAN_EVIDENCE: Table scan on customers]";

    wrap(<MentorPanel adapter={mysqlAdapter} evidence={mysqlEvidence} planEvidence={planStr} />);

    // Bấm chip Index
    fireEvent.click(screen.getByTestId("chip-index"));

    await waitFor(() => {
      expect(screen.getByTestId("mentor-turn")).toBeDefined();
    });

    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init?.body)) as MentorRequest;

    expect(body.question).toBe("🔍 Is the optimizer using an Index?");
    expect(body.evidence_plan).toBe(planStr);
  });
});
