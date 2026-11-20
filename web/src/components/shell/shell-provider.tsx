"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePathname } from "@/i18n/navigation";
import { AuthProvider } from "@/modules/auth/auth-provider";
import { isAuthFreeRoute } from "./bare-routes";
import { defaultState, sanitize, STORAGE_KEY, toggleZone, type LayoutState, type SizedZone, type Zone } from "./layout-state";

type Shell = {
  state: LayoutState;
  ready: boolean; // đã đọc xong localStorage
  toggle: (zone: Zone) => void;
  commitSizes: (sizes: Partial<Record<SizedZone, number>>) => void;
  hasWorkspace: boolean;
  setHasWorkspace: (v: boolean) => void;
  mobileTab: Zone;
  setMobileTab: (z: Zone) => void;
};

const Ctx = createContext<Shell | null>(null);
export const useShell = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell ngoài ShellProvider");
  return c;
};

export function ShellProvider({ children }: { children: React.ReactNode }) {
  // /share không có header/workspace nên không cần phiên đăng nhập; gọi /api/me ở đó
  // sẽ làm trang người nhận phụ thuộc backend dù dữ liệu đã nằm trong fragment.
  // /login và /about vẫn phải có AuthProvider: LoginPage gọi useAuth().
  const authFree = isAuthFreeRoute(usePathname());
  const [state, setState] = useState<LayoutState>(defaultState);
  const [ready, setReady] = useState(false);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [mobileTab, setMobileTab] = useState<Zone>("stage");

  // Đọc sau khi hydrate để HTML từ server và lần render đầu của client giống nhau.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc nguồn ngoài (localStorage) đúng một lần sau mount
      if (raw) setState(sanitize(JSON.parse(raw)));
    } catch {
      /* không đọc được thì dùng mặc định */
    }
    setReady(true);
    document.documentElement.dataset.hydrated = ""; // tín hiệu cho e2e: sự kiện đã được gắn
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* đầy hoặc bị chặn: trang vẫn chạy, chỉ không nhớ */
    }
  }, [state, ready]);

  const toggle = useCallback((zone: Zone) => setState((s) => toggleZone(s, zone)), []);
  const commitSizes = useCallback(
    (sizes: Partial<Record<SizedZone, number>>) => setState((s) => sanitize({ open: s.open, size: { ...s.size, ...sizes } })),
    [],
  );
  const value = useMemo(
    () => ({ state, ready, toggle, commitSizes, hasWorkspace, setHasWorkspace, mobileTab, setMobileTab }),
    [state, ready, toggle, commitSizes, hasWorkspace, mobileTab],
  );
  return (
    <Ctx.Provider value={value}>
      <TooltipProvider delay={400}>
        {authFree ? children : <AuthProvider>{children}</AuthProvider>}
      </TooltipProvider>
    </Ctx.Provider>
  );
}
