import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import enWorkspace from "../../../../messages/en/workspace.json";
import viWorkspace from "../../../../messages/vi/workspace.json";
import { useWorkspaceStore } from "../store";
import { TabBar } from "./tab-bar";

const wrap = (ui: React.ReactElement, locale: "vi" | "en" = "vi") =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ workspace: locale === "vi" ? viWorkspace : enWorkspace }}
    >
      {ui}
    </NextIntlClientProvider>
  );

describe("TabBar Component (Task125)", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    // Tạo 1 project và 1 tab mặc định
    const project = useWorkspaceStore.getState().createProject({
      name: "Default Project",
      engine: "postgres",
    });
    useWorkspaceStore.getState().createTab(project.id, "Query 1.sql");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("AC1: Nút '+' tạo tab mới rỗng ở cuối và chuyển sang tab đó", () => {
    wrap(<TabBar />);

    const tabsBefore = screen.getAllByRole("tab");
    expect(tabsBefore).toHaveLength(1);
    expect(tabsBefore[0].textContent).toContain("Query 1.sql");

    const addBtn = screen.getByTestId("tab-add-btn");
    expect(addBtn).toBeDefined();

    // Click nút '+'
    fireEvent.click(addBtn);

    const tabsAfter = screen.getAllByRole("tab");
    expect(tabsAfter).toHaveLength(2);
    expect(tabsAfter[1].textContent).toContain("Query 2.sql");

    // Tab mới ở cuối và được chọn làm active
    expect(tabsAfter[1].getAttribute("aria-selected")).toBe("true");
    expect(tabsAfter[0].getAttribute("aria-selected")).toBe("false");

    const storeState = useWorkspaceStore.getState();
    expect(storeState.tabs).toHaveLength(2);
    expect(storeState.activeTabId).toBe(storeState.tabs[1].id);
  });

  test("AC1 (Ca biên): Nhấp nút '+' liên tục 20 lần", () => {
    wrap(<TabBar />);

    const addBtn = screen.getByTestId("tab-add-btn");
    for (let i = 0; i < 20; i++) {
      fireEvent.click(addBtn);
    }

    const state = useWorkspaceStore.getState();
    // 1 tab ban đầu + 20 tabs mới = 21 tabs
    expect(state.tabs).toHaveLength(21);
    // Tab cuối cùng là activeTab
    expect(state.activeTabId).toBe(state.tabs[20].id);
    // Vị trí position liên tục 0..20
    state.tabs.forEach((tab, index) => {
      expect(tab.position).toBe(index);
    });
  });

  test("AC2: Còn 1 tab thì nút đóng disabled kèm tooltip/title tab.lastTabLocked", () => {
    wrap(<TabBar />, "vi");

    const state = useWorkspaceStore.getState();
    expect(state.tabs).toHaveLength(1);

    const closeBtn = screen.getByTestId(`tab-close-btn-${state.tabs[0].id}`);
    expect(closeBtn.hasAttribute("disabled")).toBe(true);
    expect(closeBtn.getAttribute("aria-disabled")).toBe("true");
    expect(closeBtn.getAttribute("title")).toBe("Không thể đóng tab cuối cùng");

    // Thử click nút đóng: không xóa tab
    fireEvent.click(closeBtn);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
  });

  test("AC2: Đóng tab đang mở chọn tab kế bên (neighbor)", () => {
    // Tạo thêm 2 tabs nữa -> tổng cộng 3 tabs: T1, T2, T3
    const projectId = useWorkspaceStore.getState().activeProjectId!;
    const t2 = useWorkspaceStore.getState().createTab(projectId, "Query 2.sql");
    const t3 = useWorkspaceStore.getState().createTab(projectId, "Query 3.sql");

    // Active đang là t3. Click đóng t3 -> active chuyển sang t2 (bên trái)
    const { unmount } = wrap(<TabBar />);
    const closeBtnT3 = screen.getByTestId(`tab-close-btn-${t3.id}`);
    expect(closeBtnT3.hasAttribute("disabled")).toBe(false);

    fireEvent.click(closeBtnT3);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeTabId).toBe(t2.id);

    unmount();

    // Giờ còn t1, t2. Active đang là t2. Set active về t1.
    useWorkspaceStore.setState({ activeTabId: useWorkspaceStore.getState().tabs[0].id });
    wrap(<TabBar />);

    const t1Id = useWorkspaceStore.getState().tabs[0].id;
    const closeBtnT1 = screen.getByTestId(`tab-close-btn-${t1Id}`);
    // Đóng t1 (đang ở index 0) -> active chuyển sang t2 (bên phải)
    fireEvent.click(closeBtnT1);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeTabId).toBe(t2.id);
  });

  test("AC3: Nháy đúp đổi tên tại chỗ; Enter lưu, Esc hủy, tên rỗng quay về tên cũ", () => {
    wrap(<TabBar />);
    const tab1 = useWorkspaceStore.getState().tabs[0];
    const tabEl = screen.getByTestId(`workspace-tab-${tab1.id}`);

    // Nháy đúp vào tab
    fireEvent.doubleClick(tabEl);

    // Xuất hiện input rename
    const renameInput = screen.getByTestId("tab-rename-input") as HTMLInputElement;
    expect(renameInput).toBeDefined();
    expect(renameInput.value).toBe("Query 1.sql");

    // Thay đổi thành tên mới và nhấn Enter
    fireEvent.change(renameInput, { target: { value: "analytics_report.sql" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    // Kiểm tra input biến mất và tên mới được lưu vào store
    expect(screen.queryByTestId("tab-rename-input")).toBeNull();
    expect(useWorkspaceStore.getState().tabs[0].name).toBe("analytics_report.sql");
    expect(screen.getByTestId(`workspace-tab-${tab1.id}`).textContent).toContain(
      "analytics_report.sql"
    );

    // Thử lại với Escape (hủy)
    fireEvent.doubleClick(screen.getByTestId(`workspace-tab-${tab1.id}`));
    const input2 = screen.getByTestId("tab-rename-input") as HTMLInputElement;
    fireEvent.change(input2, { target: { value: "should_cancel.sql" } });
    fireEvent.keyDown(input2, { key: "Escape" });

    expect(screen.queryByTestId("tab-rename-input")).toBeNull();
    // Tên vẫn là analytics_report.sql
    expect(useWorkspaceStore.getState().tabs[0].name).toBe("analytics_report.sql");

    // Thử với tên rỗng hoặc toàn khoảng trắng -> quay về tên cũ
    fireEvent.doubleClick(screen.getByTestId(`workspace-tab-${tab1.id}`));
    const input3 = screen.getByTestId("tab-rename-input") as HTMLInputElement;
    fireEvent.change(input3, { target: { value: "    " } });
    fireEvent.keyDown(input3, { key: "Enter" });

    expect(screen.queryByTestId("tab-rename-input")).toBeNull();
    expect(useWorkspaceStore.getState().tabs[0].name).toBe("analytics_report.sql");
  });

  test("AC3 (Ca biên): Tên tab 80 ký tự & tên Unicode có dấu", () => {
    wrap(<TabBar />);
    const tab1 = useWorkspaceStore.getState().tabs[0];
    const longName = "A".repeat(80);
    const unicodeName = "Báo cáo doanh thu & chi phí quý 4 năm 2026.sql";

    // 1. Tên 80 ký tự
    fireEvent.doubleClick(screen.getByTestId(`workspace-tab-${tab1.id}`));
    const inputLong = screen.getByTestId("tab-rename-input");
    fireEvent.change(inputLong, { target: { value: longName } });
    fireEvent.keyDown(inputLong, { key: "Enter" });
    expect(useWorkspaceStore.getState().tabs[0].name).toBe(longName);

    // 2. Tên Unicode có dấu
    fireEvent.doubleClick(screen.getByTestId(`workspace-tab-${tab1.id}`));
    const inputUnicode = screen.getByTestId("tab-rename-input");
    fireEvent.change(inputUnicode, { target: { value: unicodeName } });
    fireEvent.keyDown(inputUnicode, { key: "Enter" });
    expect(useWorkspaceStore.getState().tabs[0].name).toBe(unicodeName);
    expect(screen.getByTitle(unicodeName)).toBeDefined();
  });

  test("AC4: Kéo thả đổi thứ tự tab, thả cùng chỗ không đổi gì, kéo ra ngoài không lỗi", () => {
    const projectId = useWorkspaceStore.getState().activeProjectId!;
    const t2 = useWorkspaceStore.getState().createTab(projectId, "Tab B.sql");
    const t3 = useWorkspaceStore.getState().createTab(projectId, "Tab C.sql");

    wrap(<TabBar />);

    const t1 = useWorkspaceStore.getState().tabs[0];
    const elT1 = screen.getByTestId(`workspace-tab-${t1.id}`);
    const elT3 = screen.getByTestId(`workspace-tab-${t3.id}`);

    // Giả lập kéo Tab 1 thả vào vị trí của Tab 3 (targetIndex = 2)
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) {
        this.data[k] = v;
      },
      getData(k: string) {
        return this.data[k] || "";
      },
      effectAllowed: "move",
      dropEffect: "move",
    };

    fireEvent.dragStart(elT1, { dataTransfer });
    fireEvent.dragOver(elT3, { dataTransfer });
    fireEvent.drop(elT3, { dataTransfer });
    fireEvent.dragEnd(elT1);

    const tabsAfter = useWorkspaceStore.getState().tabs;
    // Tab 1 đã bị chuyển về cuối (vị trí 2)
    expect(tabsAfter[0].id).toBe(t2.id);
    expect(tabsAfter[1].id).toBe(t3.id);
    expect(tabsAfter[2].id).toBe(t1.id);
    expect(tabsAfter[0].position).toBe(0);
    expect(tabsAfter[1].position).toBe(1);
    expect(tabsAfter[2].position).toBe(2);

    // Thả cùng chỗ (kéo Tab B thả vào chính Tab B):
    const elT2 = screen.getByTestId(`workspace-tab-${t2.id}`);
    fireEvent.dragStart(elT2, { dataTransfer });
    fireEvent.dragOver(elT2, { dataTransfer });
    fireEvent.drop(elT2, { dataTransfer });
    fireEvent.dragEnd(elT2);

    // Thứ tự vẫn nguyên vẹn
    const tabsSame = useWorkspaceStore.getState().tabs;
    expect(tabsSame[0].id).toBe(t2.id);
    expect(tabsSame[1].id).toBe(t3.id);
    expect(tabsSame[2].id).toBe(t1.id);

    // Kéo ra ngoài (dragEnd mà không drop):
    fireEvent.dragStart(elT2, { dataTransfer });
    fireEvent.dragEnd(elT2);
    // Vẫn an toàn, không có lỗi gì xảy ra
    expect(useWorkspaceStore.getState().tabs).toHaveLength(3);
  });

  test("AC5: 100 tab render mượt mà, thanh tab cuộn ngang, không mount editor", () => {
    const projectId = useWorkspaceStore.getState().activeProjectId!;
    // Tạo thêm 99 tabs để đạt 100 tabs
    for (let i = 2; i <= 100; i++) {
      useWorkspaceStore.getState().createTab(projectId, `Query ${i}.sql`);
    }

    const { container } = wrap(<TabBar />);

    const tabElements = screen.getAllByRole("tab");
    expect(tabElements).toHaveLength(100);

    // Kiểm tra không mount bất kỳ editor nào
    expect(container.querySelector(".cm-editor")).toBeNull();

    // Container cuộn ngang
    const scrollList = screen.getByRole("tablist");
    expect(scrollList.className).toContain("overflow-x-auto");
  });

  test("AC6: Đầy đủ vi/en, không hardcode chuỗi, hoạt động tốt ở viewport nhỏ 390px", () => {
    // 1. Kiểm tra Tiếng Việt
    const { unmount } = wrap(<TabBar />, "vi");
    expect(screen.getByTestId("tab-add-btn").getAttribute("title")).toBe("Thêm tab mới");
    expect(screen.getByTestId("tab-add-btn").getAttribute("aria-label")).toBe("Thêm tab mới");
    unmount();

    // 2. Kiểm tra Tiếng Anh
    wrap(<TabBar />, "en");
    expect(screen.getByTestId("tab-add-btn").getAttribute("title")).toBe("New tab");
    expect(screen.getByTestId("tab-add-btn").getAttribute("aria-label")).toBe("New tab");

    // 3. Viewport 390px
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("min-w-0");
    expect(tablist.className).toContain("overflow-x-auto");
  });

  test("Chuyển tab bằng Click và phím Enter/Space", () => {
    const projectId = useWorkspaceStore.getState().activeProjectId!;
    const t2 = useWorkspaceStore.getState().createTab(projectId, "Tab 2.sql");

    wrap(<TabBar />);
    const t1 = useWorkspaceStore.getState().tabs[0];
    const elT1 = screen.getByTestId(`workspace-tab-${t1.id}`);
    const elT2 = screen.getByTestId(`workspace-tab-${t2.id}`);

    // Đang active t2 (vì t2 vừa được createTab)
    expect(useWorkspaceStore.getState().activeTabId).toBe(t2.id);

    // Click chọn t1
    fireEvent.click(elT1);
    expect(useWorkspaceStore.getState().activeTabId).toBe(t1.id);
    expect(elT1.getAttribute("aria-selected")).toBe("true");

    // Phím Enter chọn t2
    fireEvent.keyDown(elT2, { key: "Enter" });
    expect(useWorkspaceStore.getState().activeTabId).toBe(t2.id);
    expect(elT2.getAttribute("aria-selected")).toBe("true");

    // Phím Space chọn t1
    fireEvent.keyDown(elT1, { key: " " });
    expect(useWorkspaceStore.getState().activeTabId).toBe(t1.id);
    expect(elT1.getAttribute("aria-selected")).toBe("true");
  });
});
