import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workspaceMessagesEn from "../../../messages/en/workspace.json";
import workspaceMessagesVi from "../../../messages/vi/workspace.json";
import { AuthContext, type Auth } from "@/modules/auth/auth-provider";
import { openWorkspaceDb } from "./db";
import {
  dismissGuestImport,
  hasGuestDrafts,
  importGuestDrafts,
  isGuestImportDismissed,
  isGuestImportedForUser,
  markGuestImportedForUser,
} from "./import-guest";
import { getRepository, WorkspaceQuotaError } from "./repository";
import type { WorkspaceProject, WorkspaceTab } from "./types";
import { ImportGuestBanner } from "./components/import-guest-banner";

const USER_ID = "usr_amelia_123";

const makeProject = (over: Partial<WorkspaceProject> & { id: string; scopeKey: string }): WorkspaceProject => ({
  name: "Dự án khách",
  engine: "postgres",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

const makeTab = (over: Partial<WorkspaceTab> & { id: string; projectId: string }): WorkspaceTab => ({
  name: "Query 1",
  sql: "SELECT 1;",
  position: 0,
  updatedAt: Date.now(),
  ...over,
});

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("import-guest (Task130)", () => {
  let factory: IDBFactory;
  let db: IDBDatabase;
  let mockStorage: Storage;
  let mockSessionStorage: Storage;

  beforeEach(async () => {
    factory = new IDBFactory();
    db = await openWorkspaceDb(factory);
    mockStorage = createMockStorage();
    mockSessionStorage = createMockStorage();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    cleanup();
    vi.restoreAllMocks();
  });

  describe("Helper Flags (Storage & SessionStorage)", () => {
    it("isGuestImportDismissed và dismissGuestImport tương tác đúng với sessionStorage", () => {
      expect(isGuestImportDismissed(USER_ID, { sessionStorage: mockSessionStorage })).toBe(false);

      dismissGuestImport(USER_ID, { sessionStorage: mockSessionStorage });
      expect(isGuestImportDismissed(USER_ID, { sessionStorage: mockSessionStorage })).toBe(true);

      // User khác vẫn là false
      expect(isGuestImportDismissed("other_user", { sessionStorage: mockSessionStorage })).toBe(false);
    });

    it("isGuestImportedForUser và markGuestImportedForUser tương tác đúng với localStorage", () => {
      expect(isGuestImportedForUser(USER_ID, { storage: mockStorage })).toBe(false);

      markGuestImportedForUser(USER_ID, { storage: mockStorage });
      expect(isGuestImportedForUser(USER_ID, { storage: mockStorage })).toBe(true);

      // User khác vẫn là false
      expect(isGuestImportedForUser("other_user", { storage: mockStorage })).toBe(false);
    });

    it("Bảo vệ an toàn khi userId rỗng hoặc storage bị chặn", () => {
      expect(isGuestImportDismissed("", { sessionStorage: mockSessionStorage })).toBe(true);
      expect(isGuestImportedForUser("", { storage: mockStorage })).toBe(false);

      const brokenStorage = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      } as unknown as Storage;

      expect(isGuestImportDismissed(USER_ID, { sessionStorage: brokenStorage })).toBe(false);
      expect(isGuestImportedForUser(USER_ID, { storage: brokenStorage })).toBe(false);
      expect(() => dismissGuestImport(USER_ID, { sessionStorage: brokenStorage })).not.toThrow();
      expect(() => markGuestImportedForUser(USER_ID, { storage: brokenStorage })).not.toThrow();
    });
  });

  describe("hasGuestDrafts", () => {
    it("Trả về false khi không có bất kỳ project nào", async () => {
      expect(await hasGuestDrafts({ db })).toBe(false);
    });

    it("Trả về false khi có 1 project nhưng 0 tab hoặc 1 tab rỗng", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p_guest", scopeKey: "guest" }));

      // 0 tab
      expect(await hasGuestDrafts({ db })).toBe(false);

      // 1 tab rỗng
      await repo.upsertTab(makeTab({ id: "t_empty", projectId: "p_guest", sql: "   \n\t " }));
      expect(await hasGuestDrafts({ db })).toBe(false);
    });

    it("Trả về true khi có 1 tab có SQL thực sự", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p_guest", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "t1", projectId: "p_guest", sql: "SELECT * FROM users;" }));

      expect(await hasGuestDrafts({ db })).toBe(true);
    });

    it("Trả về true khi người dùng tạo nhiều hơn 1 tab (dù tab rỗng)", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p_guest", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "t1", projectId: "p_guest", sql: "" }));
      await repo.upsertTab(makeTab({ id: "t2", projectId: "p_guest", sql: "" }));

      expect(await hasGuestDrafts({ db })).toBe(true);
    });

    it("Trả về true khi người dùng tạo nhiều hơn 1 project", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "p1", scopeKey: "guest", name: "Dự án 1" }));
      await repo.upsertProject(makeProject({ id: "p2", scopeKey: "guest", name: "Dự án 2" }));

      expect(await hasGuestDrafts({ db })).toBe(true);
    });

    it("Bắt lỗi an toàn khi IndexedDB bị chặn trong private browsing", async () => {
      const brokenFactory = {
        open: () => {
          const req = {} as IDBOpenDBRequest;
          setTimeout(() => {
            const err = new Error("SecurityError: Access is denied");
            err.name = "SecurityError";
            Object.defineProperty(req, "error", { value: err });
            req.onerror?.(new Event("error"));
          }, 0);
          return req;
        },
      } as unknown as IDBFactory;

      expect(await hasGuestDrafts({ factory: brokenFactory })).toBe(false);
    });
  });

  describe("importGuestDrafts (AC2 & AC5)", () => {
    it("AC2: Nhân bản toàn bộ projects và tabs sang scope user_<uuid> với id mới, bản guest còn nguyên 100%", async () => {
      const repo = getRepository(db);

      // Tạo 2 dự án cho khách: Dự án 1 có 2 tab, Dự án 2 có 1 tab
      await repo.upsertProject(
        makeProject({ id: "g_p1", scopeKey: "guest", name: "Guest Project 1", engine: "postgres" }),
      );
      await repo.upsertTab(
        makeTab({ id: "g_t1", projectId: "g_p1", name: "Q1", sql: "SELECT 1;", position: 0 }),
      );
      await repo.upsertTab(
        makeTab({ id: "g_t2", projectId: "g_p1", name: "Q2", sql: "SELECT 2;", position: 1 }),
      );

      await repo.upsertProject(
        makeProject({ id: "g_p2", scopeKey: "guest", name: "Guest Project 2", engine: "mysql" }),
      );
      await repo.upsertTab(
        makeTab({ id: "g_t3", projectId: "g_p2", name: "MySQL Query", sql: "SHOW TABLES;", position: 0 }),
      );

      // Thực hiện import
      const result = await importGuestDrafts(USER_ID, {
        db,
        storage: mockStorage,
        sessionStorage: mockSessionStorage,
      });

      expect(result).toEqual({ projects: 2, tabs: 3 });

      // 1. Kiểm tra scope của User
      const userProjects = await repo.listProjects({ kind: "user", userId: USER_ID });
      expect(userProjects).toHaveLength(2);

      const userP1 = userProjects.find((p) => p.name === "Guest Project 1");
      const userP2 = userProjects.find((p) => p.name === "Guest Project 2");
      expect(userP1).toBeDefined();
      expect(userP2).toBeDefined();
      expect(userP1!.id).not.toBe("g_p1");
      expect(userP2!.id).not.toBe("g_p2");
      expect(userP1!.engine).toBe("postgres");
      expect(userP2!.engine).toBe("mysql");

      const userTabsP1 = await repo.listTabs(userP1!.id);
      expect(userTabsP1).toHaveLength(2);
      expect(userTabsP1[0].id).not.toBe("g_t1");
      expect(userTabsP1[0].name).toBe("Q1");
      expect(userTabsP1[0].sql).toBe("SELECT 1;");
      expect(userTabsP1[0].projectId).toBe(userP1!.id);

      expect(userTabsP1[1].id).not.toBe("g_t2");
      expect(userTabsP1[1].name).toBe("Q2");
      expect(userTabsP1[1].sql).toBe("SELECT 2;");
      expect(userTabsP1[1].projectId).toBe(userP1!.id);

      const userTabsP2 = await repo.listTabs(userP2!.id);
      expect(userTabsP2).toHaveLength(1);
      expect(userTabsP2[0].id).not.toBe("g_t3");
      expect(userTabsP2[0].name).toBe("MySQL Query");
      expect(userTabsP2[0].sql).toBe("SHOW TABLES;");
      expect(userTabsP2[0].projectId).toBe(userP2!.id);

      // 2. AC2: Bản guest còn nguyên vẹn 100%
      const guestProjects = await repo.listProjects({ kind: "guest" });
      expect(guestProjects).toHaveLength(2);
      const guestTabsP1 = await repo.listTabs("g_p1");
      expect(guestTabsP1).toHaveLength(2);
      expect(guestTabsP1[0].sql).toBe("SELECT 1;");
      expect(guestTabsP1[1].sql).toBe("SELECT 2;");
      const guestTabsP2 = await repo.listTabs("g_p2");
      expect(guestTabsP2).toHaveLength(1);
      expect(guestTabsP2[0].sql).toBe("SHOW TABLES;");

      // Cờ đã được ghi nhận
      expect(isGuestImportedForUser(USER_ID, { storage: mockStorage })).toBe(true);
    });

    it("AC5: Gọi lần 2 không tạo bản trùng lặp (chặn bằng cờ đã nhập)", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest", name: "Guest Project" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      // Lần 1
      const res1 = await importGuestDrafts(USER_ID, { db, storage: mockStorage });
      expect(res1).toEqual({ projects: 1, tabs: 1 });

      // Lần 2
      const res2 = await importGuestDrafts(USER_ID, { db, storage: mockStorage });
      expect(res2).toEqual({ projects: 0, tabs: 0 });

      // Scope user vẫn chỉ có đúng 1 project và 1 tab
      const userProjects = await repo.listProjects({ kind: "user", userId: USER_ID });
      expect(userProjects).toHaveLength(1);
    });

    it("Ca biên: Guest có 50 tab", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p50", scopeKey: "guest", name: "Heavy Project" }));

      for (let i = 0; i < 50; i++) {
        await repo.upsertTab(
          makeTab({
            id: `g_tab_${i}`,
            projectId: "g_p50",
            name: `Query ${i + 1}`,
            sql: `SELECT ${i + 1};`,
            position: i,
          }),
        );
      }

      const res = await importGuestDrafts(USER_ID, { db, storage: mockStorage });
      expect(res).toEqual({ projects: 1, tabs: 50 });

      const userProjects = await repo.listProjects({ kind: "user", userId: USER_ID });
      expect(userProjects).toHaveLength(1);
      const userTabs = await repo.listTabs(userProjects[0].id);
      expect(userTabs).toHaveLength(50);
      expect(userTabs[49].sql).toBe("SELECT 50;");
      expect(userTabs[49].position).toBe(49);

      // Bản guest vẫn nguyên vẹn 50 tab
      const guestTabs = await repo.listTabs("g_p50");
      expect(guestTabs).toHaveLength(50);
    });

    it("Ca biên: QuotaExceededError giữa đường không làm mất dữ liệu guest", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest", name: "Project 1" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 'safe';" }));

      // Giả lập lỗi QuotaExceededError khi upsertTab
      const quotaErr = new Error("Quota exceeded");
      quotaErr.name = "QuotaExceededError";
      vi.spyOn(repo, "upsertTab").mockRejectedValueOnce(quotaErr);

      await expect(
        importGuestDrafts(USER_ID, { db, repo, storage: mockStorage }),
      ).rejects.toThrow(WorkspaceQuotaError);

      // Dữ liệu guest hoàn toàn an toàn
      const guestProjects = await repo.listProjects({ kind: "guest" });
      expect(guestProjects).toHaveLength(1);
      const guestTabs = await repo.listTabs("g_p1");
      expect(guestTabs).toHaveLength(1);
      expect(guestTabs[0].sql).toBe("SELECT 'safe';");

      // Cờ chưa được ghi vì thất bại
      expect(isGuestImportedForUser(USER_ID, { storage: mockStorage })).toBe(false);
    });

    it("Ca biên: Chống bấm đúp bằng in-flight deduplication", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest", name: "Concurrent Project" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1" }));

      const [res1, res2] = await Promise.all([
        importGuestDrafts(USER_ID, { db, storage: mockStorage }),
        importGuestDrafts(USER_ID, { db, storage: mockStorage }),
      ]);

      // Cả hai caller cùng nhận kết quả từ một execution duy nhất
      expect(res1).toEqual({ projects: 1, tabs: 1 });
      expect(res2).toEqual({ projects: 1, tabs: 1 });
      expect(res1).toBe(res2);

      // Scope user chỉ có đúng 1 project và 1 tab, không bị nhân đôi
      const userProjects = await repo.listProjects({ kind: "user", userId: USER_ID });
      expect(userProjects).toHaveLength(1);
      const userTabs = await repo.listTabs(userProjects[0].id);
      expect(userTabs).toHaveLength(1);
    });
  });

  describe("AC5: Tuyệt đối không gọi bất kỳ API cloud nào (Core Rule 7)", () => {
    it("Toàn bộ thao tác kiểm tra và nhập nháp không kích hoạt fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      const has = await hasGuestDrafts({ db });
      expect(has).toBe(true);

      const res = await importGuestDrafts(USER_ID, { db, storage: mockStorage, sessionStorage: mockSessionStorage });
      expect(res.projects).toBe(1);

      dismissGuestImport(USER_ID, { sessionStorage: mockSessionStorage });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("ImportGuestBanner Component & Accessibility (AC1, AC3, AC4, AC6)", () => {
    const makeAuthContext = (over: Partial<Auth> = {}): Auth => ({
      status: "user",
      user: { id: USER_ID, name: "Amelia", provider: "github", role: "user" },
      markAnon: vi.fn(),
      logout: vi.fn().mockResolvedValue(true),
      refreshUser: vi.fn().mockResolvedValue(undefined),
      banner: null,
      setBanner: vi.fn(),
      sqlRef: { current: "" },
      ...over,
    });

    const renderBanner = (
      authValue = makeAuthContext(),
      props: Partial<React.ComponentProps<typeof ImportGuestBanner>> = {},
      locale: "vi" | "en" = "vi",
    ) => {
      const messages = locale === "vi" ? { workspace: workspaceMessagesVi } : { workspace: workspaceMessagesEn };
      return render(
        React.createElement(
          NextIntlClientProvider as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          { locale, messages },
          React.createElement(
            AuthContext.Provider,
            { value: authValue },
            React.createElement(ImportGuestBanner, {
              options: { db, storage: mockStorage, sessionStorage: mockSessionStorage },
              bootFn: vi.fn().mockResolvedValue({ projectId: "p", tabId: "t" }),
              ...props,
            }),
          ),
        ),
      );
    };

    it("AC1 & AC6: Hiển thị đúng đầy đủ bản dịch tiếng Việt khi user có nháp guest", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner(makeAuthContext(), {}, "vi");

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      expect(screen.getByTestId("import-guest-banner-title").textContent).toBe(
        "Bạn có câu lệnh và dự án nháp từ phiên trước khi đăng nhập trên máy này.",
      );
      expect(screen.getByTestId("import-guest-action-btn").textContent).toContain("Nhập vào tài khoản");
      expect(screen.getByTestId("import-guest-dismiss-btn").textContent).toContain("Bỏ qua");
    });

    it("AC6: Hiển thị đúng đầy đủ bản dịch tiếng Anh", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner(makeAuthContext(), {}, "en");

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      expect(screen.getByTestId("import-guest-banner-title").textContent).toBe(
        "You have draft queries and projects saved before signing in on this device.",
      );
      expect(screen.getByTestId("import-guest-action-btn").textContent).toContain("Import to account");
      expect(screen.getByTestId("import-guest-dismiss-btn").textContent).toContain("Dismiss");
    });

    it("AC6: Không tự động chiếm focus (không autofocus nút nào)", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner();

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      const actionBtn = screen.getByTestId("import-guest-action-btn");
      const dismissBtn = screen.getByTestId("import-guest-dismiss-btn");

      expect(actionBtn.getAttribute("autofocus")).toBeNull();
      expect(dismissBtn.getAttribute("autofocus")).toBeNull();
      expect(document.activeElement).not.toBe(actionBtn);
      expect(document.activeElement).not.toBe(dismissBtn);
    });

    it("Không hiển thị banner khi người dùng chưa đăng nhập (status = anon)", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner(makeAuthContext({ status: "anon", user: null }));

      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId("import-guest-banner")).toBeNull();
    });

    it("Không hiển thị banner khi guest không có nháp", async () => {
      renderBanner();

      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId("import-guest-banner")).toBeNull();
    });

    it("AC4: Bấm 'Bỏ qua' ghi cờ vào sessionStorage và ẩn banner ngay lập tức", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner();

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      const dismissBtn = screen.getByTestId("import-guest-dismiss-btn");
      await act(async () => {
        fireEvent.click(dismissBtn);
      });

      expect(screen.queryByTestId("import-guest-banner")).toBeNull();
      expect(isGuestImportDismissed(USER_ID, { sessionStorage: mockSessionStorage })).toBe(true);
    });

    it("AC3: Bấm 'Nhập vào tài khoản' gọi import, boot lại workspace, hiển thị toast và ẩn banner", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest", name: "Guest Project" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      const bootFn = vi.fn().mockResolvedValue({ projectId: "p", tabId: "t" });
      const onImportSuccess = vi.fn();

      renderBanner(makeAuthContext(), { bootFn, onImportSuccess });

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      const actionBtn = screen.getByTestId("import-guest-action-btn");
      await act(async () => {
        fireEvent.click(actionBtn);
      });

      // Banner ẩn đi sau khi import thành công
      await waitFor(() => {
        expect(screen.queryByTestId("import-guest-banner")).toBeNull();
      });

      // bootFn được gọi để cập nhật lại workspace của user
      expect(bootFn).toHaveBeenCalledWith({ kind: "user", userId: USER_ID });
      expect(onImportSuccess).toHaveBeenCalledWith({ projects: 1, tabs: 1 });

      // AC3: Toast hiển thị số project/tab đã nhập
      const toast = screen.getByTestId("guest-import-toast");
      expect(toast).toBeTruthy();
      expect(screen.getByTestId("guest-import-toast-text").textContent).toContain("1 dự án");
      expect(screen.getByTestId("guest-import-toast-text").textContent).toContain("1 tab");

      // Bấm nút đóng trên toast
      const closeToastBtn = screen.getByTestId("guest-import-toast-dismiss");
      await act(async () => {
        fireEvent.click(closeToastBtn);
      });
      expect(screen.queryByTestId("guest-import-toast")).toBeNull();
    });

    it("AC6: Responsive layout chứa các class hỗ trợ màn hình 390px", async () => {
      const repo = getRepository(db);
      await repo.upsertProject(makeProject({ id: "g_p1", scopeKey: "guest" }));
      await repo.upsertTab(makeTab({ id: "g_t1", projectId: "g_p1", sql: "SELECT 1;" }));

      renderBanner();

      await waitFor(() => {
        expect(screen.getByTestId("import-guest-banner")).toBeTruthy();
      });

      const banner = screen.getByTestId("import-guest-banner");
      expect(banner.className).toContain("flex-col");
      expect(banner.className).toContain("sm:flex-row");
    });
  });
});
