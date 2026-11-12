export type RedeemErrorCode =
  | "empty_code"
  | "invalid_code"
  | "code_exhausted"
  | "code_already_redeemed"
  | "auth_required"
  | "internal";

export type RedeemVipSuccess = {
  success: true;
  ok: true;
  role: string;
  vipUntil: string;
  expiresAt: string;
  message: string;
};

export type RedeemVipFailure = {
  success: false;
  ok: false;
  errorCode: RedeemErrorCode;
  message: string;
};

export type RedeemVipResult = RedeemVipSuccess | RedeemVipFailure;

type RedeemApiResponse = {
  ok?: boolean;
  role?: string;
  vipUntil?: string;
  message?: string;
  error?: {
    code?: string;
    messageKey?: string;
  };
};

export async function redeemVipCode(code: string): Promise<RedeemVipResult> {
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) {
    return {
      success: false,
      ok: false,
      errorCode: "empty_code",
      message: "Vui lòng nhập mã kích hoạt.",
    };
  }

  try {
    let res = await fetch("/api/auth/redeem-vip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ code: normalized }),
    });

    // Fallback sang /auth/redeem-vip nếu /api/auth/redeem-vip trả về 404 (trong một số cấu hình proxy/dev)
    if (res.status === 404) {
      res = await fetch("/auth/redeem-vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code: normalized }),
      });
    }

    let body: RedeemApiResponse | null = null;
    try {
      body = (await res.json()) as RedeemApiResponse;
    } catch {
      /* body không phải JSON */
    }

    if (res.status === 401) {
      return {
        success: false,
        ok: false,
        errorCode: "auth_required",
        message: body?.message ?? "Vui lòng đăng nhập trước khi nạp mã.",
      };
    }

    if (!res.ok) {
      const codeFromError = body?.error?.code;
      let errorCode: RedeemErrorCode = "internal";

      if (codeFromError === "invalid_code") errorCode = "invalid_code";
      else if (codeFromError === "code_exhausted") errorCode = "code_exhausted";
      else if (codeFromError === "code_already_redeemed") errorCode = "code_already_redeemed";
      else if (codeFromError === "auth_required") errorCode = "auth_required";

      return {
        success: false,
        ok: false,
        errorCode,
        message: body?.message ?? "Không thể kích hoạt mã quà tặng.",
      };
    }

    const vipUntil = body?.vipUntil ?? "";
    return {
      success: true,
      ok: true,
      role: body?.role ?? "vip",
      vipUntil,
      expiresAt: vipUntil,
      message: body?.message ?? "Kích hoạt VIP thành công.",
    };
  } catch (err: unknown) {
    return {
      success: false,
      ok: false,
      errorCode: "internal",
      message: (err as Error)?.message ?? "Lỗi kết nối máy chủ.",
    };
  }
}
