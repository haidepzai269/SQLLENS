import { setRequestLocale } from "next-intl/server";
import { RoomHarness } from "./harness";

// Route thử cho Playwright (Task162): chỉ dựng InviteDialog với một dự án đã gắn cloud, để kiểm
// giao diện mà không phải chạy PGlite. Phải chặn trước khi phát hành, cùng nhóm `e2e-*`.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <RoomHarness />;
}
