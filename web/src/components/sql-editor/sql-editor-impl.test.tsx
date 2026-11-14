import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import SqlEditorImpl from "./sql-editor-impl";

beforeAll(() => {
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  }
});

describe("SqlEditorImpl", () => {
  it("renders correctly with initial sql", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT 1;"
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        onRun={vi.fn()}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("SELECT 1;");
  });

  it("triggers onRun with selection or statement when Ctrl+Enter is pressed", () => {
    const onRun = vi.fn();
    const onSelectionChange = vi.fn();
    const { container } = render(
      <SqlEditorImpl
        value="SELECT 1; SELECT 2;"
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        onRun={onRun}
        onSelectionChange={onSelectionChange}
      />,
    );
    const editor = container.querySelector(".cm-content");
    expect(editor).toBeTruthy();

    // Giả lập Ctrl+Enter tại vị trí mặc định (offset 0 -> SELECT 1)
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor?.dispatchEvent(event);

    expect(onRun).toHaveBeenCalledWith({
      targetSql: "SELECT 1",
      isSelection: false,
    });
  });

  it("does not trigger onRun when editor is empty", () => {
    const onRun = vi.fn();
    const { container } = render(
      <SqlEditorImpl
        value=""
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        onRun={onRun}
      />,
    );
    const editor = container.querySelector(".cm-content");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor?.dispatchEvent(event);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("chấp nhận schema và dropdownAutocomplete props mà không gây lỗi", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT * FROM users;"
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        schema={{ users: ["id", "email"], orders: ["id", "amount"] }}
        dropdownAutocomplete={true}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("SELECT * FROM users;");
  });

  it("hoạt động mượt mà khi dropdownAutocomplete tắt tường minh (false)", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT 1;"
        onChange={vi.fn()}
        engine="mysql"
        ariaLabel="SQL Editor"
        schema={{}}
        dropdownAutocomplete={false}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("chấp nhận foreignKeys và ghostTextEnabled props mà không gây lỗi", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT * FROM orders o JOIN "
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        schema={{ users: ["id", "name"], orders: ["id", "user_id"] }}
        foreignKeys={[
          {
            fromTable: "orders",
            fromColumn: "user_id",
            toTable: "users",
            toColumn: "id",
          },
        ]}
        ghostTextEnabled={true}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("orders");
  });

  it("tắt inline ghost text an toàn khi ghostTextEnabled = false", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT * FROM users "
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        schema={{ users: ["id"] }}
        ghostTextEnabled={false}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("chấp nhận isVip, aiCopilotEnabled và onRequireUpgrade props an toàn", () => {
    const onRequireUpgrade = vi.fn();
    const { container } = render(
      <SqlEditorImpl
        value="-- Gợi ý top 10 đơn hàng\n"
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        schema={{ orders: ["id", "amount"] }}
        isVip={true}
        aiCopilotEnabled={true}
        onRequireUpgrade={onRequireUpgrade}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain("-- Gợi ý top 10 đơn hàng");
  });

  it("hoạt động mượt mà khi aiCopilotEnabled tắt tường minh (false)", () => {
    const { container } = render(
      <SqlEditorImpl
        value="SELECT 1;"
        onChange={vi.fn()}
        engine="postgres"
        ariaLabel="SQL Editor"
        isVip={false}
        aiCopilotEnabled={false}
      />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });
});
