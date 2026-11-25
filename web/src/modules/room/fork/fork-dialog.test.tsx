import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viShare from "../../../../messages/vi/share.json";
import enShare from "../../../../messages/en/share.json";
import { openWorkspaceDb } from "@/modules/workspace/db";
import { getRepository } from "@/modules/workspace/repository";
import { ROOM_FORK_MAX_ACTIVE, ROOM_FORK_MAX_BYTES, type RoomForkInput } from "./room-fork";
import { ForkDialog } from "./fork-dialog";

let factory: IDBFactory;

function makeRoom(overrides: Partial<RoomForkInput> = {}): RoomForkInput {
  return {
    projectId: "room-1",
    projectName: "Phòng test",
    engine: "postgres",
    tabs: [
      { name: "01.sql", sql: "SELECT 1;" },
      { name: "02.sql", sql: "SELECT 2;" },
    ],
    ...overrides,
  };
}

function renderDialog(
  locale: "vi" | "en",
  props: Partial<React.ComponentProps<typeof ForkDialog>> = {},
) {
  const messages = locale === "vi" ? { share: viShare } : { share: enShare };
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ForkDialog
        room={makeRoom()}
        open={true}
        forkOptions={{
          factory,
          fetchImpl: (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
        }}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

async function seedForks(count: number, scopeKey = "guest") {
  const db = await openWorkspaceDb(factory);
  const repo = getRepository(db);
  for (let i = 0; i < count; i++) {
    await repo.upsertProject({
      id: `seeded-fork-${i}`,
      scopeKey,
      name: `Fork ${i}`,
      engine: "postgres",
      createdAt: i + 1,
      updatedAt: i + 1,
      roomFork: { projectId: "room-1", forkedAt: i + 1 },
    });
  }
  db.close();
}

beforeEach(() => {
  factory = new IDBFactory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ForkDialog (Task167)", () => {
  it("hiển thị số lượng fork hiện tại N/5 và thực hiện fork thành công", async () => {
    await seedForks(2);
    const onForked = vi.fn();
    renderDialog("vi", { onForked });

    await waitFor(() => {
      expect(screen.getByTestId("fork-active-count").textContent).toContain("2/5");
    });

    const btn = screen.getByTestId("fork-confirm-button");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(onForked).toHaveBeenCalledTimes(1);
    });
    expect(onForked.mock.calls[0][0].tabs).toBe(2);
    expect(onForked.mock.calls[0][0].activeForks).toBe(3);
  });

  it("AC2: khi đủ 5 fork, nút Fork bị disabled và hiện thông báo cả vi lẫn en", async () => {
    await seedForks(ROOM_FORK_MAX_ACTIVE);

    renderDialog("vi");
    await waitFor(() => {
      expect(screen.getByTestId("fork-active-count").textContent).toContain("5/5");
    });
    expect((screen.getByTestId("fork-confirm-button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("fork-limit-alert").textContent).toContain("5/5");

    cleanup();
    renderDialog("en");
    await waitFor(() => {
      expect(screen.getByTestId("fork-active-count").textContent).toContain("5/5");
    });
    expect((screen.getByTestId("fork-confirm-button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("fork-limit-alert").textContent).toContain("maximum of 5");
  });

  it("AC4: hiển thị số byte thật và tên tab vi phạm khi vượt 512 KB", async () => {
    const bigSql = "X".repeat(ROOM_FORK_MAX_BYTES + 123);
    renderDialog("vi", {
      room: makeRoom({
        tabs: [
          { name: "ok.sql", sql: "SELECT 1;" },
          { name: "oversized_tab.sql", sql: bigSql },
        ],
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("fork-active-count").textContent).toContain("0/5");
    });

    fireEvent.click(screen.getByTestId("fork-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("fork-error-alert")).toBeDefined();
    });
    const alertText = screen.getByTestId("fork-error-alert").textContent ?? "";
    expect(alertText).toContain("oversized_tab.sql");
    // Chứa số byte thật (> 524288)
    const match = alertText.match(/(\d+)\s*byte/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(ROOM_FORK_MAX_BYTES);
  });
});
