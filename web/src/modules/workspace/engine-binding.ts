// Quản lý gắn kết Engine theo từng Project và nhả tài nguyên container khi rời dự án.
// Tuân thủ Core Rule 7: 100% không log SQL, không gửi SQL trong request nhả phiên.

import { useCallback, useEffect, useState } from "react";
import { deleteMysqlSession, endMysqlSession, MYSQL_SID_KEY } from "@/engines/mysql/adapter";
import { useWorkspaceStore } from "./store";
import type { WorkspaceEngine } from "./types";

// ==========================================
// 1. Gắn kết & truy vấn Engine của Project
// ==========================================

export function bindEngine(projectId: string, engine: WorkspaceEngine): void {
  useWorkspaceStore.getState().updateProjectEngine(projectId, engine);
}

export function currentEngine(projectId: string): WorkspaceEngine | null {
  const p = useWorkspaceStore.getState().projects.find((proj) => proj.id === projectId);
  return p?.engine ?? null;
}

// ==========================================
// 2. Cơ chế thông báo khi nhả tài nguyên lỗi
// ==========================================

type NoticeListener = () => void;
const noticeListeners = new Set<NoticeListener>();

export function subscribeReleaseNotice(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

export function notifyReleaseFailed(): void {
  for (const listener of noticeListeners) {
    try {
      listener();
    } catch {
      /* bỏ qua lỗi trong callback */
    }
  }
}

export function useEngineReleaseNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return subscribeReleaseNotice(() => {
      setVisible(true);
    });
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, dismiss };
}

// ==========================================
// 3. Nhả tài nguyên container (Deduplicated)
// ==========================================

// In-flight promise để ngăn việc gửi lặp nhiều request hủy container cùng lúc.
let inFlightRelease: Promise<{ ok: boolean; error?: string }> | null = null;
let lastReleasedSid: string | null = null;

export function resetEngineBindingState(): void {
  inFlightRelease = null;
  lastReleasedSid = null;
}

function getStoredSid(): string | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(MYSQL_SID_KEY) : null;
  } catch {
    return null;
  }
}

function clearStoredSid(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(MYSQL_SID_KEY);
    }
  } catch {
    /* bỏ qua */
  }
}

/**
 * Nhả phiên container MySQL nếu dự án đó hoặc session MySQL đang có tài nguyên container.
 * Bỏ qua lỗi mạng nhưng ghi log nội bộ (console.warn), tuyệt đối KHÔNG log SQL (Core Rule 7).
 * Nếu lỗi mạng thì kích hoạt thông báo để hiển thị toast cảnh báo (AC3).
 */
export async function releaseProjectResources(
  projectId: string
): Promise<{ ok: boolean; error?: string }> {
  // Nếu đang có một tiến trình nhả tài nguyên chạy ngầm, trả về cùng promise đó (deduped)
  if (inFlightRelease) {
    return inFlightRelease;
  }

  const engine = currentEngine(projectId);
  const sid = getStoredSid();

  // Nếu dự án không phải MySQL và cũng không có session MySQL nào đang giữ
  if (engine !== "mysql" && !sid) {
    return { ok: true };
  }

  // Nếu session ID này đã được nhả trước đó và không còn sid mới nào
  if (!sid && lastReleasedSid) {
    return { ok: true };
  }

  const sidToRelease = sid;
  // Dọn dẹp session storage ngay lập tức để các thao tác chuyển đổi liên tiếp không thấy sid này nữa
  clearStoredSid();
  if (sidToRelease) {
    lastReleasedSid = sidToRelease;
  }

  inFlightRelease = (async () => {
    try {
      // 1. Gọi endMysqlSession() để hủy adapter MySQL đang sống nếu có
      const handled = await endMysqlSession();

      // 2. Nếu không có adapter đang sống nhưng có sid lưu trong sessionStorage
      if (!handled && sidToRelease) {
        await deleteMysqlSession(sidToRelease);
      }

      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Ghi log nội bộ, TUYỆT ĐỐI KHÔNG ghi log bất kỳ câu SQL nào (Core Rule 7)
      console.warn("[Workspace] Failed to release MySQL session:", message);

      // Kích hoạt thông báo toast cho người dùng (AC3)
      notifyReleaseFailed();

      return { ok: false, error: message };
    } finally {
      inFlightRelease = null;
    }
  })();

  return inFlightRelease;
}

/**
 * Điều phối khi người dùng chuyển từ dự án này sang dự án khác.
 * Khi rời dự án MySQL, kích hoạt nhả phiên container đúng 1 lần (deduped).
 * Hỗ trợ đổi dự án liên tiếp 5 lần trong 2 giây mà không kích hoạt gọi lặp nhả phiên.
 */
export async function onProjectSwitch(
  prevProjectId: string | null,
  nextProjectId: string | null
): Promise<void> {
  if (!prevProjectId || prevProjectId === nextProjectId) {
    return;
  }

  const prevEng = currentEngine(prevProjectId);
  const sid = getStoredSid();

  // Chỉ kích hoạt nhả phiên nếu dự án trước là MySQL hoặc đang có phiên MySQL
  if (prevEng === "mysql" || sid) {
    await releaseProjectResources(prevProjectId);
  }
}
