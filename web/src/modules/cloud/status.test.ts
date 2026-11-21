// Test hàm thuần tính trạng thái cloud (Task154). Không IndexedDB, không mạng, không đồng hồ.

import { describe, expect, it } from "vitest";
import type { WorkspaceProject, WorkspaceTab } from "@/modules/workspace/types";
import { projectCloudState, projectStamp, projectTabs } from "./status";

const project: WorkspaceProject = {
  id: "p1",
  scopeKey: "guest",
  name: "Alpha",
  engine: "postgres",
  createdAt: 1,
  updatedAt: 1,
};

function tab(id: string, position: number, sql: string, name = `${id}.sql`): WorkspaceTab {
  return { id, projectId: "p1", name, sql, position, updatedAt: 1 };
}

const tabs = [tab("b", 1, "SELECT 2"), tab("a", 0, "SELECT 1")];

describe("projectStamp", () => {
  it("không phụ thuộc thứ tự phần tử trong mảng, chỉ phụ thuộc nội dung theo vị trí", () => {
    const reversed = [tabs[1], tabs[0]];
    expect(projectStamp(project, tabs)).toBe(projectStamp(project, reversed));
  });

  it("đổi SQL, tên tab, tên dự án hay engine đều đổi dấu", () => {
    const base = projectStamp(project, tabs);
    expect(projectStamp(project, [tab("a", 0, "SELECT 1;"), tab("b", 1, "SELECT 2")])).not.toBe(base);
    expect(projectStamp(project, [tab("a", 0, "SELECT 1", "khác.sql"), tab("b", 1, "SELECT 2")])).not.toBe(base);
    expect(projectStamp({ ...project, name: "Beta" }, tabs)).not.toBe(base);
    expect(projectStamp({ ...project, engine: "mysql" }, tabs)).not.toBe(base);
  });

  it("đổi thứ tự tab đổi dấu dù nội dung từng tab y nguyên", () => {
    const swapped = [tab("a", 1, "SELECT 1"), tab("b", 0, "SELECT 2")];
    expect(projectStamp(project, swapped)).not.toBe(projectStamp(project, tabs));
  });

  it("dự án không có tab vẫn có dấu ổn định", () => {
    expect(projectStamp(project, [])).toMatch(/^[0-9a-f]{8}$/);
    expect(projectStamp(project, [])).toBe(projectStamp(project, []));
  });
});

describe("projectCloudState", () => {
  it("chưa có liên kết cloud là `local`", () => {
    expect(projectCloudState(project, tabs)).toBe("local");
  });

  it("dấu khớp nội dung hiện tại là `synced`", () => {
    const linked: WorkspaceProject = {
      ...project,
      cloud: { remoteId: "r1", remoteUpdatedAt: "2026-11-21T10:00:00Z", stamp: projectStamp(project, tabs) },
    };
    expect(projectCloudState(linked, tabs)).toBe("synced");
  });

  it("nội dung khác dấu là `modified`", () => {
    const linked: WorkspaceProject = {
      ...project,
      cloud: { remoteId: "r1", remoteUpdatedAt: "2026-11-21T10:00:00Z", stamp: "00000000" },
    };
    expect(projectCloudState(linked, tabs)).toBe("modified");
  });

  it("bản ghi cũ chưa có dấu thì coi như `synced` cho tới lần lưu sau", () => {
    const legacy: WorkspaceProject = {
      ...project,
      cloud: { remoteId: "r1", remoteUpdatedAt: "2026-11-21T10:00:00Z" },
    };
    expect(projectCloudState(legacy, tabs)).toBe("synced");
  });

  it("chỉ tính tab của đúng dự án", () => {
    const other: WorkspaceTab = { ...tab("x", 0, "SELECT 9"), projectId: "p2" };
    const linked: WorkspaceProject = {
      ...project,
      cloud: { remoteId: "r1", remoteUpdatedAt: "2026-11-21T10:00:00Z", stamp: projectStamp(project, tabs) },
    };
    expect(projectCloudState(linked, [...tabs, other])).toBe("synced");
  });
});

describe("projectTabs", () => {
  it("lọc theo dự án và sắp theo vị trí", () => {
    const other: WorkspaceTab = { ...tab("x", 0, "SELECT 9"), projectId: "p2" };
    expect(projectTabs([...tabs, other], "p1").map((t) => t.id)).toEqual(["a", "b"]);
  });
});
