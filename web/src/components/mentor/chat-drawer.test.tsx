import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import mentorMessages from "../../../messages/en/mentor.json";
import { ChatDrawer } from "./chat-drawer";

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ mentor: mentorMessages }}>
      {ui}
    </NextIntlClientProvider>
  );

describe("ChatDrawer Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test("không render gì khi open = false", () => {
    wrap(
      <ChatDrawer open={false}>
        <div data-testid="drawer-content">Hello</div>
      </ChatDrawer>
    );

    expect(screen.queryByTestId("chat-drawer")).toBeNull();
    expect(screen.queryByTestId("drawer-content")).toBeNull();
  });

  test("render đúng nội dung và header khi open = true", () => {
    wrap(
      <ChatDrawer open={true}>
        <div data-testid="drawer-content">Chat with AI</div>
      </ChatDrawer>
    );

    expect(screen.getByTestId("chat-drawer")).toBeDefined();
    expect(screen.getByTestId("drawer-content")).toBeDefined();
    expect(screen.getByText("AI Mentor Analysis")).toBeDefined();
  });

  test("đóng drawer khi bấm nút X hoặc phím Escape", () => {
    const onCloseMock = vi.fn();
    const onOpenChangeMock = vi.fn();

    wrap(
      <ChatDrawer open={true} onClose={onCloseMock} onOpenChange={onOpenChangeMock}>
        <div>Content</div>
      </ChatDrawer>
    );

    // Bấm nút đóng
    fireEvent.click(screen.getByTestId("chat-drawer-close"));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
    expect(onOpenChangeMock).toHaveBeenCalledWith(false);

    // Bấm phím Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseMock).toHaveBeenCalledTimes(2);
  });
});
