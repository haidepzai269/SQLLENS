# Bàn giao Task167

Đã làm: Hoàn thành tính năng Fork phòng cộng tác sang Local Sandbox với hai trần độc lập (`ROOM_FORK_MAX_BYTES = 512 * 1024` đo theo byte UTF-8 thật và `ROOM_FORK_MAX_ACTIVE = 5` qua trường `roomFork?` trên `WorkspaceProject`, giữ nguyên `CURRENT_DB_VERSION = 1`). Triển khai `checkForkSize`, `countActiveForks`, `forkRoomToWorkspace`, hộp thoại `<ForkDialog />` song ngữ vi/en (hiện `N/5`, khóa nút khi đủ 5, báo byte thật + tên tab vi phạm khi vượt 512 KB, responsive 390px), mở rộng `ForkErrorCode` trong `share/fork.ts`, và bổ sung harness `/[locale]/e2e-fork` cùng bộ test Playwright `room-fork.spec.ts`.

File chính:
- `web/src/modules/workspace/types.ts`
- `web/src/modules/share/fork.ts`
- `web/src/modules/share/components/readonly-workspace.tsx`
- `web/src/modules/room/fork/room-fork.ts`, `room-fork.test.ts`, `fork-dialog.tsx`, `fork-dialog.test.tsx`
- `web/messages/vi/share.json`, `web/messages/en/share.json`
- `web/src/app/[locale]/e2e-fork/page.tsx`, `harness.tsx`, `web/e2e/room-fork.spec.ts`

Kết quả kiểm tra:
- `npm run check:i18n`, `npm run lint` (0 lỗi), `npm run typecheck`: PASS 100%.
- Unit test: `room-fork.test.ts` (6/6), `fork-dialog.test.tsx` (3/3), `fork.test.ts` (13/13) PASS 100%; các file `share/` và `workspace/` liên quan PASS khi chạy không bị tranh CPU.
- `API_ORIGIN=http://127.0.0.1:8080 npm run build`: biên dịch & tạo 78/78 static pages (Next.js 16.4.4 báo `SecurityFatalError` khuyến nghị nâng cấp ở cuối bước build; reviewer chạy lại đạt PASS 78/78).
- `E2E_PORT=3167 npx playwright test e2e/room-fork.spec.ts`: **4/4 PASS** (AC1–AC6, đúng 1 request `/api/me`, 0 byte SQL gửi lên mạng, 390x844 không tràn ngang).

Kết quả review: `reviewer-167` nghiệm thu độc lập **PASS 100%** (0 lỗi, xác nhận giữ nguyên `CURRENT_DB_VERSION = 1`, `roomFork?` không rò vào `projectStamp` và `CloudProjectPayload`, 4/4 E2E PASS trên Chrome thật).

Chưa làm được: Chưa kiểm tra trực tiếp trên bản deploy production thật (nhãn **Chưa đo**; logic chặn `e2e-fork` khi `VERCEL_ENV === "production"` đã đối chiếu trong `web/src/lib/e2e-route-guard.ts`).

Phát sinh: Không có.

Việc tiếp theo cần biết: `ForkDialog` nhận prop `scope?` tùy chọn để đếm `N/5` cục bộ mà không gọi thêm `/api/me` khi mở hộp thoại; khi tích hợp vào thanh công cụ phòng ở các task sau chỉ cần truyền `room` (từ tab hiện tại) và `scope` đang có.
