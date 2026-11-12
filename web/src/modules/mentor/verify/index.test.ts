// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conclusion } from "@/contracts/conclusion";
import type { EngineAdapter } from "@/contracts/engine";
import type { Plan } from "@/contracts/plan";
import commonEn from "../../../../messages/en/common.json";
import mentorVerifyEn from "../../../../messages/en/mentorVerify.json";
import mentorEn from "../../../../messages/en/mentor.json";
import { VerifiedBlock } from "../ui/verified-block";
import { verifyAnswer, type VerifiedPart } from "./index";

// Mock parser cho môi trường jsdom / node
vi.mock("@/modules/sql-intake/parser", () => ({
  parseSql: async (sql: string) => {
    const trimmed = sql.trim();
    if (!trimmed) {
      return { ok: true, statements: [] };
    }
    if (trimmed.toUpperCase().startsWith("INVALID") || trimmed.toUpperCase().startsWith("SELEC ")) {
      return { ok: false, error: { message: "syntax error" } };
    }
    const isMultiple = trimmed.includes(";") && trimmed.split(";").filter((s) => s.trim()).length > 1;
    if (isMultiple) {
      return {
        ok: true,
        statements: [
          { index: 0, kind: "select", start: 0, end: 10, tables: [], ast: { SelectStmt: {} } },
          { index: 1, kind: "drop", start: 11, end: trimmed.length, tables: [], ast: {} },
        ],
      };
    }
    const isSelect = trimmed.toUpperCase().startsWith("SELECT");
    const isCreateIndex = trimmed.toUpperCase().startsWith("CREATE INDEX");
    const kind = isSelect ? "select" : isCreateIndex ? "create_index" : "other";

    return {
      ok: true,
      statements: [
        {
          index: 0,
          kind,
          start: 0,
          end: trimmed.length,
          tables: [],
          ast: isSelect
            ? { SelectStmt: {} }
            : isCreateIndex
            ? { IndexStmt: { concurrent: false } }
            : { OtherStmt: {} },
        },
      ],
    };
  },
}));

const fence = (s: string, lang = "sql") => "```" + lang + "\n" + s + "\n```\n";

const fakeAdapter = (engine: "postgres" | "mysql" = "postgres") => {
  const explain = vi.fn(async () => ({
    kind: "conclusion",
    label: "real",
    data: { root: { pagesRead: 12, children: [] }, analyzed: true } as unknown as Plan,
    evidence: [{ kind: "k", messageKey: "m" }],
  }) as never);
  const tryChange = vi.fn(async () => ({
    kind: "conclusion",
    label: "real",
    data: { before: { sharedHitBlocks: 10, sharedReadBlocks: 20 }, after: { sharedHitBlocks: 2, sharedReadBlocks: 3 } },
    evidence: [{ kind: "k", messageKey: "m" }],
  }) as never);
  return { engine, explain, tryChange } satisfies Pick<EngineAdapter, "engine" | "explain" | "tryChange">;
};

const trHelper = (key: string, values?: Record<string, string | number>) => {
  const parts = key.split(".");
  const k = parts.length > 1 ? parts[1] : parts[0];
  let tmpl = (mentorVerifyEn as Record<string, string>)[k] ?? key;
  if (values) {
    for (const [varName, varVal] of Object.entries(values)) {
      tmpl = tmpl.replace(`{${varName}}`, String(varVal));
    }
  }
  return tmpl;
};

describe("Task100: verifyAnswer với PostgreSQL & MySQL", () => {
  it("AC1: khối SQL lỗi cú pháp hoặc thất bại được giữ lại với kind 'unverified' kèm đầy đủ SQL", async () => {
    const a = fakeAdapter("postgres");
    a.explain.mockRejectedValueOnce(new Error("column unknown_col does not exist"));

    const answer = "Dưới đây là câu lệnh lỗi:\n" + fence("SELECT unknown_col FROM orders");
    const result = await verifyAnswer(a, answer);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].kind).toBe("text");

    const sqlPart = result.parts[1];
    expect(sqlPart.kind).toBe("unverified");
    if (sqlPart.kind === "unverified") {
      expect(sqlPart.sql).toBe("SELECT unknown_col FROM orders");
      expect(sqlPart.reasonKey).toBe("mentorVerify.failed");
    }
    expect(result.hiddenCount).toBe(1);
    expect(result.unverifiedCount).toBe(1);
  });

  it("AC1: SQL syntax error trả về reasonKey parseError và giữ nguyên SQL", async () => {
    const a = fakeAdapter("postgres");
    const answer = fence("SELEC FROM orders");
    const result = await verifyAnswer(a, answer);

    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    expect(part.kind).toBe("unverified");
    if (part.kind === "unverified") {
      expect(part.sql).toBe("SELEC FROM orders");
      expect(part.reasonKey).toBe("mentorVerify.parseError");
    }
  });

  it("AC3: engine MySQL gửi EXPLAIN thử nghiệm an toàn khi kết nối sandbox sẵn sàng", async () => {
    const a = fakeAdapter("mysql");
    const answer = "Gợi ý MySQL:\n" + fence("SELECT * FROM users WHERE status = 'active'");
    const result = await verifyAnswer(a, answer);

    expect(a.explain).toHaveBeenCalledTimes(1);
    expect(a.explain).toHaveBeenCalledWith("SELECT * FROM users WHERE status = 'active'", expect.anything());

    const sqlPart = result.parts[1];
    expect(sqlPart.kind).toBe("sql");
    if (sqlPart.kind === "sql") {
      expect(sqlPart.sql).toBe("SELECT * FROM users WHERE status = 'active'");
      expect(sqlPart.outcome.label).toBe("real");
    }
    expect(result.hiddenCount).toBe(0);
  });

  it("AC3: engine MySQL fallback về 'needMysqlSandbox' khi sandbox chưa kết nối hoặc ném lỗi", async () => {
    const a = fakeAdapter("mysql");
    a.explain.mockRejectedValueOnce(new Error("MySQL sandbox agent not reachable"));

    const answer = fence("SELECT * FROM users WHERE status = 'active'");
    const result = await verifyAnswer(a, answer);

    expect(result.parts).toHaveLength(1);
    const sqlPart = result.parts[0];
    expect(sqlPart.kind).toBe("unverified");
    if (sqlPart.kind === "unverified") {
      expect(sqlPart.sql).toBe("SELECT * FROM users WHERE status = 'active'");
      expect(sqlPart.reasonKey).toBe("mentorVerify.needMysqlSandbox");
    }
  });

  it("AC3: engine MySQL từ chối câu lệnh không phải SELECT (như UPDATE) với 'notAllowed'", async () => {
    const a = fakeAdapter("mysql");
    const answer = fence("UPDATE users SET status = 'inactive'");
    const result = await verifyAnswer(a, answer);

    expect(a.explain).not.toHaveBeenCalled();
    const sqlPart = result.parts[0];
    expect(sqlPart.kind).toBe("unverified");
    if (sqlPart.kind === "unverified") {
      expect(sqlPart.reasonKey).toBe("mentorVerify.notAllowed");
      expect(sqlPart.sql).toBe("UPDATE users SET status = 'inactive'");
    }
  });

  it("Ca biên: AI đề xuất 3 khối SQL (1 đúng, 2 sai)", async () => {
    const a = fakeAdapter("postgres");
    a.explain.mockResolvedValueOnce({
      kind: "conclusion",
      label: "real",
      data: { root: { pagesRead: 5, children: [] }, analyzed: true } as unknown as Plan,
      evidence: [],
    } as never);
    a.explain.mockRejectedValueOnce(new Error("table not found"));

    const answer = fence("SELECT 1") + fence("SELEC INVALID") + fence("SELECT * FROM missing_table");

    const result = await verifyAnswer(a, answer);
    const sqlParts = result.parts.filter((p) => p.kind !== "text");
    expect(sqlParts).toHaveLength(3);

    expect(sqlParts[0].kind).toBe("sql");
    expect(sqlParts[1].kind).toBe("unverified");
    expect((sqlParts[1] as { reasonKey: string }).reasonKey).toBe("mentorVerify.parseError");

    expect(sqlParts[2].kind).toBe("unverified");
    expect((sqlParts[2] as { reasonKey: string }).reasonKey).toBe("mentorVerify.failed");

    expect(result.hiddenCount).toBe(2);
    expect(result.unverifiedCount).toBe(2);
  });
});

describe("Task100: VerifiedBlock UI Component", () => {
  afterEach(cleanup);

  const renderBlock = (ui: React.ReactElement) =>
    render(
      React.createElement(
        NextIntlClientProvider as React.ComponentType<{ locale: string; messages: unknown; children?: React.ReactNode }>,
        {
          locale: "en",
          messages: { mentor: mentorEn, mentorVerify: mentorVerifyEn, common: commonEn },
        },
        ui,
      ),
    );

  it("AC1: khi unverified: hiển thị viền hổ phách, badge cảnh báo, giữ nguyên SQL và KHÔNG có nút Apply", () => {
    const part: VerifiedPart = {
      kind: "unverified",
      sql: "SELECT broken_col FROM orders;",
      reasonKey: "mentorVerify.failed",
    };

    renderBlock(
      React.createElement(VerifiedBlock, {
        part,
        tr: trHelper,
        onApply: vi.fn(),
      }),
    );

    const container = screen.getByTestId("mentor-sql-unverified");
    expect(container).toBeDefined();
    expect(container.className).toContain("border-amber-500/50");

    const badge = screen.getByTestId("mentor-unverified-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("Not verified in sandbox");
    expect(badge.textContent).toContain("Execution failed in database");

    expect(screen.getByText("SELECT broken_col FROM orders;")).toBeDefined();

    // TUYỆT ĐỐI KHÔNG CÓ nút "Áp dụng thử" (AC1)
    expect(screen.queryByTestId("mentor-apply")).toBeNull();
  });

  it("AC1: khi unverified do needMysqlSandbox: hiển thị lý do cần kết nối MySQL sandbox", () => {
    const part: VerifiedPart = {
      kind: "unverified",
      sql: "SELECT * FROM users;",
      reasonKey: "mentorVerify.needMysqlSandbox",
    };

    renderBlock(
      React.createElement(VerifiedBlock, {
        part,
        tr: trHelper,
      }),
    );

    const badge = screen.getByTestId("mentor-unverified-badge");
    expect(badge.textContent).toContain("Requires active MySQL sandbox connection to test");
  });

  it("AC2: khi khối SQL vượt qua kiểm thử: viền xanh, nhãn Thật/Real, có nút Áp dụng thử", () => {
    const part: VerifiedPart = {
      kind: "sql",
      sql: "SELECT id, name FROM customers WHERE id = 1;",
      outcome: {
        kind: "conclusion",
        label: "real",
        data: {
          root: { pagesRead: 3, children: [] },
          analyzed: true,
        } as unknown as Plan,
        evidence: [{ kind: "k", messageKey: "m" }],
      } as unknown as Conclusion<Plan>,
    };

    const onApply = vi.fn();
    renderBlock(
      React.createElement(VerifiedBlock, {
        part,
        tr: trHelper,
        onApply,
        probe: "SELECT 1",
      }),
    );

    const container = screen.getByTestId("mentor-sql-ok");
    expect(container.className).toContain("border-emerald-500/40");

    expect(screen.getByTestId("mentor-label").textContent).toContain("Real");
    expect(screen.getByText("SELECT id, name FROM customers WHERE id = 1;")).toBeDefined();

    const applyBtn = screen.getByTestId("mentor-apply");
    expect(applyBtn).toBeDefined();

    fireEvent.click(applyBtn);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        probe: "SELECT id, name FROM customers WHERE id = 1;",
      }),
    );
  });

  it("hiển thị pending khi đang chờ kiểm tra", () => {
    renderBlock(
      React.createElement(VerifiedBlock, {
        part: { kind: "pending" },
        tr: trHelper,
      }),
    );

    const pending = screen.getByTestId("mentor-sql-pending");
    expect(pending).toBeDefined();
    expect(pending.textContent).toContain("waiting to be checked");
  });
});
