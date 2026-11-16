# Bàn giao Task127

Đã làm:
- Xây dựng component `<ProjectSwitcher />` tại `web/src/modules/workspace/components/project-switcher.tsx` đọc `useWorkspaceStore`, hỗ trợ tạo, đổi tên tại chỗ, nhân bản và xóa dự án với xác nhận 2 bước.
- Bổ sung `duplicateProject(id, copySuffix)` trong `web/src/modules/workspace/store.ts`: sao chép toàn bộ dự án và các tabs với UUID mới, bảo toàn position `0..n-1`, cập nhật `activeProjectId` và `activeTabId` sang dự án mới nhân bản.
- Bổ sung 15 khóa i18n cho dự án trong `web/messages/vi/workspace.json` và `web/messages/en/workspace.json`.
- Hỗ trợ responsive đa thiết bị: hiển thị dạng sheet/dialog trên màn hình hẹp 390px và popover trên desktop, không tràn ngang. Bổ sung focus trap bắt phím Tab/Shift+Tab vòng lặp tiêu điểm trong panel.
- Sửa 3 lỗi được reviewer phát hiện ở vòng 1:
  1. Phím Space/Enter trên nút hành động bị cha nuốt: đã thêm `if (e.target !== e.currentTarget) return;`.
  2. Tạo dự án mới thiếu tab mặc định: đã thêm `createTab(newProj.id)` ngay sau khi tạo project, đảm bảo `activeTabId` trỏ vào tab của dự án mới.
  3. Thiếu focus trap: đã bẫy vòng lặp tiêu điểm bên trong panel và tự động focus phần tử đầu tiên khi mở menu.

File chính:
- `web/src/modules/workspace/components/project-switcher.tsx`
- `web/src/modules/workspace/components/project-switcher.test.tsx`
- `web/src/modules/workspace/store.ts`
- `web/src/modules/workspace/autosave.test.ts`
- `web/messages/vi/workspace.json`, `web/messages/en/workspace.json`

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100% (Đủ 100% bản dịch vi/en).
- `npm run lint`: PASS (0 error).
- `npm run typecheck`: PASS (`tsc --noEmit` 0 lỗi).
- `vitest run`: PASS 43/43 tests (`project-switcher.test.tsx` 22 tests + `autosave.test.ts` 21 tests).

Kết quả review: Subagent task-reviewer độc lập thẩm định vòng 2 đạt chuẩn PASS 100% (AC1-AC6, 3 bug fix, ca biên 30 dự án / 100 tabs, Core Rule 7). Đủ điều kiện merge vào main. 0 mục `needs_validation` bắt buộc.

Chưa làm được:
- Chưa tích hợp việc nhả container MySQL khi rời dự án (thuộc phạm vi Task 128).
- Chưa gắn `<ProjectSwitcher />` vào thanh `TabBar` (thuộc Task 128).

Phát sinh (đưa vào SP999): Không có.

Việc tiếp theo cần biết:
- STR091 tiếp tục với Task 128: Gắn `<ProjectSwitcher />` vào `TabBar`, xử lý đổi engine theo từng dự án và nhả phiên container MySQL an toàn khi rời dự án.
