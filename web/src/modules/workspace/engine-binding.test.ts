import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import enWorkspace from "../../../messages/en/workspace.json";
import viWorkspace from "../../../messages/vi/workspace.json";
import { MYSQL_SID_KEY } from "@/engines/mysql/adapter";
import {
  bindEngine,
  currentEngine,
  notifyReleaseFailed,
  onProjectSwitch,
  releaseProjectResources,
  resetEngineBindingState,
  subscribeReleaseNotice,
} from "./engine-binding";
import { EngineReleaseToast } from "./components/engine-release-toast";
import { useWorkspaceStore } from "./store";

const wrapToast = (locale: "vi" | "en" = "vi") =>
  render(
    // eslint-disable-next-line react/no-children-prop
    React.createElement(NextIntlClientProvider, {
      locale,
      messages: { workspace: locale === "vi" ? viWorkspace : enWorkspace },
      children: React.createElement(EngineReleaseToast),
    })
  );

describe("Engine Binding & Container Lifecycle (Task128)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetEngineBindingState();
    useWorkspaceStore.getState().reset();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ========================================================
  // AC1: Engine ghim theo dự án & cô lập schema/dữ liệu
  // ========================================================
  test("AC1: Dự án Postgres và dự án SQLite mở lần lượt không lẫn dữ liệu, không lẫn schema", () => {
    const projPg = useWorkspaceStore.getState().createProject({
      name: "Postgres Project",
      engine: "postgres",
    });
    const tabPg = useWorkspaceStore.getState().createTab(projPg.id, "pg.sql");
    useWorkspaceStore.getState().updateTabSql(tabPg.id, "CREATE TABLE users (id serial);");

    const projSqlite = useWorkspaceStore.getState().createProject({
      name: "SQLite Project",
      engine: "sqlite",
    });
    const tabSqlite = useWorkspaceStore.getState().createTab(projSqlite.id, "sqlite.sql");
    useWorkspaceStore.getState().updateTabSql(tabSqlite.id, "CREATE TABLE items (id integer);");

    // Engine được ghim chuẩn theo từng dự án
    expect(currentEngine(projPg.id)).toBe("postgres");
    expect(currentEngine(projSqlite.id)).toBe("sqlite");

    // Dùng bindEngine để đổi engine cho project
    bindEngine(projPg.id, "mysql");
    expect(currentEngine(projPg.id)).toBe("mysql");

    // Dữ liệu và tabs hoàn toàn cô lập theo project, không lẫn nhau
    const state = useWorkspaceStore.getState();
    const pgTabs = state.tabs.filter((t) => t.projectId === projPg.id);
    const sqliteTabs = state.tabs.filter((t) => t.projectId === projSqlite.id);

    expect(pgTabs).toHaveLength(1);
    expect(pgTabs[0].sql).toBe("CREATE TABLE users (id serial);");

    expect(sqliteTabs).toHaveLength(1);
    expect(sqliteTabs[0].sql).toBe("CREATE TABLE items (id integer);");
  });

  // ========================================================
  // AC2 & AC5: Rời dự án MySQL gọi nhả phiên đúng 1 lần
  // ========================================================
  test("AC2 & AC5: Rời dự án MySQL gọi nhả phiên đúng một lần, không gọi lặp", async () => {
    const fakeSid = "0123456789abcdef0123456789abcd";
    sessionStorage.setItem(MYSQL_SID_KEY, fakeSid);

    const projMysql = useWorkspaceStore.getState().createProject({
      name: "MySQL Project",
      engine: "mysql",
    });
    const projPg = useWorkspaceStore.getState().createProject({
      name: "PG Project",
      engine: "postgres",
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    // Chuyển từ dự án MySQL sang Postgres
    await onProjectSwitch(projMysql.id, projPg.id);

    // Kích hoạt DELETE đúng 1 lần tới endpoint session
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/mysql/sessions/${fakeSid}`);
    expect(init?.method).toBe("DELETE");

    // Session storage đã được xóa sạch
    expect(sessionStorage.getItem(MYSQL_SID_KEY)).toBeNull();

    // Gọi lại lần nữa (chuyển qua chuyển lại): không gọi lặp DELETE thêm lần nào
    await onProjectSwitch(projMysql.id, projPg.id);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ========================================================
  // AC3 & AC5: Nhả phiên lỗi mạng không crash UI, có toast vi/en
  // ========================================================
  test("AC3 & AC5: Nhả phiên lỗi mạng thì UI vẫn chuyển dự án, kích hoạt toast cảnh báo", async () => {
    const fakeSid = "0123456789abcdef0123456789abcd";
    sessionStorage.setItem(MYSQL_SID_KEY, fakeSid);

    const projMysql = useWorkspaceStore.getState().createProject({
      name: "MySQL Project",
      engine: "mysql",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Giả lập lỗi mất mạng (Failed to fetch)
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    global.fetch = mockFetch;

    const noticeListener = vi.fn();
    const unsub = subscribeReleaseNotice(noticeListener);

    // Gọi nhả phiên: không được crash hay ném uncaught exception
    const result = await releaseProjectResources(projMysql.id);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Failed to fetch");
    // Đã kích hoạt thông báo lỗi cho toast
    expect(noticeListener).toHaveBeenCalledTimes(1);

    // console.warn được gọi để ghi log nội bộ
    expect(warnSpy).toHaveBeenCalled();

    unsub();
    warnSpy.mockRestore();
  });

  // ========================================================
  // AC4: Mở dự án MySQL KHÔNG tự tạo container
  // ========================================================
  test("AC4: Mở dự án MySQL không tự tạo container, chỉ tạo khi bấm chạy", async () => {
    const projPg = useWorkspaceStore.getState().createProject({
      name: "PG Project",
      engine: "postgres",
    });
    const projMysql = useWorkspaceStore.getState().createProject({
      name: "MySQL Project",
      engine: "mysql",
    });

    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Chuyển từ PG sang MySQL
    await onProjectSwitch(projPg.id, projMysql.id);

    // Không có bất kỳ request POST nào được gọi để tạo container
    const postCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(0);
    expect(sessionStorage.getItem(MYSQL_SID_KEY)).toBeNull();
  });

  // ========================================================
  // Ca biên: Đổi dự án liên tiếp 5 lần trong 2 giây không gọi lặp
  // ========================================================
  test("Ca biên: Đổi dự án liên tiếp 5 lần trong 2 giây không gọi lặp nhả phiên", async () => {
    const fakeSid = "0123456789abcdef0123456789abcd";
    sessionStorage.setItem(MYSQL_SID_KEY, fakeSid);

    const projMysql = useWorkspaceStore.getState().createProject({
      name: "MySQL Project",
      engine: "mysql",
    });
    const projPg = useWorkspaceStore.getState().createProject({
      name: "PG Project",
      engine: "postgres",
    });
    const projSqlite = useWorkspaceStore.getState().createProject({
      name: "SQLite Project",
      engine: "sqlite",
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    // Kích hoạt đổi 5 lần liên tiếp:
    await onProjectSwitch(projMysql.id, projPg.id); // 1. mysql -> pg (nhả fakeSid)
    await onProjectSwitch(projPg.id, projSqlite.id); // 2. pg -> sqlite
    await onProjectSwitch(projSqlite.id, projMysql.id); // 3. sqlite -> mysql (chưa bấm Chạy nên không có sid)
    await onProjectSwitch(projMysql.id, projPg.id); // 4. mysql -> pg (không có container để nhả)
    await onProjectSwitch(projPg.id, projMysql.id); // 5. pg -> mysql

    // Request DELETE chỉ được gửi đúng 1 lần cho container session đó!
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`/api/mysql/sessions/${fakeSid}`);
  });

  // ========================================================
  // AC6: Không có request nào chứa SQL (Core Rule 7)
  // ========================================================
  test("AC6: Không có request nào chứa SQL và console log không chứa SQL (Core Rule 7)", async () => {
    const fakeSid = "0123456789abcdef0123456789abcd";
    sessionStorage.setItem(MYSQL_SID_KEY, fakeSid);

    const sensitiveSql = "SELECT * FROM users WHERE secret = 'confidential';";
    const projMysql = useWorkspaceStore.getState().createProject({
      name: "MySQL Project",
      engine: "mysql",
    });
    const tab = useWorkspaceStore.getState().createTab(projMysql.id, "secret.sql");
    useWorkspaceStore.getState().updateTabSql(tab.id, sensitiveSql);

    const projPg = useWorkspaceStore.getState().createProject({
      name: "PG Project",
      engine: "postgres",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    await onProjectSwitch(projMysql.id, projPg.id);

    // Kiểm tra tất cả các request gửi đi
    for (const [url, init] of mockFetch.mock.calls) {
      expect(String(url)).not.toContain("SELECT");
      expect(String(url)).not.toContain("users");
      expect(String(url)).not.toContain("secret");
      const body = init?.body ? String(init.body) : "";
      expect(body).not.toContain("SELECT");
      expect(body).not.toContain("users");
    }

    // Kiểm tra console log không có câu SQL
    for (const args of warnSpy.mock.calls) {
      const text = args.map(String).join(" ");
      expect(text).not.toContain(sensitiveSql);
      expect(text).not.toContain("secret");
    }

    warnSpy.mockRestore();
  });

  // ========================================================
  // Test Giao diện: Toast cảnh báo hiển thị song ngữ & tự ẩn sau 5s
  // ========================================================
  test("Toast cảnh báo: Hiển thị đúng chuỗi tiếng Việt, có nút đóng và tự ẩn sau 5s", async () => {
    vi.useFakeTimers();
    wrapToast("vi");

    // Ban đầu không hiển thị
    expect(screen.queryByTestId("engine-release-toast")).toBeNull();

    // Kích hoạt lỗi nhả phiên qua notifyReleaseFailed
    act(() => {
      notifyReleaseFailed();
    });

    // Toast xuất hiện
    const toast = screen.getByTestId("engine-release-toast");
    expect(toast).toBeDefined();
    expect(screen.getByTestId("release-failed-title").textContent).toBe(
      viWorkspace.project.releaseFailed
    );
    expect(screen.getByTestId("release-failed-desc").textContent).toBe(
      viWorkspace.project.releaseFailedDesc
    );

    // Tự ẩn sau 5 giây (AC3)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("engine-release-toast")).toBeNull();
  });

  test("Toast cảnh báo: Hiển thị đúng chuỗi tiếng Anh và đóng khi click nút X", async () => {
    wrapToast("en");

    expect(screen.queryByTestId("engine-release-toast")).toBeNull();

    // Kích hoạt lỗi nhả phiên
    act(() => {
      notifyReleaseFailed();
    });

    // Tiếng Anh
    expect(screen.getByTestId("release-failed-title").textContent).toBe(
      enWorkspace.project.releaseFailed
    );
    expect(screen.getByTestId("release-failed-desc").textContent).toBe(
      enWorkspace.project.releaseFailedDesc
    );

    // Click nút Đóng
    const closeBtn = screen.getByTestId("engine-release-toast-dismiss");
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("engine-release-toast")).toBeNull();
  });

  // ========================================================
  // Đổi engine trên cùng một dự án: nhả container & bindEngine
  // ========================================================
  test("Đổi engine trên cùng một dự án từ mysql sang postgres kích hoạt nhả phiên container và cập nhật bindEngine", async () => {
    const fakeSid = "0123456789abcdef0123456789abcd";
    sessionStorage.setItem(MYSQL_SID_KEY, fakeSid);

    const projMysql = useWorkspaceStore.getState().createProject({
      name: "Dynamic Engine Project",
      engine: "mysql",
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = mockFetch;

    expect(currentEngine(projMysql.id)).toBe("mysql");

    // Người dùng đổi Engine trên header từ MySQL sang Postgres:
    // 1. Nhả tài nguyên phiên MySQL
    await releaseProjectResources(projMysql.id);
    // 2. Gắn engine mới cho dự án
    bindEngine(projMysql.id, "postgres");

    // Kiểm tra đã gọi DELETE tới endpoint session của MySQL đúng 1 lần
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`/api/mysql/sessions/${fakeSid}`);

    // Engine của dự án đã đổi thành postgres và session id đã bị xóa
    expect(currentEngine(projMysql.id)).toBe("postgres");
    expect(sessionStorage.getItem(MYSQL_SID_KEY)).toBeNull();
  });
});
