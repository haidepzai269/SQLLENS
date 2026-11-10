import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { ConclusionBadge } from "./conclusion-badge";

afterEach(cleanup);

const messages = {
  common: {
    conclusionLabels: {
      real: { name: "Thật", tooltip: "Phản ứng vật lý của database" },
      simulated: { name: "Mô phỏng", tooltip: "Tính toán từ mô hình" },
      estimated: { name: "Ước lượng", tooltip: "Ngoại suy" },
      not_simulated: { name: "Chưa mô phỏng được", tooltip: "Chưa đủ dữ kiện" },
    },
  },
};

function renderBadge(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ConclusionBadge", () => {
  it("renders 'real' badge with proper data attribute and styling", () => {
    renderBadge(<ConclusionBadge label="real" />);
    const badge = screen.getByTestId("conclusion-badge");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("data-label")).toBe("real");
  });

  it("renders 'simulated' badge", () => {
    renderBadge(<ConclusionBadge label="simulated" />);
    const badge = screen.getByTestId("conclusion-badge");
    expect(badge.getAttribute("data-label")).toBe("simulated");
  });

  it("renders 'estimated' badge", () => {
    renderBadge(<ConclusionBadge label="estimated" />);
    const badge = screen.getByTestId("conclusion-badge");
    expect(badge.getAttribute("data-label")).toBe("estimated");
  });

  it("renders 'not_simulated' badge", () => {
    renderBadge(<ConclusionBadge label="not_simulated" />);
    const badge = screen.getByTestId("conclusion-badge");
    expect(badge.getAttribute("data-label")).toBe("not_simulated");
  });

  it("renders custom note in tooltip when provided", () => {
    renderBadge(<ConclusionBadge label="real" note="Custom physical reaction note" />);
    const badge = screen.getByTestId("conclusion-badge");
    expect(badge).toBeTruthy();
  });

  it("renders children when provided instead of default name", () => {
    renderBadge(
      <ConclusionBadge label="real">
        <span data-testid="custom-child">Custom Content</span>
      </ConclusionBadge>
    );
    const child = screen.getByTestId("custom-child");
    expect(child).toBeTruthy();
    expect(child.textContent).toBe("Custom Content");
  });
});
