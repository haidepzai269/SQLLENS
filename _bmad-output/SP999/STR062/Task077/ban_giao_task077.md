# Bàn giao Task077: Làm CI e2e xanh ổn định

Thuộc: SP999 / STR062
Người làm: Amelia
Reviewer: task-reviewer (ID: 9566e95c)

Đã làm:
- Sửa race condition hydrate ở E2E test: thêm thuộc tính `data-hydrated` tại `ShellProvider` và helper `gotoHydrated`, `reloadHydrated` để đảm bảo tương tác sau khi React đã hydrate xong.
- Sửa đo animation thanh chia cột: thay lấy mẫu rAF dễ trượt mẫu trên máy chậm bằng lắng nghe sự kiện `transitionrun` và `transitionend`.
- Sửa lỗi đọc Blob của Chromium lúc bộ nhớ cao: ghép mảng `Uint8Array` trực tiếp trong worker PGlite thay vì tạo `Blob`, kèm cơ chế tự phục hồi retry 1 lần tại `adapter.ts`.
- Bổ sung `retries: 1` trên CI và reporter `flaky-reporter.ts` để cảnh báo các test flaky qua GitHub Actions annotations.

File chính:
- `web/src/components/shell/shell-provider.tsx`
- `web/src/engines/postgres/adapter.ts`
- `web/src/engines/postgres/worker.ts`
- `web/e2e/helpers.ts`
- `web/e2e/flaky-reporter.ts`
- `web/e2e/conflict.spec.ts`
- `web/e2e/shell-polish.spec.ts`
- `web/e2e/shell.spec.ts`
- `web/e2e/sql-intake.spec.ts`
- `web/playwright.config.ts`

Kết quả kiểm tra:
- `npm run check`: Thoát 0 (i18n sạch, lint 0 lỗi, typecheck sạch, 484 unit test đạt).
- `npm run build`: Thoát 0 (Next.js 16 build thành công).
- `E2E_PORT=3177 npx playwright test e2e/conflict.spec.ts --workers=1` với `CPU_THROTTLE=4`: Đạt 30/30 test.

Kết quả review:
- Đã sửa 2 cảnh báo lint được reviewer báo (toán tử dấu phẩy trong `worker.ts` và biến `t` chưa dùng trong `shell-polish.spec.ts`).
- Reviewer kết luận: Đủ điều kiện bàn giao và merge vào main.

Chưa làm được: Không.
Phát sinh: Không.
Việc tiếp theo cần biết: Sau khi merge Task077 vào main, các PR tiếp theo (như Task072) cần rebase/merge main để thừa hưởng các cải tiến CI ổn định này.
