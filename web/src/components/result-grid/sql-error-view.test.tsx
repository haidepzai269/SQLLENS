import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import remediationMessagesEn from "../../../messages/en/error-remediation.json";
import remediationMessagesVi from "../../../messages/vi/error-remediation.json";
import resultMessagesEn from "../../../messages/en/result.json";
import resultMessagesVi from "../../../messages/vi/result.json";
import { SmartErrorCard, SqlErrorView } from "./sql-error-view";

afterEach(cleanup);

function renderWithIntl(ui: ReactNode, locale: "vi" | "en" = "vi") {
  const resultMessages = locale === "vi" ? resultMessagesVi : resultMessagesEn;
  const remediationMessages =
    locale === "vi" ? remediationMessagesVi : remediationMessagesEn;
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        result: resultMessages,
        "error-remediation": remediationMessages,
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
});
