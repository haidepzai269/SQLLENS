import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import messagesEn from "../../../../messages/en/workspace.json";
import messagesVi from "../../../../messages/vi/workspace.json";
import { NextIntlClientProvider } from "next-intl";
import { ProjectSwitcher } from "./project-switcher";
import { useWorkspaceStore } from "../store";
import type { WorkspaceEngine } from "../types";

afterEach(cleanup);

function renderSwitcher(locale: "vi" | "en" = "vi", defaultEngine?: WorkspaceEngine) {
  const messages = {
    workspace: locale === "vi" ? messagesVi : messagesEn,
  };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ProjectSwitcher defaultEngine={defaultEngine} />
    </NextIntlClientProvider>
  );
}

describe("ProjectSwitcher Component (Task127)", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  describe("Giao diện ban đầu & Mở/Đóng menu", () => {
    it("hiển thị tên dự án hiện tại và badge engine trên trigger", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Alpha Project", engine: "postgres" });

      renderSwitcher();

      const trigger = screen.getByTestId("project-switcher-trigger");
      expect(trigger).toBeTruthy();
      expect(trigger.textContent).toContain("Alpha Project");
      expect(trigger.textContent).toContain("PG");
    });

    it("mở menu khi click trigger và đóng khi click backdrop hoặc nhấn Escape", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Alpha Project", engine: "postgres" });

      renderSwitcher();

      const trigger = screen.getByTestId("project-switcher-trigger");
      expect(screen.queryByTestId("project-switcher-panel")).toBeNull();

      // Click trigger -> mở panel
      fireEvent.click(trigger);
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();

      // Nhấn Escape -> đóng panel
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("project-switcher-panel")).toBeNull();

      // Mở lại rồi click backdrop -> đóng panel
      fireEvent.click(trigger);
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();
      const backdrop = screen.getByTestId("project-switcher-backdrop");
      fireEvent.click(backdrop);
      expect(screen.queryByTestId("project-switcher-panel")).toBeNull();
    });

    it("mở menu khi nhấn phím ArrowDown hoặc Enter trên trigger", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Alpha Project", engine: "postgres" });

      renderSwitcher();

      const trigger = screen.getByTestId("project-switcher-trigger");
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("project-switcher-panel")).toBeNull();

      fireEvent.keyDown(trigger, { key: "Enter" });
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();
    });

    it("nhấn Space hoặc Enter trên các nút hành động con không bị phần tử cha nuốt", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "P1", engine: "postgres" });
      const p2 = store.createProject({ name: "P2", engine: "postgres" });
      store.setActiveProject(p1.id);

      renderSwitcher();
      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Nhấn Space trên nút đổi tên của P2
      const renameBtn = screen.getByTestId(`project-rename-btn-${p2.id}`);
      fireEvent.keyDown(renameBtn, { key: " " });

      // Menu vẫn mở, active project vẫn là P1 (không bị chọn P2 nhầm do nổi bọt sự kiện)
      expect(useWorkspaceStore.getState().activeProjectId).toBe(p1.id);
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();
    });

    it("Focus trap: vòng phím Tab từ phần tử cuối về đầu và Shift+Tab từ đầu về cuối", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "P1", engine: "postgres" });

      renderSwitcher();
      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      const panel = screen.getByTestId("project-switcher-panel");
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      expect(focusables.length).toBeGreaterThan(1);

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      // Focus vào phần tử cuối và nhấn Tab -> focus vòng về phần tử đầu
      last.focus();
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(first);

      // Focus vào phần tử đầu và nhấn Shift+Tab -> focus vòng về phần tử cuối
      first.focus();
      fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    });
  });

  describe("AC1: Tạo dự án mới", () => {
    it("tạo dự án mới với tên tùy ý, tự chọn dự án đó và cập nhật danh sách ngay", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Dự án cũ", engine: "postgres" });

      renderSwitcher();

      // Mở menu
      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Click nút thêm mới
      const newBtn = screen.getByTestId("project-new-button");
      fireEvent.click(newBtn);

      // Form tạo dự án hiển thị
      const input = screen.getByTestId("project-name-input");
      fireEvent.change(input, { target: { value: "Fintech App" } });

      // Click nút Tạo
      const saveBtn = screen.getByTestId("project-save-create");
      fireEvent.click(saveBtn);

      // Verify store
      const state = useWorkspaceStore.getState();
      expect(state.projects).toHaveLength(2);
      const newProj = state.projects.find((p) => p.name === "Fintech App");
      expect(newProj).toBeTruthy();
      expect(state.activeProjectId).toBe(newProj?.id);

      // Trigger hiển thị tên dự án mới
      expect(screen.getByTestId("project-switcher-trigger").textContent).toContain("Fintech App");
    });

    it("tạo dự án mới tự động tạo tab mặc định và activeTabId trỏ vào tab này", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "Dự án cũ", engine: "postgres" });
      const oldTab = store.createTab(p1.id, "Tab Cũ");
      expect(useWorkspaceStore.getState().activeTabId).toBe(oldTab.id);

      renderSwitcher();
      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId("project-new-button"));
      fireEvent.change(screen.getByTestId("project-name-input"), { target: { value: "Project Mới" } });
      fireEvent.click(screen.getByTestId("project-save-create"));

      const state = useWorkspaceStore.getState();
      const newProj = state.projects.find((p) => p.name === "Project Mới");
      expect(newProj).toBeTruthy();
      const newTabs = state.tabs.filter((t) => t.projectId === newProj?.id);
      expect(newTabs).toHaveLength(1);
      expect(state.activeTabId).toBe(newTabs[0].id);
      expect(state.activeTabId).not.toBe(oldTab.id);
    });

    it("tạo dự án mới kế thừa engine của dự án đang mở hoặc defaultEngine", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "MySQL Project", engine: "mysql" });

      renderSwitcher("vi", "mysql");

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId("project-new-button"));
      fireEvent.change(screen.getByTestId("project-name-input"), { target: { value: "New MySQL Project" } });
      fireEvent.click(screen.getByTestId("project-save-create"));

      const state = useWorkspaceStore.getState();
      const newProj = state.projects.find((p) => p.name === "New MySQL Project");
      expect(newProj).toBeTruthy();
      expect(newProj?.engine).toBe("mysql");
    });

    it("tạo dự án mới bằng phím Enter và fallback tên mặc định khi để trống", () => {
      renderSwitcher("vi");

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId("project-new-button"));

      const input = screen.getByTestId("project-name-input");
      // Để trống và nhấn Enter
      fireEvent.keyDown(input, { key: "Enter" });

      const state = useWorkspaceStore.getState();
      expect(state.projects).toHaveLength(1);
      expect(state.projects[0].name).toBe("Dự án chưa đặt tên");
      expect(state.activeProjectId).toBe(state.projects[0].id);
    });

    it("hủy tạo dự án bằng nút Hủy hoặc phím Escape không làm thay đổi store", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Dự án 1", engine: "postgres" });

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId("project-new-button"));

      const input = screen.getByTestId("project-name-input");
      fireEvent.change(input, { target: { value: "Bỏ dở" } });

      // Nhấn Escape trên input
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("project-create-form")).toBeNull();
      expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    });
  });

  describe("AC2: Đổi tên tại chỗ", () => {
    it("đổi tên tại chỗ khi nhấn Enter hoặc bấm nút Check", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Tên ban đầu", engine: "postgres" });

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Click nút đổi tên
      const renameBtn = screen.getByTestId(`project-rename-btn-${p.id}`);
      fireEvent.click(renameBtn);

      // Input đổi tên hiển thị
      const input = screen.getByTestId(`project-rename-input-${p.id}`);
      expect((input as HTMLInputElement).value).toBe("Tên ban đầu");

      fireEvent.change(input, { target: { value: "Tên đã sửa" } });
      fireEvent.keyDown(input, { key: "Enter" });

      // Store cập nhật
      expect(useWorkspaceStore.getState().projects.find((item) => item.id === p.id)?.name).toBe("Tên đã sửa");
      // Form edit đóng
      expect(screen.queryByTestId(`project-rename-form-${p.id}`)).toBeNull();
    });

    it("Esc hủy đổi tên, giữ nguyên tên cũ", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Tên chuẩn", engine: "postgres" });

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId(`project-rename-btn-${p.id}`));

      const input = screen.getByTestId(`project-rename-input-${p.id}`);
      fireEvent.change(input, { target: { value: "Gõ linh tinh" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(useWorkspaceStore.getState().projects.find((item) => item.id === p.id)?.name).toBe("Tên chuẩn");
      expect(screen.queryByTestId(`project-rename-form-${p.id}`)).toBeNull();
      // Esc chỉ hủy đổi tên: danh sách dự án vẫn mở, không bị listener toàn cục đóng luôn.
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();
    });

    it("tên rỗng hoặc toàn khoảng trắng thì giữ nguyên tên cũ", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Tên gốc", engine: "postgres" });

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId(`project-rename-btn-${p.id}`));

      const input = screen.getByTestId(`project-rename-input-${p.id}`);
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(useWorkspaceStore.getState().projects.find((item) => item.id === p.id)?.name).toBe("Tên gốc");
    });

    it("Esc trong ô tạo dự án chỉ hủy form, không đóng danh sách dự án", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "P1", engine: "postgres" });

      renderSwitcher();
      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId("project-new-button"));

      const input = screen.getByTestId("project-name-input");
      fireEvent.change(input, { target: { value: "Dở dang" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByTestId("project-create-form")).toBeNull();
      expect(screen.getByTestId("project-switcher-panel")).toBeTruthy();
    });
  });

  describe("AC3: Nhân bản dự án", () => {
    it("nhân bản chép đủ tabs và nội dung, tự kích hoạt dự án mới kèm suffix ngôn ngữ", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Kho hàng", engine: "postgres" });
      const t1 = store.createTab(p.id, "Tab 1");
      store.updateTabSql(t1.id, "SELECT * FROM inventory;");
      const t2 = store.createTab(p.id, "Tab 2");
      store.updateTabSql(t2.id, "SELECT * FROM suppliers;");

      renderSwitcher("vi");

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Click nút nhân bản
      const dupBtn = screen.getByTestId(`project-duplicate-btn-${p.id}`);
      fireEvent.click(dupBtn);

      const state = useWorkspaceStore.getState();
      expect(state.projects).toHaveLength(2);

      const dupProj = state.projects.find((item) => item.id !== p.id);
      expect(dupProj).toBeTruthy();
      expect(dupProj?.name).toBe("Kho hàng (bản sao)");
      expect(state.activeProjectId).toBe(dupProj?.id);

      // Verify các tab của dự án mới
      const dupTabs = state.tabs.filter((t) => t.projectId === dupProj?.id);
      expect(dupTabs).toHaveLength(2);
      expect(dupTabs[0].sql).toBe("SELECT * FROM inventory;");
      expect(dupTabs[1].sql).toBe("SELECT * FROM suppliers;");
      expect(dupTabs[0].id).not.toBe(t1.id);
      expect(dupTabs[1].id).not.toBe(t2.id);

      // Trigger cập nhật tên dự án mới
      expect(screen.getByTestId("project-switcher-trigger").textContent).toContain("Kho hàng (bản sao)");
    });
  });

  describe("AC4: Xóa dự án (xác nhận 2 bước & chuyển dự án)", () => {
    it("bước 1 hiển thị xác nhận, bấm hủy thì không xóa", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "Project Delete Test", engine: "postgres" });

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Bước 1: Bấm nút thùng rác
      const deleteBtn = screen.getByTestId(`project-delete-btn-${p.id}`);
      fireEvent.click(deleteBtn);

      // Hiển thị khung xác nhận
      expect(screen.getByTestId(`project-delete-confirm-${p.id}`)).toBeTruthy();

      // Bấm hủy
      const cancelBtn = screen.getByTestId(`project-cancel-delete-${p.id}`);
      fireEvent.click(cancelBtn);

      // Khung xác nhận biến mất, project vẫn còn
      expect(screen.queryByTestId(`project-delete-confirm-${p.id}`)).toBeNull();
      expect(useWorkspaceStore.getState().projects).toHaveLength(1);
    });

    it("bước 2 xác nhận xóa: xóa project và tabs, tự động chuyển sang project khác nếu đang active", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "P1", engine: "postgres" });
      const p2 = store.createProject({ name: "P2", engine: "mysql" });
      store.createTab(p1.id, "Tab P1");
      store.createTab(p2.id, "Tab P2");

      // Đang active P1
      store.setActiveProject(p1.id);

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Bấm nút xóa P1
      fireEvent.click(screen.getByTestId(`project-delete-btn-${p1.id}`));

      // Bấm nút xác nhận xóa
      const confirmBtn = screen.getByTestId(`project-confirm-delete-${p1.id}`);
      fireEvent.click(confirmBtn);

      const state = useWorkspaceStore.getState();
      expect(state.projects).toHaveLength(1);
      expect(state.projects[0].id).toBe(p2.id);
      // Tự động chuyển sang P2, không bị trắng màn hình
      expect(state.activeProjectId).toBe(p2.id);

      // Tabs của P1 đã bị xóa sạch khỏi store
      expect(state.tabs.some((t) => t.projectId === p1.id)).toBe(false);
      expect(state.tabs.some((t) => t.projectId === p2.id)).toBe(true);
    });
  });

  describe("AC5: Engine & Thời gian sửa cuối", () => {
    it("hiển thị nhãn engine và thời gian sửa theo định dạng ngôn ngữ", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Postgres Proj", engine: "postgres" });
      store.createProject({ name: "MySQL Proj", engine: "mysql" });

      renderSwitcher("vi");

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      const panel = screen.getByTestId("project-switcher-panel");
      expect(panel.textContent).toContain("PG");
      expect(panel.textContent).toContain("MySQL");
      expect(panel.textContent).toContain("Sửa ");
    });
  });

  describe("AC6: Đủ vi/en & Responsive", () => {
    it("hỗ trợ hoàn chỉnh tiếng Anh", () => {
      const store = useWorkspaceStore.getState();
      store.createProject({ name: "Main DB", engine: "postgres" });

      renderSwitcher("en");

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      const panel = screen.getByTestId("project-switcher-panel");
      expect(panel.textContent).toContain("Project");
      expect(panel.textContent).toContain("New project");
      expect(panel.textContent).toContain("Updated ");
    });

    it("chuyển đổi active project khi click vào item trong danh sách", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "P1", engine: "postgres" });
      const p2 = store.createProject({ name: "P2", engine: "postgres" });

      store.setActiveProject(p1.id);
      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Click vào item p2
      const item2 = screen.getByTestId(`project-item-${p2.id}`);
      fireEvent.click(item2);

      expect(useWorkspaceStore.getState().activeProjectId).toBe(p2.id);
      expect(screen.queryByTestId("project-switcher-panel")).toBeNull();
    });

    it("trạng thái rỗng hiển thị thông báo và nút CTA tạo dự án", () => {
      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      expect(screen.getByText("Chưa có dự án nào")).toBeTruthy();
      const ctaBtn = screen.getByTestId("project-empty-cta");
      expect(ctaBtn).toBeTruthy();

      fireEvent.click(ctaBtn);
      expect(screen.getByTestId("project-create-form")).toBeTruthy();
    });
  });

  describe("Ca biên (Edge cases)", () => {
    it("30 dự án: hiển thị danh sách đầy đủ không lỗi", () => {
      const store = useWorkspaceStore.getState();
      for (let i = 1; i <= 30; i++) {
        store.createProject({ name: `Project ${i}`, engine: "postgres" });
      }

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      const panel = screen.getByTestId("project-switcher-panel");
      for (let i = 1; i <= 30; i++) {
        expect(panel.textContent).toContain(`Project ${i}`);
      }
    });

    it("các dự án có tên trùng nhau vẫn phân biệt chính xác theo id", () => {
      const store = useWorkspaceStore.getState();
      const p1 = store.createProject({ name: "Duplicate Name", engine: "postgres" });
      const p2 = store.createProject({ name: "Duplicate Name", engine: "postgres" });

      store.setActiveProject(p1.id);
      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));

      // Chọn p2
      fireEvent.click(screen.getByTestId(`project-item-${p2.id}`));
      expect(useWorkspaceStore.getState().activeProjectId).toBe(p2.id);
    });

    it("nhân bản dự án có 100 tabs giữ đúng 100 tabs với id mới", () => {
      const store = useWorkspaceStore.getState();
      const p = store.createProject({ name: "100 Tabs Project", engine: "postgres" });
      for (let i = 0; i < 100; i++) {
        store.createTab(p.id, `Tab ${i}`);
      }

      renderSwitcher();

      fireEvent.click(screen.getByTestId("project-switcher-trigger"));
      fireEvent.click(screen.getByTestId(`project-duplicate-btn-${p.id}`));

      const state = useWorkspaceStore.getState();
      expect(state.projects).toHaveLength(2);
      const dupProj = state.projects.find((item) => item.id !== p.id);
      expect(dupProj).toBeTruthy();

      const dupTabs = state.tabs.filter((t) => t.projectId === dupProj?.id);
      expect(dupTabs).toHaveLength(100);
      expect(dupTabs.map((t) => t.position)).toEqual([...Array(100).keys()]);
    });
  });
});
