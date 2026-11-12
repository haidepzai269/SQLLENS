import { afterEach, describe, expect, it, vi } from "vitest";
import { redeemVipCode } from "./redeem";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redeemVipCode API client", () => {
  it("trả về empty_code khi mã rỗng hoặc chỉ có khoảng trắng", async () => {
    const res = await redeemVipCode("   ");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("empty_code");
    }
  });

  it("gửi đúng mã uppercase và parse thành công khi status 200", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        role: "vip",
        vipUntil: "2027-12-31T23:59:59Z",
        message: "Kích hoạt VIP thành công",
      }),
    });
    global.fetch = fetchMock;

    const res = await redeemVipCode("vip2026");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/redeem-vip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ code: "VIP2026" }),
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.role).toBe("vip");
      expect(res.vipUntil).toBe("2027-12-31T23:59:59Z");
      expect(res.expiresAt).toBe("2027-12-31T23:59:59Z");
    }
  });

  it("trả về auth_required khi status 401", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: "auth_required" },
        message: "Yêu cầu đăng nhập",
      }),
    });

    const res = await redeemVipCode("PROMO");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("auth_required");
    }
  });

  it("trả về code_exhausted khi mã đã hết hạn hoặc hết lượt", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "code_exhausted" },
        message: "Mã đã hết hạn",
      }),
    });

    const res = await redeemVipCode("EXPIRED");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("code_exhausted");
    }
  });

  it("trả về internal khi fetch ném ngoại lệ", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network failed"));

    const res = await redeemVipCode("ANYCODE");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errorCode).toBe("internal");
    }
  });
});
