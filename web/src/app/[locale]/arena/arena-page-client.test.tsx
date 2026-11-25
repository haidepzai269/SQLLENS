import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  authUser: null as null | { id: string; name: string; provider: string; role?: string; isVip?: boolean },
  arenaViewProps: null as null | { roomId?: string; role?: string; isVip?: boolean },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/modules/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));

vi.mock("@/modules/arena/components/arena-view", () => ({
  ArenaView: (props: { roomId?: string; role?: string; isVip?: boolean }) => {
    mocks.arenaViewProps = props;
    return (
      <div
        data-testid="mock-arena-view"
        data-room-id={props.roomId ?? ""}
        data-role={props.role ?? ""}
        data-vip={String(Boolean(props.isVip))}
      />
    );
  },
}));

import { ArenaPageClient } from "./arena-page-client";

describe("ArenaPageClient", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams();
    mocks.authUser = null;
    mocks.arenaViewProps = null;
  });

  it("truyền undefined khi không có roomId/role và isVip=false khi chưa đăng nhập", () => {
    render(<ArenaPageClient />);
    expect(mocks.arenaViewProps).toEqual({
      roomId: undefined,
      role: undefined,
      isVip: false,
    });
    const backLink = screen.getByTestId("arena-back-to-lab");
    expect(backLink.getAttribute("href")).toBe("/");
  });

  it("trim roomId, nhận role host/viewer hợp lệ và bỏ qua role lạ", () => {
    mocks.searchParams = new URLSearchParams("roomId=%20room-123%20&role=viewer");
    render(<ArenaPageClient />);
    expect(mocks.arenaViewProps).toEqual({
      roomId: "room-123",
      role: "viewer",
      isVip: false,
    });

    mocks.searchParams = new URLSearchParams("roomId=%20%20&role=admin");
    render(<ArenaPageClient />);
    expect(mocks.arenaViewProps).toEqual({
      roomId: undefined,
      role: undefined,
      isVip: false,
    });
  });

  it("truyền isVip=true khi user có role vip hoặc isVip=true", () => {
    mocks.authUser = { id: "u1", name: "VIP", provider: "github", role: "vip" };
    render(<ArenaPageClient />);
    expect(mocks.arenaViewProps?.isVip).toBe(true);

    mocks.authUser = { id: "u2", name: "VIP2", provider: "github", role: "user", isVip: true };
    render(<ArenaPageClient />);
    expect(mocks.arenaViewProps?.isVip).toBe(true);
  });
});
