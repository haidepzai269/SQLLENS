import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import errorMessagesEn from "../../../messages/en/error.json";
import errorMessagesVi from "../../../messages/vi/error.json";
import remediationMessagesEn from "../../../messages/en/error-remediation.json";
import remediationMessagesVi from "../../../messages/vi/error-remediation.json";
import resultMessagesEn from "../../../messages/en/result.json";
import resultMessagesVi from "../../../messages/vi/result.json";
import * as diagnoseModule from "@/modules/mentor/api/diagnose";
import { extractSuggestedSql } from "@/modules/mentor/api/diagnose";
import { applyStatementFix } from "@/components/sql-editor/statement-at-cursor";
import { SmartErrorCard, SqlErrorView } from "./sql-error-view";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithIntl(ui: ReactNode, locale: "vi" | "en" = "vi") {
  const resultMessages = locale === "vi" ? resultMessagesVi : resultMessagesEn;
  const remediationMessages =
    locale === "vi" ? remediationMessagesVi : remediationMessagesEn;
  const errorMessages = locale === "vi" ? errorMessagesVi : errorMessagesEn;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        result: resultMessages,
        "error-remediation": remediationMessages,
        error: errorMessages,
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartErrorCard / SqlErrorView", () => {
  // AC2.1: Raw Error First principle
  it("mặc định hiển thị khối Raw Error Console với nội dung gốc và dòng/cột highlight", () => {
    const raw = 'relation "users" already exists';
    const sql = "CREATE TABLE users (id int);";

    renderWithIntl(
      <SmartErrorCard
        message={raw}
        position={14}
        sql={sql}
        engine="postgres"
      />,
    );

    // Mặc định tab Nguyên bản đang được chọn
    const tabRaw = screen.getByRole("tab", { name: "Nguyên bản" });
    expect(tabRaw.getAttribute("aria-selected")).toBe("true");

    // Khối raw console xuất hiện và chứa đúng từng ký tự gốc
    const rawConsole = screen.getByTestId("raw-error-console");
    expect(rawConsole).toBeTruthy();
    expect(rawConsole.textContent).toContain(raw);

    // Vị trí lỗi và token highlight
    expect(rawConsole.textContent).toContain("Dòng 1, cột 14");
    const mark = rawConsole.querySelector("mark");
    expect(mark?.textContent).toBe("users");
  });

  // AC2.2: Toggle xem [Nguyên bản] và [Dịch nghĩa]
  it("chuyển đổi linh hoạt giữa tab [Nguyên bản] và [Dịch nghĩa tiếng Việt]", () => {
    const raw = 'relation "users" already exists';
    const sql = "CREATE TABLE users (id int);";

    renderWithIntl(
      <SmartErrorCard
        message={raw}
        sql={sql}
        engine="postgres"
      />,
    );

    // Ban đầu không có khối explanation
    expect(screen.queryByTestId("error-explanation")).toBeNull();

    // Click tab Dịch nghĩa
    const tabExplanation = screen.getByRole("tab", { name: "Dịch nghĩa tiếng Việt" });
    fireEvent.click(tabExplanation);

    expect(tabExplanation.getAttribute("aria-selected")).toBe("true");
    const explanationBlock = screen.getByTestId("error-explanation");
    expect(explanationBlock).toBeTruthy();
    expect(explanationBlock.textContent).toContain("Bảng đã tồn tại");
    expect(explanationBlock.textContent).toContain(
      'Bảng "users" đã tồn tại trong database',
    );
    expect(explanationBlock.textContent).toContain("PG 42P07");
    expect(explanationBlock.textContent).toContain("Cấu trúc (Schema)");

    // Click quay lại tab Nguyên bản
    const tabRaw = screen.getByRole("tab", { name: "Nguyên bản" });
    fireEvent.click(tabRaw);
    expect(screen.getByTestId("raw-error-console")).toBeTruthy();
    expect(screen.queryByTestId("error-explanation")).toBeNull();
  });

  // AC2.3: Quick-Fix 1-Click buttons với Postgres error (42P07)
  it("nhấn các nút Quick-Fix 1-Click gọi đúng callback với SQL tương ứng", () => {
    const raw = 'relation "users" already exists';
    const sql = "CREATE TABLE users (id int);";
    const onApplyFix = vi.fn();
    const onRebuild = vi.fn();

    renderWithIntl(
      <SqlErrorView
        message={raw}
        sql={sql}
        engine="postgres"
        onApplyFix={onApplyFix}
        onRebuild={onRebuild}
      />,
    );

    const quickFixPanel = screen.getByTestId("quick-fix-panel");
    expect(quickFixPanel).toBeTruthy();

    // 1. replace_stmt: Thêm IF NOT EXISTS
    const btnReplace = screen.getByTestId("quick-fix-action-replace_stmt");
    expect(btnReplace.textContent).toContain("Thêm IF NOT EXISTS");
    fireEvent.click(btnReplace);
    expect(onApplyFix).toHaveBeenCalledWith("CREATE TABLE IF NOT EXISTS users (id int);");

    // 2. prepend_stmt: Thêm DROP TABLE IF EXISTS
    const btnPrepend = screen.getByTestId("quick-fix-action-prepend_stmt");
    expect(btnPrepend.textContent).toContain("Thêm DROP TABLE IF EXISTS lên đầu");
    fireEvent.click(btnPrepend);
    expect(onApplyFix).toHaveBeenCalledWith("DROP TABLE IF EXISTS users CASCADE;\nCREATE TABLE users (id int);");

    // 3. rebuild_sandbox: Khởi động lại Sandbox sạch
    const btnRebuild = screen.getByTestId("quick-fix-action-rebuild_sandbox");
    expect(btnRebuild.textContent).toContain("Khởi động lại Sandbox sạch");
    fireEvent.click(btnRebuild);
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  // AC2.4: Nút Hỏi AI Mentor
  it("nhấn nút 'Hỏi AI Mentor về lỗi này' gọi onAskAi với đối tượng ErrorRemediation", () => {
    const raw = 'relation "customers" does not exist';
    const sql = "SELECT * FROM customers;";
    const onAskAi = vi.fn();

    renderWithIntl(
      <SmartErrorCard
        message={raw}
        sql={sql}
        engine="postgres"
        onAskAi={onAskAi}
      />,
    );

    const askAiBtn = screen.getByTestId("ask-ai-button");
    expect(askAiBtn.textContent).toContain("Hỏi AI Mentor về lỗi này");
    fireEvent.click(askAiBtn);

    expect(onAskAi).toHaveBeenCalledTimes(1);
    const remediation = onAskAi.mock.calls[0][0];
    expect(remediation.code).toBe("42P01");
    expect(remediation.category).toBe("schema");
    expect(remediation.explanationParams).toEqual({ table: "customers" });
  });

  // AC2.5: MySQL error matching & Quick Fix (1050 Table already exists)
  it("nhận diện lỗi MySQL 1050 và sinh đúng các nút Quick Fix của MySQL", () => {
    const raw = "Table 'products' already exists";
    const sql = "CREATE TABLE products (id int);";
    const onApplyFix = vi.fn();

    renderWithIntl(
      <SmartErrorCard
        message={raw}
        sql={sql}
        engine="mysql"
        onApplyFix={onApplyFix}
      />,
    );

    // Click tab Dịch nghĩa
    fireEvent.click(screen.getByRole("tab", { name: "Dịch nghĩa tiếng Việt" }));
    const explanation = screen.getByTestId("error-explanation");
    expect(explanation.textContent).toContain("MySQL 1050");
    expect(explanation.textContent).toContain('Bảng "products" đã tồn tại');

    // Nút replace_stmt cho MySQL
    const btnReplace = screen.getByTestId("quick-fix-action-replace_stmt");
    fireEvent.click(btnReplace);
    expect(onApplyFix).toHaveBeenCalledWith("CREATE TABLE IF NOT EXISTS products (id int);");

    // Nút prepend_stmt cho MySQL
    const btnPrepend = screen.getByTestId("quick-fix-action-prepend_stmt");
    fireEvent.click(btnPrepend);
    expect(onApplyFix).toHaveBeenCalledWith("DROP TABLE IF EXISTS products;\nCREATE TABLE products (id int);");
  });

  // Root cause hint hiển thị khi có lỗi transaction bị hủy (25P02)
  it("hiển thị gợi ý nguyên nhân gốc rễ cho lỗi transaction bị hủy", () => {
    const raw = "current transaction is aborted, commands ignored until end of transaction block";
    const sql = "SELECT 1;";

    renderWithIntl(
      <SmartErrorCard
        message={raw}
        sql={sql}
        engine="postgres"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Dịch nghĩa tiếng Việt" }));
    const explanation = screen.getByTestId("error-explanation");
    expect(explanation.textContent).toContain("Nguyên nhân gốc rễ");
    expect(explanation.textContent).toContain(
      "Câu lệnh này có thể hoàn toàn đúng cú pháp, nhưng không thể chạy vì câu lệnh trước đó",
    );
  });

  // Task103 - AC2 & AC3: Click Hỏi AI Mentor stream SSE và mở AI Doctor Card
  it("khi click 'Hỏi AI Mentor', mở AI Doctor Card, nút chuyển sang loading và stream chẩn đoán", () => {
    let capturedParams: diagnoseModule.DiagnoseParams | null = null;
    const abortMock = vi.fn();
    vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
      capturedParams = params;
      return abortMock;
    });

    renderWithIntl(
      <SqlErrorView
        message='relation "orders" does not exist'
        sql="SELECT * FROM orders;"
        engine="postgres"
      />,
      "vi",
    );

    const askAiBtn = screen.getByTestId("ask-ai-button");
    fireEvent.click(askAiBtn);

    // Nút chuyển sang trạng thái disabled
    expect(askAiBtn.getAttribute("disabled")).not.toBeNull();

    // diagnoseSqlError được gọi với đúng payload
    expect(capturedParams).not.toBeNull();
    expect(capturedParams!.sql).toBe("SELECT * FROM orders;");
    expect(capturedParams!.error).toBe('relation "orders" does not exist');
    expect(capturedParams!.engine).toBe("postgres");
    expect(capturedParams!.locale).toBe("vi");

    // AI Doctor Card được mở và đang loading
    const doctorCard = screen.getByTestId("ai-doctor-card");
    expect(doctorCard).toBeTruthy();
    expect(screen.getByTestId("ai-doctor-loading")).toBeTruthy();

    // Giả lập stream delta bọc trong act
    act(() => {
      capturedParams!.onDelta?.("Bảng orders chưa được tạo. ");
    });
    expect(screen.getByTestId("ai-doctor-explanation").textContent).toContain("Bảng orders chưa được tạo.");

    act(() => {
      capturedParams!.onDelta?.("Hãy tạo bảng trước khi query.");
    });
    expect(screen.getByTestId("ai-doctor-explanation").textContent).toContain(
      "Bảng orders chưa được tạo. Hãy tạo bảng trước khi query.",
    );

    // Stream hoàn tất với khối SQL đề xuất bọc trong act
    act(() => {
      capturedParams!.onComplete?.(
        "Bảng orders chưa được tạo. Hãy tạo bảng trước khi query.\n\n```sql\nCREATE TABLE orders (id int);\n```",
        "CREATE TABLE orders (id int);",
      );
    });

    // Loading tắt, nút hết disabled
    expect(askAiBtn.getAttribute("disabled")).toBeNull();
    expect(screen.queryByTestId("ai-doctor-loading")).toBeNull();

    // Khối SQL đề xuất xuất hiện
    const suggestedSqlBlock = screen.getByTestId("ai-doctor-suggested-sql");
    expect(suggestedSqlBlock.textContent).toBe("CREATE TABLE orders (id int);");
  });

  // Task103 - AC4: 1-Click Fix áp dụng câu lệnh đã sửa vào SQL Editor
  it("nhấn 'Áp dụng sửa ngay (1-Click Fix)' gọi onApplyFix với SQL đề xuất và chuyển trạng thái Đã áp dụng", () => {
    let capturedParams: diagnoseModule.DiagnoseParams | null = null;
    vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
      capturedParams = params;
      return vi.fn();
    });

    const onApplyFix = vi.fn();

    renderWithIntl(
      <SqlErrorView
        message='column "namee" does not exist'
        sql="SELECT namee FROM users;"
        engine="postgres"
        onApplyFix={onApplyFix}
      />,
      "vi",
    );

    fireEvent.click(screen.getByTestId("ask-ai-button"));

    // Hoàn tất stream có câu SQL sửa bọc trong act
    act(() => {
      capturedParams!.onComplete?.(
        "Cột namee bị sai chính tả.\n```sql\nSELECT name FROM users;\n```",
        "SELECT name FROM users;",
      );
    });

    const applyBtn = screen.getByTestId("apply-ai-fix-button");
    expect(applyBtn.textContent).toContain("Áp dụng sửa ngay (1-Click Fix)");
    expect(applyBtn.getAttribute("disabled")).toBeNull();

    // Click 1-Click Fix
    fireEvent.click(applyBtn);

    expect(onApplyFix).toHaveBeenCalledWith("SELECT name FROM users;");
    // Nút chuyển sang trạng thái đã áp dụng
    expect(applyBtn.textContent).toContain("Đã áp dụng");
    expect(applyBtn.getAttribute("disabled")).not.toBeNull();
  });

  // Task103 - AC5: Xử lý lỗi kết nối / quota và nút Thử lại
  it("hiển thị thông báo lỗi và nút Thử lại khi stream bị lỗi kết nối hoặc quota", () => {
    let capturedParams: diagnoseModule.DiagnoseParams | null = null;
    let callCount = 0;
    vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
      capturedParams = params;
      callCount++;
      return vi.fn();
    });

    renderWithIntl(
      <SqlErrorView
        message="syntax error at or near SELEC"
        sql="SELEC 1;"
        engine="postgres"
      />,
      "vi",
    );

    fireEvent.click(screen.getByTestId("ask-ai-button"));
    expect(callCount).toBe(1);

    // Kích hoạt lỗi bọc trong act
    act(() => {
      capturedParams!.onError?.({ messageKey: "error.quotaExceeded" });
    });

    // Hiển thị thông báo lỗi
    const errorBlock = screen.getByTestId("ai-doctor-error");
    expect(errorBlock.textContent).toContain("Bạn đã hết hạn mức dùng trong ngày.");

    // Bấm nút Thử lại
    const retryBtn = screen.getByTestId("ai-doctor-retry");
    fireEvent.click(retryBtn);

    expect(callCount).toBe(2);
  });

  // Task103 - Ca biên: Người dùng bấm Đóng/Hủy AI Doctor Card
  it("người dùng bấm nút Đóng/Hủy gọi abort và ẩn thẻ AI Doctor Card", () => {
    const abortMock = vi.fn();
    vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation(() => abortMock);

    renderWithIntl(
      <SqlErrorView
        message="syntax error at end of input"
        sql="SELECT"
        engine="postgres"
      />,
      "vi",
    );

    fireEvent.click(screen.getByTestId("ask-ai-button"));
    expect(screen.getByTestId("ai-doctor-card")).toBeTruthy();

    const closeBtn = screen.getByTestId("ai-doctor-close");
    fireEvent.click(closeBtn);

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("ai-doctor-card")).toBeNull();
  });

  // Task103 - Song ngữ tiếng Anh
  it("hiển thị đúng bản dịch tiếng Anh cho AI Doctor Card", () => {
    let capturedParams: diagnoseModule.DiagnoseParams | null = null;
    vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
      capturedParams = params;
      return vi.fn();
    });

    renderWithIntl(
      <SqlErrorView
        message='relation "items" does not exist'
        sql="SELECT * FROM items;"
        engine="postgres"
      />,
      "en",
    );

    fireEvent.click(screen.getByTestId("ask-ai-button"));

    expect(capturedParams!.locale).toBe("en");
    expect(screen.getByTestId("ai-doctor-card").textContent).toContain("AI Doctor Diagnosis");
    expect(screen.getByTestId("ai-doctor-loading").textContent).toContain("Analyzing error root cause...");

    act(() => {
      capturedParams!.onComplete?.("Fixed SQL:\n```sql\nSELECT 1;\n```", "SELECT 1;");
    });
    expect(screen.getByTestId("apply-ai-fix-button").textContent).toContain("Apply Fix Now (1-Click Fix)");
  });

  // Unit tests cho extractSuggestedSql
  describe("extractSuggestedSql", () => {
    it("bóc tách chính xác khối ```sql ... ```", () => {
      const text = "Giải thích nguyên nhân:\n```sql\nSELECT id, name FROM users;\n```\nChúc bạn thành công.";
      expect(extractSuggestedSql(text)).toBe("SELECT id, name FROM users;");
    });

    it("fallback bóc tách khối ``` ... ``` không có tag ngôn ngữ", () => {
      const text = "Sửa lại như sau:\n```\nUPDATE users SET active = true;\n```";
      expect(extractSuggestedSql(text)).toBe("UPDATE users SET active = true;");
    });

    it("trả về null nếu không có khối mã nào", () => {
      const text = "Lỗi này do bạn gõ sai cú pháp, hãy kiểm tra lại dấu chấm phẩy.";
      expect(extractSuggestedSql(text)).toBeNull();
    });
  });

  // Task113: Sửa lỗi 1-Click Fix tại Terminal - Thay thế câu lệnh theo offset và bảo toàn script
  describe("Task113: 1-Click Fix bảo toàn script & thay thế theo statement offset", () => {
    // AC1: Đơn câu lệnh: Khi Editor chỉ có 1 câu lệnh trùng với câu lệnh bị lỗi, nhấn 1-Click Fix cập nhật câu lệnh đó thành suggestedSql
    it("AC1: Khi Editor chỉ có 1 câu lệnh trùng với câu lệnh bị lỗi, nhấn 1-Click Fix cập nhật câu lệnh đó thành suggestedSql", () => {
      let capturedParams: diagnoseModule.DiagnoseParams | null = null;
      vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
        capturedParams = params;
        return vi.fn();
      });

      let editorSql = "SELECT * FORM users;";
      const errorSql = "SELECT * FORM users;";
      const errorPos = 10;

      const handleApplyFix = (newSql: string) => {
        editorSql = applyStatementFix(editorSql, errorSql, newSql, errorPos);
      };

      renderWithIntl(
        <SqlErrorView
          message='syntax error at or near "FORM"'
          position={errorPos}
          sql={errorSql}
          engine="postgres"
          onApplyFix={handleApplyFix}
        />,
        "vi",
      );

      fireEvent.click(screen.getByTestId("ask-ai-button"));

      act(() => {
        capturedParams!.onComplete?.(
          "Từ khóa FORM bị sai chính tả thành FROM.\n```sql\nSELECT * FROM users;\n```",
          "SELECT * FROM users;",
        );
      });

      const applyBtn = screen.getByTestId("apply-ai-fix-button");
      fireEvent.click(applyBtn);

      expect(editorSql).toBe("SELECT * FROM users;");
      expect(applyBtn.textContent).toContain("Đã áp dụng");
      expect(applyBtn.getAttribute("disabled")).not.toBeNull();
    });

    // AC2: Đa câu lệnh (Multi-statement script): Khi Editor có 3 câu lệnh, câu 2 lỗi, chỉ câu 2 được sửa, câu 1 và 3 giữ nguyên 100%
    it("AC2: Script 3 câu lệnh, câu 2 lỗi, bấm 1-Click Fix -> chỉ câu 2 được sửa, câu 1 và 3 giữ nguyên vẹn 100%", () => {
      let capturedParams: diagnoseModule.DiagnoseParams | null = null;
      vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
        capturedParams = params;
        return vi.fn();
      });

      let fullDoc = `CREATE TABLE users (
  id int primary key,
  email text not null
);

SELECT * FORM users;

SELECT * FROM orders WHERE total > 100;`;

      const targetSql = "SELECT * FORM users;";
      const errorPos = fullDoc.indexOf("FORM") + 1; // 1-based offset

      const handleApplyFix = (suggestedSql: string) => {
        fullDoc = applyStatementFix(fullDoc, targetSql, suggestedSql, errorPos);
      };

      renderWithIntl(
        <SqlErrorView
          message='syntax error at or near "FORM"'
          position={errorPos}
          sql={targetSql}
          engine="postgres"
          onApplyFix={handleApplyFix}
        />,
        "vi",
      );

      fireEvent.click(screen.getByTestId("ask-ai-button"));

      act(() => {
        capturedParams!.onComplete?.(
          "Sửa FORM thành FROM:\n```sql\nSELECT * FROM users;\n```",
          "SELECT * FROM users;",
        );
      });

      const applyBtn = screen.getByTestId("apply-ai-fix-button");
      fireEvent.click(applyBtn);

      const expectedDoc = `CREATE TABLE users (
  id int primary key,
  email text not null
);

SELECT * FROM users;

SELECT * FROM orders WHERE total > 100;`;

      expect(fullDoc).toBe(expectedDoc);
      expect(fullDoc).toContain("CREATE TABLE users (");
      expect(fullDoc).toContain("email text not null");
      expect(fullDoc).toContain("SELECT * FROM orders WHERE total > 100;");
      expect(applyBtn.textContent).toContain("Đã áp dụng");
    });

    // AC3: Nhiều câu lệnh giống nhau: Nếu tài liệu có nhiều câu giống hệt nhau, dùng errorPosition để xác định đúng câu lỗi
    it("AC3: Tài liệu có nhiều câu lệnh giống nhau, sử dụng errorPosition để xác định đúng câu lệnh bị lỗi", () => {
      let capturedParams: diagnoseModule.DiagnoseParams | null = null;
      vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
        capturedParams = params;
        return vi.fn();
      });

      let fullDoc = "SELECT 1;\nSELECT * FORM users;\nSELECT 2;\nSELECT * FORM users;\nSELECT 3;";
      const targetSql = "SELECT * FORM users;";

      // Vị trí lỗi tại câu SELECT * FORM users thứ hai
      const secondStmtPos = fullDoc.lastIndexOf("SELECT * FORM users") + 5; // 1-based

      const handleApplyFix = (suggestedSql: string) => {
        fullDoc = applyStatementFix(fullDoc, targetSql, suggestedSql, secondStmtPos);
      };

      renderWithIntl(
        <SqlErrorView
          message='syntax error at or near "FORM"'
          position={secondStmtPos}
          sql={targetSql}
          engine="postgres"
          onApplyFix={handleApplyFix}
        />,
        "vi",
      );

      fireEvent.click(screen.getByTestId("ask-ai-button"));

      act(() => {
        capturedParams!.onComplete?.(
          "Sửa câu lệnh lỗi:\n```sql\nSELECT * FROM users;\n```",
          "SELECT * FROM users;",
        );
      });

      fireEvent.click(screen.getByTestId("apply-ai-fix-button"));

      // Câu thứ nhất vẫn là FORM, chỉ câu thứ 2 được sửa thành FROM
      expect(fullDoc).toBe("SELECT 1;\nSELECT * FORM users;\nSELECT 2;\nSELECT * FROM users;\nSELECT 3;");
    });

    // AC4: Hỗ trợ hoàn tác (Undo)
    it("AC4: Hỗ trợ hoàn tác Undo sau khi áp dụng 1-Click Fix", () => {
      let capturedParams: diagnoseModule.DiagnoseParams | null = null;
      vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
        capturedParams = params;
        return vi.fn();
      });

      const historyStack: string[] = [];
      let currentSql = "CREATE TABLE a (id int);\nSELECT * FORM users;\nSELECT 2;";
      historyStack.push(currentSql);

      const handleApplyFix = (suggestedSql: string) => {
        const nextSql = applyStatementFix(currentSql, "SELECT * FORM users;", suggestedSql);
        historyStack.push(nextSql);
        currentSql = nextSql;
      };

      renderWithIntl(
        <SqlErrorView
          message='syntax error at or near "FORM"'
          sql="SELECT * FORM users;"
          engine="postgres"
          onApplyFix={handleApplyFix}
        />,
        "vi",
      );

      fireEvent.click(screen.getByTestId("ask-ai-button"));

      act(() => {
        capturedParams!.onComplete?.(
          "Fixed:\n```sql\nSELECT * FROM users;\n```",
          "SELECT * FROM users;",
        );
      });

      // Áp dụng fix
      fireEvent.click(screen.getByTestId("apply-ai-fix-button"));
      expect(currentSql).toBe("CREATE TABLE a (id int);\nSELECT * FROM users;\nSELECT 2;");
      expect(historyStack.length).toBe(2);

      // Giả lập Undo (Ctrl+Z): lùi về trạng thái trước đó
      historyStack.pop();
      currentSql = historyStack[historyStack.length - 1];
      expect(currentSql).toBe("CREATE TABLE a (id int);\nSELECT * FORM users;\nSELECT 2;");
    });

    // AC5: Trạng thái nút 1-Click Fix
    it("AC5: Nút 1-Click Fix hiển thị trạng thái Đã áp dụng và vô hiệu hóa để chặn click lặp lại", () => {
      let capturedParams: diagnoseModule.DiagnoseParams | null = null;
      vi.spyOn(diagnoseModule, "diagnoseSqlError").mockImplementation((params) => {
        capturedParams = params;
        return vi.fn();
      });

      const onApplyFix = vi.fn();

      renderWithIntl(
        <SqlErrorView
          message='syntax error at or near "FORM"'
          sql="SELECT * FORM users;"
          engine="postgres"
          onApplyFix={onApplyFix}
        />,
        "vi",
      );

      fireEvent.click(screen.getByTestId("ask-ai-button"));

      act(() => {
        capturedParams!.onComplete?.(
          "Fix:\n```sql\nSELECT * FROM users;\n```",
          "SELECT * FROM users;",
        );
      });

      const applyBtn = screen.getByTestId("apply-ai-fix-button");
      expect(applyBtn.getAttribute("disabled")).toBeNull();

      fireEvent.click(applyBtn);
      expect(onApplyFix).toHaveBeenCalledTimes(1);
      expect(applyBtn.getAttribute("disabled")).not.toBeNull();
      expect(applyBtn.textContent).toContain("Đã áp dụng");

      // Click lại không gọi thêm callback
      fireEvent.click(applyBtn);
      expect(onApplyFix).toHaveBeenCalledTimes(1);
    });

    // Quick-Fix actions cũ tiếp tục hoạt động an toàn với applyStatementFix
    it("các Quick-Fix action replace_stmt và prepend_stmt bảo toàn cấu trúc các câu lệnh xung quanh", () => {
      let fullDoc = "CREATE TABLE users (id int);\nSELECT * FROM users;";
      const targetSql = "CREATE TABLE users (id int);";

      const handleApplyFix = (newSql: string) => {
        fullDoc = applyStatementFix(fullDoc, targetSql, newSql);
      };

      renderWithIntl(
        <SqlErrorView
          message='relation "users" already exists'
          sql={targetSql}
          engine="postgres"
          onApplyFix={handleApplyFix}
        />,
      );

      // Bấm nút Thêm IF NOT EXISTS (replace_stmt)
      const btnReplace = screen.getByTestId("quick-fix-action-replace_stmt");
      fireEvent.click(btnReplace);

      expect(fullDoc).toBe("CREATE TABLE IF NOT EXISTS users (id int);\nSELECT * FROM users;");
    });
  });
});
