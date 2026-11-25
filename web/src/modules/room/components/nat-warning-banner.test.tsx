import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../../../../messages/vi/room.json";
import enMessages from "../../../../messages/en/room.json";
import { NatWarningBanner } from "./nat-warning-banner";

function renderBanner(visible: boolean, locale: "vi" | "en" = "vi") {
  const messages = locale === "vi" ? { room: viMessages } : { room: enMessages };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <NatWarningBanner visible={visible} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("NatWarningBanner", () => {
  it("không hiển thị khi visible = false", () => {
    const { container } = renderBanner(false, "vi");
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("nat-warning-banner")).toBeNull();
  });

  it("hiển thị đúng thông báo tiếng Việt khi visible = true (AC4)", () => {
    renderBanner(true, "vi");
    const banner = screen.getByTestId("nat-warning-banner");
    expect(banner.textContent).toContain("Tính năng hoạt động tốt nhất trên cùng mạng LAN hoặc Open NAT.");
  });

  it("hiển thị đúng thông báo tiếng Anh khi visible = true (AC4)", () => {
    renderBanner(true, "en");
    const banner = screen.getByTestId("nat-warning-banner");
    expect(banner.textContent).toContain("Best experienced on the same LAN or Open NAT.");
  });
});
