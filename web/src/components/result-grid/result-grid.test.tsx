import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import messages from "../../../messages/en/result.json";
import remediationMessages from "../../../messages/en/error-remediation.json";
import { formatCell } from "./format-cell";
import { ResultGrid } from "./result-grid";
import { locateError, SqlErrorView } from "./sql-error-view";

afterEach(cleanup);
const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ result: messages, "error-remediation": remediationMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );

describe("formatCell", () => {
  test.each([
    [null, "NULL", "null"],
    [undefined, "NULL", "null"],
    ["12345678901234567890.123456789", "12345678901234567890.123456789", "text"],
    [42, "42", "number"],
    [BigInt("100000000000000000000"), "100000000000000000000", "number"],
    [new Date("2020-01-02T03:04:05Z"), "2020-01-02T03:04:05.000Z", "date"],
    [new Date("x"), "Invalid date", "date"],
    [Infinity, "Infinity", "number"],
    [true, "t", "bool"],
    [false, "f", "bool"],
    [{ a: BigInt(1) }, '{"a":"1"}', "json"],
    [[1, "x"], '[1,"x"]', "json"],
    [new Uint8Array([0, 255, 16]), "\\x00ff10", "bytes"],
  ])("%s", (v, text, kind) => expect(formatCell(v)).toEqual({ text, kind }));
  test("bytes cắt ở 64", () => {
    expect(formatCell(new Uint8Array(100)).text).toBe(`\\x${"00".repeat(64)}… (+36 bytes)`);
  });
  test("vòng tham chiếu không sập", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(formatCell(o).kind).toBe("text");
  });
});

describe("ResultGrid", () => {
  // Truy vấn theo role trên 500 dòng rất chậm trong jsdom (đã quá 5 giây lúc máy bận), nên đếm <tr> trực tiếp; nội dung vẫn kiểm đủ.
  test("AC2 trên 500 dòng bị cắt", () => {
    const rows = Array.from({ length: 501 }, (_, i) => [i]);
    const { container } = wrap(<ResultGrid results={[{ columns: ["n"], rows }]} />);
    expect(container.querySelectorAll("tr")).toHaveLength(501); // 500 + header
    expect(container.querySelectorAll("tbody td")[499].textContent).toBe("499");
    expect(container.querySelectorAll("tbody td")[500]).toBeUndefined();
    expect(screen.getByText(/501 rows in total/)).toBeTruthy();
    expect(screen.getByText(/first 500 rows/)).toBeTruthy();
  }, 30_000);
  test("AC2 rỗng giữ tên cột, câu không trả dòng hiện số dòng", () => {
    wrap(<ResultGrid results={[{ columns: [], rows: [], affectedRows: 3 }, { columns: ["a", "a"], rows: [] }]} />);
    // 3 cột header: cột # và 2 cột dữ liệu "a", "a"
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Statement 1" }));
    expect(screen.getByText("3 rows affected")).toBeTruthy();
  });
  test("AC1 phân loại lệnh và trích đoạn snippet SQL", () => {
    const rawSql = "CREATE TABLE users (id int);\nINSERT INTO users VALUES (1);\nSELECT * FROM users;";
    const results = [
      { columns: [], rows: [], affectedRows: 0 },
      { columns: [], rows: [], affectedRows: 1 },
      { columns: ["id"], rows: [[1]] },
    ];
    wrap(<ResultGrid results={results} rawSql={rawSql} />);
    // Badge phân loại
    expect(screen.getByText("DDL")).toBeTruthy();
    expect(screen.getByText("INSERT")).toBeTruthy();
    expect(screen.getByText("SELECT")).toBeTruthy();
    // Trích đoạn câu lệnh
    expect(screen.getByText(/CREATE TABLE users/)).toBeTruthy();
    expect(screen.getByText(/INSERT INTO users/)).toBeTruthy();
    expect(screen.getByText(/SELECT \* FROM users/)).toBeTruthy();
  });
  test("AC2 cột số thứ tự # và căn lề bảng chuẩn", () => {
    const results = [{ columns: ["id", "val", "extra"], rows: [[1, "text", null], [2, "other", 42]] }];
    const { container } = wrap(<ResultGrid results={results} />);
    // Hàng có header row #
    const rowHeaders = container.querySelectorAll("tbody th");
    expect(rowHeaders).toHaveLength(2);
    expect(rowHeaders[0].textContent).toBe("1");
    expect(rowHeaders[1].textContent).toBe("2");
    // Căn phải cho số, nghiêng cho null, căn trái cho chuỗi
    const cells = container.querySelectorAll("tbody td");
    expect(cells[0].className).toContain("text-right"); // id = 1
    expect(cells[1].className).toContain("text-left"); // val = text
    expect(cells[2].className).toContain("italic"); // extra = null
  });
  test("Mở tất cả và thu gọn qua prop allOpen", () => {
    const results = [{ columns: ["a"], rows: [[1]] }, { columns: ["b"], rows: [[2]] }];
    const { rerender } = wrap(<ResultGrid results={results} allOpen={false} />);
    expect(screen.getByRole("button", { name: "Statement 1" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Statement 2" }).getAttribute("aria-expanded")).toBe("false");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ result: messages, "error-remediation": remediationMessages }}>
        <ResultGrid results={results} allOpen={true} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Statement 1" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Statement 2" }).getAttribute("aria-expanded")).toBe("true");
  });
  test("AC3 câu cuối mở, câu trước thu gọn được", () => {
    wrap(<ResultGrid results={[{ columns: ["a"], rows: [[1]] }, { columns: ["b"], rows: [[2]] }]} />);
    const b1 = screen.getByRole("button", { name: "Statement 1" });
    expect(b1.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Statement 2" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(b1);
    expect(b1.getAttribute("aria-expanded")).toBe("true");
  });
  test("HTML hiện dạng chữ", () => {
    const { container } = wrap(<ResultGrid results={[{ columns: ["h"], rows: [["<img src=x onerror=alert(1)>"]] }]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });
});

describe("SqlErrorView", () => {
  test("AC4 SELEC 1 chỉ đúng SELEC", () => {
    const { container } = wrap(<SqlErrorView message="syntax error" position={1} sql="SELEC 1" />);
    expect(container.querySelector("mark")?.textContent).toBe("SELEC");
    expect(screen.getByText("Line 1, column 1")).toBeTruthy();
  });
  test("AC4 nhiều dòng", () => {
    expect(locateError("SELECT 1;\nSELECT  foo bar", 19)).toMatchObject({ lineNo: 2, col: 9, pre: "SELECT  ", token: "foo", post: " bar" });
  });
  test("vị trí ngoài phạm vi: chỉ hiện thông báo", () => {
    const { container } = wrap(<SqlErrorView message="boom" position={99} sql="x" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
