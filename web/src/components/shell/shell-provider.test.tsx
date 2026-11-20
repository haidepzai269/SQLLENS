import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellProvider } from "./shell-provider";
import { isAuthFreeRoute, isBareRoute } from "./bare-routes";
import { useAuth } from "@/modules/auth/auth-provider";

// usePathname giả để dựng ShellProvider ở đúng route cần kiểm; từng test đổi `pathname`.
const route = { pathname: "/" };

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

function LoginProbe() {
  // LoginPage gọi useAuth(); ngoài AuthProvider hàm này ném lỗi và trang đăng nhập trắng.
  const { status } = useAuth();
  return <p data-testid="login-probe">{status}</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  route.pathname = "/";
});

describe("ShellProvider — route miễn AuthProvider (Task145 review)", () => {
  it("AC-lỗi: /login vẫn nằm trong AuthProvider nên useAuth() không ném lỗi", async () => {
    route.pathname = "/login";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    render(
      <ShellProvider>
        <LoginProbe />
      </ShellProvider>,
    );

    expect(screen.getByTestId("login-probe")).toBeTruthy();
  });

  it("/share không gọi /api/me và không dựng AuthProvider", async () => {
    route.pathname = "/share";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ShellProvider>
        <p data-testid="share-child">share</p>
      </ShellProvider>,
    );

    expect(screen.getByTestId("share-child")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("share-child")).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chỉ /share miễn auth; /about và /login vẫn là route không khung nhưng cần auth", () => {
    expect(isAuthFreeRoute("/share")).toBe(true);
    expect(isAuthFreeRoute("/login")).toBe(false);
    expect(isAuthFreeRoute("/about")).toBe(false);
    expect(isAuthFreeRoute(null)).toBe(false);

    expect(isBareRoute("/login")).toBe(true);
    expect(isBareRoute("/about")).toBe(true);
    expect(isBareRoute("/share")).toBe(true);
    expect(isBareRoute("/")).toBe(false);
  });
});
