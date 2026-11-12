import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VipBadge } from "./vip-badge";

afterEach(cleanup);

describe("VipBadge Component", () => {
  it("render mặc định size sm với nhãn VIP và icon crown", () => {
    render(<VipBadge />);
    const badge = screen.getByRole("status", { name: "VIP Member" });
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("data-size")).toBe("sm");
    expect(badge.textContent).toBe("VIP");
  });

  it("render đúng size md khi truyền prop size='md'", () => {
    render(<VipBadge size="md" />);
    const badge = screen.getByRole("status", { name: "VIP Member" });
    expect(badge.getAttribute("data-size")).toBe("md");
  });

  it("hỗ trợ ẩn text khi showText=false", () => {
    render(<VipBadge showText={false} />);
    const badge = screen.getByRole("status", { name: "VIP Member" });
    expect(badge.textContent).toBe("");
  });

  it("gộp đúng className tùy biến từ người dùng", () => {
    render(<VipBadge className="my-custom-class" />);
    const badge = screen.getByRole("status", { name: "VIP Member" });
    expect(badge.className).toContain("my-custom-class");
  });
});
