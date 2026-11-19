import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Outcome } from "@/contracts/conclusion";
import type { RuleHit } from "@/contracts/finding";
import type { Plan } from "@/contracts/plan";
import {
  AuditReport,
  calculateHealthScore,
  flattenPlanTree,
  formatDate,
  formatNumber,
  type AuditReportData,
  type FindingItem,
} from "./audit-report";
import exportVi from "../../../../messages/vi/export.json";
import exportEn from "../../../../messages/en/export.json";
import commonVi from "../../../../messages/vi/common.json";
import commonEn from "../../../../messages/en/common.json";
import findingsVi from "../../../../messages/vi/findings.json";
import findingsEn from "../../../../messages/en/findings.json";
import findingsUiVi from "../../../../messages/vi/findingsUi.json";
import findingsUiEn from "../../../../messages/en/findingsUi.json";

afterEach(cleanup);

const messagesVi = {
  export: exportVi,
  common: commonVi,
  findings: findingsVi,
  findingsUi: findingsUiVi,
};

const messagesEn = {
  export: exportEn,
  common: commonEn,
  findings: findingsEn,
  findingsUi: findingsUiEn,
};

function renderReport(ui: React.ReactElement, locale = "vi") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "vi" ? messagesVi : messagesEn}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// Sample findings fixture
const sampleHit: RuleHit = {
  ruleId: "missing-pk",
  messageKey: "findings.schema.missing-pk",
  table: "users",
  values: { table: "users" },
};

const brokenFinding: FindingItem = {
  hit: sampleHit,
  outcome: {
    kind: "conclusion",
    label: "real",
    data: {
      hit: sampleHit,
      severity: "broken",
    },
    evidence: [
      {
        kind: "scanSeq",
        messageKey: "findings.evidence.scanSeq",
        values: { table: "users", scan: "Seq Scan" },
      },
    ],
  },
};

const unverifiedFinding: FindingItem = {
  hit: {
    ruleId: "fk-no-index",
    messageKey: "findings.schema.fk-no-index",
    table: "orders",
    values: { table: "orders", columns: "user_id" },
  },
  outcome: {
    kind: "conclusion",
    label: "estimated",
    data: {
      hit: {
        ruleId: "fk-no-index",
        messageKey: "findings.schema.fk-no-index",
        table: "orders",
        values: { table: "orders", columns: "user_id" },
      },
      severity: "unverified",
    },
    evidence: [
      {
        kind: "structureOnly",
        messageKey: "findings.evidence.structureOnly",
      },
    ],
  },
};

const notBrokenFinding: FindingItem = {
  hit: {
    ruleId: "float-money",
    messageKey: "findings.schema.float-money",
    table: "products",
    values: { table: "products", column: "price", type: "numeric" },
  },
  outcome: {
    kind: "conclusion",
    label: "simulated",
    data: {
      hit: {
        ruleId: "float-money",
        messageKey: "findings.schema.float-money",
        table: "products",
        values: { table: "products", column: "price", type: "numeric" },
      },
      severity: "not_broken",
    },
    evidence: [
      {
        kind: "structureOnly",
        messageKey: "findings.evidence.structureOnly",
      },
    ],
  },
};

const samplePlanOutcome: Outcome<Plan> = {
  kind: "conclusion",
  label: "real",
  data: {
    engine: "postgres",
    analyzed: true,
    root: {
      id: "node_1",
      kind: "nested_loop",
      label: "Nested Loop",
      actualRows: 120,
      estimatedRows: 150,
      cost: 45.2,
      pagesRead: 14,
      children: [
        {
          id: "node_2",
          kind: "seq_scan",
          label: "Seq Scan",
          table: "users",
          actualRows: 10,
          estimatedRows: 10,
          cost: 1.1,
          pagesRead: 2,
          children: [],
        },
        {
          id: "node_3",
          kind: "index_scan",
          label: "Index Scan",
          table: "orders",
          index: "idx_orders_user_id",
          condition: "orders.user_id = users.id",
          actualRows: 12,
          estimatedRows: 15,
          cost: 4.3,
          pagesRead: 4,
          children: [],
        },
      ],
    },
  },
  evidence: [
    {
      kind: "counts",
      messageKey: "findings.evidence.counts",
      values: { rows: 120, pages: 14 },
    },
  ],
};

describe("Audit Report Logic Helpers", () => {
  describe("calculateHealthScore", () => {
    it("returns null score and 'not_simulated' label when findings are empty (AC6)", () => {
      const res = calculateHealthScore([]);
      expect(res.score).toBeNull();
      expect(res.label).toBe("not_simulated");
      expect(res.totalFindings).toBe(0);
      expect(res.brokenCount).toBe(0);
    });

    it("returns null score and 'not_simulated' label when findings are undefined", () => {
      const res = calculateHealthScore(undefined);
      expect(res.score).toBeNull();
      expect(res.label).toBe("not_simulated");
    });

    it("calculates health score with proper penalties and 'estimated' label (AC2)", () => {
      // 1 broken (-20), 1 unverified (-8), 1 not_broken (-0) -> 100 - 28 = 72
      const res = calculateHealthScore([brokenFinding, unverifiedFinding, notBrokenFinding]);
      expect(res.score).toBe(72);
      expect(res.label).toBe("estimated");
      expect(res.brokenCount).toBe(1);
      expect(res.unverifiedCount).toBe(1);
      expect(res.notBrokenCount).toBe(1);
      expect(res.totalFindings).toBe(3);
    });

    it("caps penalties: max 60 for broken and max 40 for unverified, min score is 0", () => {
      // 4 broken: 4 * 20 = 80 capped at 60 -> 100 - 60 = 40
      const fourBroken = [brokenFinding, brokenFinding, brokenFinding, brokenFinding];
      const res1 = calculateHealthScore(fourBroken);
      expect(res1.score).toBe(40);

      // 6 unverified: 6 * 8 = 48 capped at 40 -> 100 - 40 = 60
      const sixUnverified = Array(6).fill(unverifiedFinding);
      const res2 = calculateHealthScore(sixUnverified);
      expect(res2.score).toBe(60);

      // Max penalties on both: 60 + 40 = 100 -> score = 0
      const maxPenalties = [...fourBroken, ...sixUnverified];
      const res3 = calculateHealthScore(maxPenalties);
      expect(res3.score).toBe(0);
    });
  });

  describe("formatDate and formatNumber", () => {
    it("formats date according to Vietnamese and English locales (AC4)", () => {
      const fixedDate = new Date("2026-11-19T14:30:00Z");
      const vi = formatDate(fixedDate, "vi");
      const en = formatDate(fixedDate, "en");

      expect(vi).toBeTruthy();
      expect(en).toBeTruthy();
      expect(formatDate(undefined, "vi")).toBe("--");
      expect(formatDate("invalid-date", "vi")).toBe("invalid-date");
    });

    it("formats numbers according to locale (AC4)", () => {
      expect(formatNumber(1250000, "vi")).toBe("1.250.000");
      expect(formatNumber(1250000, "en")).toBe("1,250,000");
      expect(formatNumber(undefined, "vi")).toBe("--");
    });
  });

  describe("flattenPlanTree", () => {
    it("flattens plan node hierarchy with correct depths", () => {
      const flat = flattenPlanTree(samplePlanOutcome.data.root);
      expect(flat).toHaveLength(3);
      expect(flat[0].node.label).toBe("Nested Loop");
      expect(flat[0].depth).toBe(0);
      expect(flat[1].node.label).toBe("Seq Scan");
      expect(flat[1].depth).toBe(1);
      expect(flat[2].node.label).toBe("Index Scan");
      expect(flat[2].depth).toBe(1);
    });
  });
});

describe("AuditReport Component", () => {
  const fullData: AuditReportData = {
    projectName: "Ecommerce Prod Sandbox",
    engine: "postgres",
    createdAt: new Date("2026-11-19T12:00:00Z"),
    tableCount: 15,
    statementCount: 8,
    findings: [brokenFinding, unverifiedFinding, notBrokenFinding],
    planOutcome: samplePlanOutcome,
    selectSql: "SELECT u.id, o.id FROM users u JOIN orders o ON u.id = o.user_id WHERE u.active = true",
  };

  it("AC1: Renders exactly 3 pages (Page 1 cover & health, Page 2 findings, Page 3 plan)", () => {
    renderReport(<AuditReport data={fullData} locale="vi" />);

    const page1 = screen.getByTestId("report-page-1");
    const page2 = screen.getByTestId("report-page-2");
    const page3 = screen.getByTestId("report-page-3");

    expect(page1).toBeTruthy();
    expect(page2).toBeTruthy();
    expect(page3).toBeTruthy();

    // Check Page 1 Content
    expect(page1.textContent).toContain("Ecommerce Prod Sandbox");
    expect(page1.textContent).toContain("postgres");
    expect(screen.getByTestId("health-score-value").textContent).toBe("72");
    expect(screen.getByTestId("summary-broken").textContent).toContain("1");
    expect(screen.getByTestId("summary-unverified").textContent).toContain("1");
    expect(screen.getByTestId("summary-not-broken").textContent).toContain("1");

    // Check Page 2 Content
    expect(page2.textContent).toContain("users");
    expect(page2.textContent).toContain("orders");

    // Check Page 3 Content
    expect(page3.textContent).toContain("Nested Loop");
    expect(page3.textContent).toContain("Seq Scan");
    expect(page3.textContent).toContain("Index Scan");
  });

  it("AC2: Strict Conclusion Labels & Core Rule 2 (No 'design is good/safe' claim)", () => {
    renderReport(<AuditReport data={fullData} locale="vi" />);

    // Health score badge must be 'estimated'
    const healthBadge = screen.getByTestId("health-score-badge");
    expect(healthBadge.getAttribute("data-label")).toBe("estimated");

    // Findings must display accurate conclusion labels
    const findingRows = screen.getAllByTestId("finding-row");
    expect(findingRows.length).toBe(3);

    // Verify all conclusion badges have recognized data-label for high-contrast print styling
    const container = screen.getByTestId("audit-report-container");
    const badges = container.querySelectorAll("[data-label]");
    expect(badges.length).toBeGreaterThan(0);
    badges.forEach((b) => {
      const label = b.getAttribute("data-label");
      expect(["real", "simulated", "estimated", "not_simulated"]).toContain(label);
    });

    // Core Rule 2: not_broken summary specifically disclaims that the design is good/safe
    const notBrokenCard = screen.getByTestId("summary-not-broken");
    expect(notBrokenCard.textContent).toContain("Không đồng nghĩa thiết kế này ổn");

    // Verify no text anywhere in the document says "thiết kế này ổn" or "thiết kế an toàn"
    expect(container.textContent).not.toMatch(/thiết kế (này )?(tốt|hoàn hảo|an toàn tuyệt đối|chuẩn mực)/i);
  });

  it("AC3: Cards and rows avoid break across pages (avoid-break class)", () => {
    renderReport(<AuditReport data={fullData} locale="vi" />);

    const page1 = screen.getByTestId("report-page-1");
    const page2 = screen.getByTestId("report-page-2");
    const page3 = screen.getByTestId("report-page-3");

    expect(page1.className).toContain("avoid-break");
    expect(page2.className).toContain("avoid-break");
    expect(page3.className).toContain("avoid-break");

    const findingRows = screen.getAllByTestId("finding-row");
    for (const row of findingRows) {
      expect(row.className).toContain("avoid-break");
    }
  });

  it("AC4: Bilingual Vietnamese & English support with proper character rendering", () => {
    // Vietnamese
    const { unmount } = renderReport(<AuditReport data={fullData} locale="vi" />, "vi");
    expect(screen.getByTestId("report-page-1").textContent).toContain("Báo cáo kiểm toán cơ sở dữ liệu");
    expect(screen.getByTestId("report-page-1").textContent).toContain("Trang 1/3");
    unmount();

    // English
    renderReport(<AuditReport data={fullData} locale="en" />, "en");
    expect(screen.getByTestId("report-page-1").textContent).toContain("Database Audit Report");
    expect(screen.getByTestId("report-page-1").textContent).toContain("Page 1/3");
    expect(screen.getByTestId("report-page-1").textContent).toContain("Risk Summary");
  });

  it("AC5: Sandbox disclaimer is present on the footers of ALL 3 pages", () => {
    renderReport(<AuditReport data={fullData} locale="vi" />);

    const page1 = screen.getByTestId("report-page-1");
    const page2 = screen.getByTestId("report-page-2");
    const page3 = screen.getByTestId("report-page-3");

    const disclaimerText = "Báo cáo này được tạo tự động từ kết quả chạy trong môi trường Sandbox của SQLLens";

    expect(page1.querySelector(".report-page-footer")?.textContent).toContain(disclaimerText);
    expect(page2.querySelector(".report-page-footer")?.textContent).toContain(disclaimerText);
    expect(page3.querySelector(".report-page-footer")?.textContent).toContain(disclaimerText);
  });

  it("AC6: Empty data renders gracefully with 'No conclusions available' and no errors", () => {
    const emptyData: AuditReportData = {
      projectName: "Empty Project",
      engine: "sqlite",
      createdAt: new Date("2026-11-19T10:00:00Z"),
      tableCount: 0,
      statementCount: 0,
      findings: [],
      planOutcome: null,
      selectSql: undefined,
    };

    renderReport(<AuditReport data={emptyData} locale="vi" />);

    // Page 1: Health score is '--' with not_simulated badge
    expect(screen.getByTestId("health-score-value").textContent).toBe("--");
    expect(screen.getByTestId("health-score-badge").getAttribute("data-label")).toBe("not_simulated");

    // Page 2: Empty findings notice with "Chưa có kết luận"
    const findingsEmpty = screen.getByTestId("findings-empty");
    expect(findingsEmpty.textContent).toContain("Chưa có kết luận");
    expect(findingsEmpty.textContent).toContain("Chưa phát hiện rủi ro nào");

    // Page 3: Empty plan notice with "Chưa có kết luận"
    const planEmpty = screen.getByTestId("plan-empty");
    expect(planEmpty.textContent).toContain("Chưa có kết luận");
    expect(planEmpty.textContent).toContain("Không tìm thấy kế hoạch thực thi");
  });

  describe("Edge Cases", () => {
    it("handles 30 findings gracefully by displaying top 10 and a pagination summary", () => {
      const thirtyFindings: FindingItem[] = [];
      for (let i = 0; i < 30; i++) {
        thirtyFindings.push({
          hit: {
            ruleId: `rule_${i}`,
            messageKey: "findings.schema.missing-pk",
            table: `table_${i}`,
            values: { table: `table_${i}` },
          },
          outcome: {
            kind: "conclusion",
            label: "simulated",
            data: {
              hit: {
                ruleId: `rule_${i}`,
                messageKey: "findings.schema.missing-pk",
                table: `table_${i}`,
                values: { table: `table_${i}` },
              },
              severity: i < 5 ? "broken" : i < 15 ? "unverified" : "not_broken",
            },
            evidence: [
              {
                kind: "structureOnly",
                messageKey: "findings.evidence.structureOnly",
              },
            ],
          },
        });
      }

      const edgeData: AuditReportData = {
        projectName: "Edge 30 Findings Project",
        engine: "mysql",
        findings: thirtyFindings,
        tableCount: 30,
        statementCount: 30,
      };

      renderReport(<AuditReport data={edgeData} locale="vi" />);

      // Exactly 10 rows displayed on Page 2 to prevent A4 overflow
      const rows = screen.getAllByTestId("finding-row");
      expect(rows.length).toBe(10);

      // Pagination summary notice must appear
      const moreNotice = screen.getByTestId("findings-more-notice");
      expect(moreNotice.textContent).toContain("10/30");
    });

    it("handles 60-character long table names with break-words wrapping", () => {
      const longTableName = "very_long_schema_table_name_that_exceeds_sixty_characters_boundary_fk";
      const longTableFinding: FindingItem = {
        hit: {
          ruleId: "missing-pk",
          messageKey: "findings.schema.missing-pk",
          table: longTableName,
          values: { table: longTableName },
        },
        outcome: {
          kind: "conclusion",
          label: "real",
          data: {
            hit: {
              ruleId: "missing-pk",
              messageKey: "findings.schema.missing-pk",
              table: longTableName,
              values: { table: longTableName },
            },
            severity: "broken",
          },
          evidence: [
            {
              kind: "structureOnly",
              messageKey: "findings.evidence.structureOnly",
            },
          ],
        },
      };

      const edgeData: AuditReportData = {
        projectName: "Long Table Name Project",
        engine: "postgres",
        findings: [longTableFinding],
      };

      renderReport(<AuditReport data={edgeData} locale="vi" />);
      const tableCell = screen.getByText(longTableName);
      expect(tableCell.className).toContain("break-words");
    });

    it("triggers onPrint and onBack callbacks from toolbar", () => {
      const handlePrint = vi.fn();
      const handleBack = vi.fn();

      renderReport(
        <AuditReport data={fullData} onPrint={handlePrint} onBack={handleBack} />,
      );

      fireEvent.click(screen.getByTestId("report-print-btn"));
      expect(handlePrint).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("report-back-btn"));
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });
});
