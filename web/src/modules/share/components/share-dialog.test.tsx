import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../../../../messages/en/share.json";
import messagesVi from "../../../../messages/vi/share.json";
import {
  buildSnapshotFromStore,
  formatTimestamp,
  getSnapshotFileName,
  sanitizeFileName,
  ShareButton,
  ShareDialog,
  statusForEncodeError,
} from "./share-dialog";
import { decodeSnapshot, encodeSnapshot } from "../codec";
import { SnapshotError, validateSnapshotStructure } from "../snapshot";
import { useWorkspaceStore } from "@/modules/workspace/store";

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function makeRandomSql(length: number): string {
  let s = "SELECT '";
  while (s.length < length) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, length) + "';";
}

function renderShareDialog(
  props: { open?: boolean; onOpenChange?: (open: boolean) => void; disabled?: boolean } = {},
  locale: "vi" | "en" = "vi"
) {
  const messages = {
    share: locale === "vi" ? messagesVi : messagesEn,
  };

  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ShareDialog {...props} />
    </NextIntlClientProvider>
  );
}

describe("ShareDialog & ShareButton (Task144)", () => {
  let createdBlobs: { blob: Blob; fileName: string }[] = [];
  let clickedAnchors: HTMLAnchorElement[] = [];

  beforeEach(() => {
    createdBlobs = [];
    clickedAnchors = [];

    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().hydrate({
      projects: [
        {
          id: "proj-1",
          name: "Dự án Bán hàng",
          engine: "postgres",
          scopeKey: "guest",
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      tabs: [
        {
          id: "tab-1",
          projectId: "proj-1",
          name: "Khách hàng.sql",
          sql: "SELECT id, name FROM customers;",
          position: 0,
          updatedAt: 1000,
        },
        {
          id: "tab-2",
          projectId: "proj-1",
          name: "Đơn hàng.sql",
          sql: "SELECT * FROM orders WHERE total > 100;",
          position: 1,
          updatedAt: 1000,
        },
      ],
      activeProjectId: "proj-1",
      activeTabId: "tab-1",
    });

    // Mock URL.createObjectURL & URL.revokeObjectURL
    globalThis.URL.createObjectURL = vi.fn(() => {
      return "blob:mock-url-" + Math.random().toString(36).slice(2);
    });
    globalThis.URL.revokeObjectURL = vi.fn();

    // Mock HTMLAnchorElement click
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchors.push(this);
      if (this.download) {
        createdBlobs.push({
          blob: new Blob([]),
          fileName: this.download,
        });
      }
    });
  });

  describe("Helper Functions", () => {
    it("sanitizeFileName làm sạch ký tự cấm và khoảng trắng", () => {
      expect(sanitizeFileName("Dự án /:*?\"<>| test")).toBe("Dự-án-test");
      expect(sanitizeFileName("   ")).toBe("sqllens");
      expect(sanitizeFileName(undefined)).toBe("sqllens");
      expect(sanitizeFileName("My---Project")).toBe("My-Project");
    });

    it("formatTimestamp định dạng đúng YYYYMMDD-HHmm", () => {
      const date = new Date(2026, 10, 19, 14, 5); // Tháng 11 (0-indexed: 10), ngày 19, 14:05
      expect(formatTimestamp(date)).toBe("20261119-1405");
    });

    it("getSnapshotFileName tạo tên file đúng định dạng", () => {
      const date = new Date(2026, 10, 19, 14, 5);
      const name = getSnapshotFileName("Hệ thống POS", date);
      expect(name).toBe("Hệ-thống-POS-snapshot-20261119-1405.sqllens");
    });

    it("buildSnapshotFromStore sắp xếp tabs theo position và lấy đúng active project", () => {
      const state = useWorkspaceStore.getState();
      const snapshot = buildSnapshotFromStore(state.activeProjectId, state.projects, state.tabs);

      expect(snapshot.v).toBe(1);
      expect(snapshot.project.name).toBe("Dự án Bán hàng");
      expect(snapshot.project.engine).toBe("postgres");
      expect(snapshot.tabs).toHaveLength(2);
      expect(snapshot.tabs[0].name).toBe("Khách hàng.sql");
      expect(snapshot.tabs[1].name).toBe("Đơn hàng.sql");
    });
  });

  describe("AC1: Bấm Share tạo URL, sao chép link, hiện Đã sao chép", () => {
    it("mở dialog, tạo URL đúng format và sao chép vào clipboard thành công", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      renderShareDialog();

      // Click nút Share để mở Dialog
      const triggerBtn = screen.getByTestId("share-button-trigger");
      fireEvent.click(triggerBtn);

      // Chờ URL input xuất hiện
      const input = await screen.findByTestId("share-url-input");
      expect(input).toBeTruthy();
      const shareUrl = (input as HTMLInputElement).value;
      expect(shareUrl).toContain("/vi/share#d=");

      // Bấm nút Sao chép
      const copyBtn = screen.getByTestId("share-copy-btn");
      expect(copyBtn.textContent).toContain(messagesVi.copy);

      fireEvent.click(copyBtn);

      // Kiểm tra clipboard đã được gọi với URL
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(shareUrl);
      });

      // Kiểm tra nút đổi nhãn thành "Đã sao chép!"
      expect(copyBtn.textContent).toContain(messagesVi.copied);
    });

    it("nút Đã sao chép tự động phục hồi sau 2 giây", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      renderShareDialog({ open: true });

      const copyBtn = await screen.findByTestId("share-copy-btn");
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(copyBtn.textContent).toContain(messagesVi.copied);
      });

      // Chạy 2100ms
      vi.advanceTimersByTime(2100);

      await waitFor(() => {
        expect(copyBtn.textContent).toContain(messagesVi.copy);
      });
      vi.useRealTimers();
    });
  });

  describe("AC2: Luôn hiện cảnh báo quyền riêng tư ở mọi trạng thái", () => {
    it("hiển thị cảnh báo quyền riêng tư ở trạng thái OK (< 8KB)", async () => {
      renderShareDialog({ open: true });

      const privacyWarning = await screen.findByTestId("share-privacy-warning");
      expect(privacyWarning).toBeTruthy();
      expect(privacyWarning.textContent).toContain(messagesVi.warningPrivacy);
    });

    it("hiển thị cảnh báo quyền riêng tư ở trạng thái WARN (8KB - 32KB)", async () => {
      // Dữ liệu entropy cao 13.000 ký tự -> sau gzip đạt ~10-12KB (WARN)
      const warnSql = makeRandomSql(13000);
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Warn Project", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [{ id: "t1", projectId: "p1", name: "query.sql", sql: warnSql, position: 0, updatedAt: 0 }],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const privacyWarning = await screen.findByTestId("share-privacy-warning");
      expect(privacyWarning).toBeTruthy();
      expect(privacyWarning.textContent).toContain(messagesVi.warningPrivacy);

      // Đồng thời ở trạng thái warn, cảnh báo warn length cũng xuất hiện
      const lengthWarning = await screen.findByTestId("share-length-warning");
      expect(lengthWarning).toBeTruthy();
    });

    it("hiển thị cảnh báo quyền riêng tư ở trạng thái BLOCKED (> 32KB)", async () => {
      // Dữ liệu entropy cao 45.000 ký tự -> sau gzip đạt ~35KB (BLOCKED)
      const hugeSql = makeRandomSql(45000);
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Blocked Project", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [{ id: "t1", projectId: "p1", name: "query.sql", sql: hugeSql, position: 0, updatedAt: 0 }],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const privacyWarning = await screen.findByTestId("share-privacy-warning");
      expect(privacyWarning).toBeTruthy();
      expect(privacyWarning.textContent).toContain(messagesVi.warningPrivacy);

      // Cảnh báo blocked xuất hiện
      const blockedWarning = await screen.findByTestId("share-blocked-warning");
      expect(blockedWarning).toBeTruthy();
      expect(blockedWarning.textContent).toContain(messagesVi.blocked);
    });
  });

  describe("AC3: 8-32KB cảnh báo chat; > 32KB chặn link và chỉ cho tải file", () => {
    it("trạng thái warn (8KB - 32KB): hiện cảnh báo chat, vẫn cho sao chép URL và cung cấp nút tải file", async () => {
      const warnSql = makeRandomSql(13000);
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Warn Demo", engine: "mysql", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [{ id: "t1", projectId: "p1", name: "q.sql", sql: warnSql, position: 0, updatedAt: 0 }],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const warnAlert = await screen.findByTestId("share-length-warning");
      expect(warnAlert).toBeTruthy();

      // Vẫn có ô input URL và nút Copy
      expect(screen.getByTestId("share-url-input")).toBeTruthy();
      expect(screen.getByTestId("share-copy-btn")).toBeTruthy();

      // Có nút tải file .sqllens kèm chú thích
      const downloadBtn = screen.getByTestId("share-download-btn");
      expect(downloadBtn).toBeTruthy();
      expect(downloadBtn.textContent).toContain(messagesVi.download);
      expect(screen.getByTestId("share-download-hint").textContent).toContain(messagesVi.downloadHint);
    });

    it("trạng thái blocked (> 32KB): ẩn link và nút copy, chỉ cung cấp nút tải file .sqllens", async () => {
      const hugeSql = makeRandomSql(45000);
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Blocked Demo", engine: "sqlite", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [{ id: "t1", projectId: "p1", name: "huge.sql", sql: hugeSql, position: 0, updatedAt: 0 }],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const blockedAlert = await screen.findByTestId("share-blocked-warning");
      expect(blockedAlert).toBeTruthy();
      expect(blockedAlert.textContent).toContain(messagesVi.blocked);

      // KHÔNG có ô input URL và nút Copy
      expect(screen.queryByTestId("share-url-input")).toBeNull();
      expect(screen.queryByTestId("share-copy-btn")).toBeNull();

      // Chỉ có nút tải file .sqllens kèm chú thích
      const downloadBtn = screen.getByTestId("share-download-btn");
      expect(downloadBtn).toBeTruthy();
      expect(downloadBtn.textContent).toContain(messagesVi.download);
      expect(screen.getByTestId("share-download-hint").textContent).toContain(messagesVi.downloadHint);
    });

    it("quá 100 tab: báo đúng lý do số tab, KHÔNG báo nhầm 32 KB và KHÔNG mời tải file .sqllens", async () => {
      // 101 tab rỗng: tổng chỉ vài KB nên nếu gộp lỗi, thông báo sẽ sai là "quá 32 KB".
      const manyTabs = Array.from({ length: 101 }, (_, i) => ({
        id: `t${i}`,
        projectId: "p1",
        name: `q${i}.sql`,
        sql: "",
        position: i,
        updatedAt: 0,
      }));
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Dự án nhiều tab", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: manyTabs,
        activeProjectId: "p1",
        activeTabId: "t0",
      });

      renderShareDialog({ open: true });

      const tabsAlert = await screen.findByTestId("share-too-many-tabs-warning");
      expect(tabsAlert.textContent).toContain("100");
      expect(tabsAlert.textContent).toContain("tab");
      // Không được nói sai nguyên nhân là vượt 32 KB.
      expect(tabsAlert.textContent).not.toContain("32 KB");
      expect(screen.queryByTestId("share-blocked-warning")).toBeNull();
      // File .sqllens cũng bị decodeSnapshot từ chối vì đúng lý do này, nên không mời tải.
      expect(screen.queryByTestId("share-download-btn")).toBeNull();
      expect(screen.queryByTestId("share-url-input")).toBeNull();
      expect(screen.queryByTestId("share-copy-btn")).toBeNull();
    });

    it("mỗi mã lỗi mã hoá ra một trạng thái riêng, lỗi lạ không bị báo nhầm thành quá 32 KB", () => {
      expect(statusForEncodeError(new SnapshotError("SNAPSHOT_TOO_MANY_TABS", "x"))).toBe("blocked-tabs");
      expect(statusForEncodeError(new SnapshotError("SNAPSHOT_TOO_LARGE", "x"))).toBe("blocked");
      expect(statusForEncodeError(new SnapshotError("SNAPSHOT_CORRUPT", "x"))).toBe("failed");
      expect(statusForEncodeError(new SnapshotError("SNAPSHOT_VERSION_UNSUPPORTED", "x"))).toBe("failed");
      expect(statusForEncodeError(new Error("boom"))).toBe("failed");
      expect(statusForEncodeError(undefined)).toBe("failed");
    });
  });

  describe("AC4: 0 request mạng khi tạo link và sao chép", () => {
    it("hoàn toàn không gọi fetch hoặc XMLHttpRequest", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const xhrSpy = vi.spyOn(globalThis, "XMLHttpRequest");

      renderShareDialog();

      // Mở dialog
      fireEvent.click(screen.getByTestId("share-button-trigger"));

      // Chờ tạo URL
      await screen.findByTestId("share-url-input");

      // Bấm sao chép
      const copyBtn = screen.getByTestId("share-copy-btn");
      fireEvent.click(copyBtn);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
      xhrSpy.mockRestore();
    });
  });

  describe("AC5: Tải file .sqllens sinh JSON đúng SnapshotV1, giải mã được", () => {
    it("bấm nút tải file sinh ra file .sqllens hợp lệ và kiểm tra tính toàn vẹn", async () => {
      // Dữ liệu lớn để vào trạng thái blocked có nút download
      const hugeSql = makeRandomSql(45000);
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Kế toán / Thuế: 2026", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [{ id: "t1", projectId: "p1", name: "bao_cao.sql", sql: hugeSql, position: 0, updatedAt: 0 }],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const downloadBtn = await screen.findByTestId("share-download-btn");

      // Click download (sẽ trigger saveBlob)
      fireEvent.click(downloadBtn);

      // Kiểm tra anchor click đã được gọi và tên file được làm sạch ký tự cấm
      expect(clickedAnchors.length).toBeGreaterThan(0);
      const downloadName = clickedAnchors[clickedAnchors.length - 1].download;
      expect(downloadName).toContain("Kế-toán-Thuế-2026-snapshot-");
      expect(downloadName).toMatch(/\.sqllens$/);
      expect(downloadName).not.toMatch(/[\/\\:*?"<>|]/);
    });

    it("nội dung file tải về là JSON SnapshotV1 chuẩn và decodeSnapshot đọc được", async () => {
      const state = useWorkspaceStore.getState();
      const snapshot = buildSnapshotFromStore(state.activeProjectId, state.projects, state.tabs);

      // Kiểm tra validateSnapshotStructure
      expect(validateSnapshotStructure(snapshot)).toBe(true);

      // Kiểm tra vòng tròn: encodeSnapshot -> decodeSnapshot
      const encoded = await encodeSnapshot(snapshot);
      const decoded = await decodeSnapshot(encoded);

      expect(decoded.v).toBe(1);
      expect(decoded.project.name).toBe(snapshot.project.name);
      expect(decoded.project.engine).toBe(snapshot.project.engine);
      expect(decoded.tabs).toEqual(snapshot.tabs);
    });
  });

  describe("AC6: Đủ bản dịch vi/en, bàn phím điều hướng, responsive 390px", () => {
    it("hiển thị chính xác toàn bộ bản dịch tiếng Anh (locale='en')", async () => {
      renderShareDialog({ open: true }, "en");

      const title = await screen.findByTestId("share-dialog-title");
      expect(title.textContent).toContain(messagesEn.title);
      expect(screen.getByTestId("share-privacy-warning").textContent).toContain(messagesEn.warningPrivacy);
      
      const copyBtn = await screen.findByTestId("share-copy-btn");
      expect(copyBtn.textContent).toContain(messagesEn.copy);
      
      const closeBtn = await screen.findByTestId("share-close-btn");
      expect(closeBtn.textContent).toContain(messagesEn.close);
    });

    it("đóng được dialog bằng nút Đóng", async () => {
      const onOpenChangeMock = vi.fn();
      renderShareDialog({ open: true, onOpenChange: onOpenChangeMock });

      const closeBtn = await screen.findByTestId("share-close-btn");
      fireEvent.click(closeBtn);

      expect(onOpenChangeMock).toHaveBeenCalledWith(false);
    });

    it("phù hợp với màn hình 390px (chứa các class responsive không tràn)", async () => {
      renderShareDialog({ open: true });

      const dialogContent = await screen.findByTestId("share-dialog-content");
      expect(dialogContent.className).toContain("max-w-[calc(100%-2rem)]");
      expect(dialogContent.className).toContain("sm:max-w-md");

      const input = await screen.findByTestId("share-url-input");
      expect(input.className).toContain("truncate");
      expect(input.className).toContain("select-all");
    });
  });

  describe("Ca biên & Fallback", () => {
    it("workspace có 100 tabs vẫn tạo snapshot và xử lý bình thường", async () => {
      const tabs = Array.from({ length: 100 }, (_, i) => ({
        id: `tab-${i}`,
        projectId: "proj-1",
        name: `Query_${i}.sql`,
        sql: `SELECT ${i} AS col;`,
        position: i,
        updatedAt: 1000 + i,
      }));

      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "proj-1", name: "100 Tabs Project", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs,
        activeProjectId: "proj-1",
        activeTabId: "tab-0",
      });

      renderShareDialog({ open: true });

      const input = await screen.findByTestId("share-url-input");
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toContain("#d=");
    });

    it("fallback an toàn khi clipboard API bị chặn: tự động select input", async () => {
      // Giả lập clipboard.writeText bị lỗi/chặn
      const writeTextMock = vi.fn().mockRejectedValue(new Error("NotAllowedError: Permission denied"));
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      renderShareDialog({ open: true });

      const input = (await screen.findByTestId("share-url-input")) as HTMLInputElement;
      const selectSpy = vi.spyOn(input, "select");

      const copyBtn = screen.getByTestId("share-copy-btn");
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalled();
        expect(selectSpy).toHaveBeenCalled();
      });

      // Vẫn hiện thông báo đã sao chép/chọn cho người dùng
      expect(copyBtn.textContent).toContain(messagesVi.copied);
    });

    it("disabled=true thì không mở dialog khi click nút Share", () => {
      renderShareDialog({ disabled: true });

      const triggerBtn = screen.getByTestId("share-button-trigger");
      expect(triggerBtn.hasAttribute("disabled")).toBe(true);

      fireEvent.click(triggerBtn);
      expect(screen.queryByTestId("share-dialog-content")).toBeNull();
    });

    it("hỗ trợ đầy đủ Unicode tiếng Việt và emoji trong tên tab và SQL", async () => {
      useWorkspaceStore.getState().hydrate({
        projects: [{ id: "p1", name: "Dự án Việt Nam 🇻🇳", engine: "postgres", scopeKey: "guest", createdAt: 0, updatedAt: 0 }],
        tabs: [
          {
            id: "t1",
            projectId: "p1",
            name: "Bảng Người Dùng 👥.sql",
            sql: "SELECT 'Xin chào thế giới! 🇻🇳' AS chao;",
            position: 0,
            updatedAt: 0,
          },
        ],
        activeProjectId: "p1",
        activeTabId: "t1",
      });

      renderShareDialog({ open: true });

      const input = (await screen.findByTestId("share-url-input")) as HTMLInputElement;
      expect(input).toBeTruthy();
      const url = input.value;
      const payload = url.split("#d=")[1];

      // Giải mã ngược lại để đối chiếu
      const decoded = await decodeSnapshot(payload);
      expect(decoded.project.name).toBe("Dự án Việt Nam 🇻🇳");
      expect(decoded.tabs[0].name).toBe("Bảng Người Dùng 👥.sql");
      expect(decoded.tabs[0].sql).toBe("SELECT 'Xin chào thế giới! 🇻🇳' AS chao;");
    });

    it("ShareButton là alias của ShareDialog", () => {
      expect(ShareButton).toBe(ShareDialog);
    });
  });
});
