"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Me } from "./api";

// unavailable: /me lỗi mạng hoặc 5xx. Chưa biết là ai nên không mở cổng, Gin vẫn chặn thật.
export type AuthStatus = "loading" | "anon" | "user" | "unavailable";
export type Banner = "cancelled" | "failed" | "logoutFailed";

type Auth = {
  status: AuthStatus;
  user: Me | null;
  markAnon: () => void; // một yêu cầu khác nhận 401: cookie hết hạn
  logout: () => Promise<boolean>; // chỉ gọi Gin; người gọi tự markAnon sau khi đã đổi engine

  banner: Banner | null;
  setBanner: (b: Banner | null) => void;
  sqlRef: React.RefObject<string>; // SQL đang soạn, chỉ để lưu tạm khi chuyển đi đăng nhập
};

const Ctx = createContext<Auth | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth ngoài AuthProvider");
  return c;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<Me | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const sqlRef = useRef("");

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/me", { credentials: "same-origin", cache: "no-store", signal: ac.signal })
      .then(async (r) => {
        if (r.status === 401) return setStatus("anon");
        if (!r.ok) return setStatus("unavailable");
        const me = (await r.json()) as Me;
        if (typeof me?.id !== "string" || typeof me.name !== "string") return setStatus("unavailable");
        setUser(me);
        setStatus("user");
      })
      .catch(() => {
        if (!ac.signal.aborted) setStatus("unavailable");
      });
    return () => ac.abort();
  }, []);

  const markAnon = useCallback(() => {
    setUser(null);
    setStatus("anon");
  }, []);

  const logout = useCallback(async () => {
    try {
      // Trình duyệt tự gửi Origin cho POST cùng nguồn; Gin kiểm Origin.
      const r = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!r.ok && r.status !== 401) return false;
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, markAnon, logout, banner, setBanner, sqlRef }),
    [status, user, markAnon, logout, banner],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
