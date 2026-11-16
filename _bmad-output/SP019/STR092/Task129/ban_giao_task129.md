# Bàn giao Task129

Đã làm:
- Xây dựng module `web/src/modules/workspace/logout-flow.ts`:
  + `purgeUserScope(userId)`: xóa triệt để toàn bộ dự án và tab thuộc scope `user_<uuid>` trong IndexedDB, đếm chính xác số tab đã xóa, bảo toàn 100% dữ liệu scope `guest` và user khác, ném `WorkspacePurgeError` kèm `remainingTabs` nếu gặp lỗi giữa đường.
  + `hasUserLocalDrafts(userId)`: kiểm tra xem user có nháp trong IndexedDB hay không, tự động fallback an toàn `false` khi trình duyệt ở chế độ riêng tư (Private mode) chặn IndexedDB.
  + `confirmLogout({ hasLocalDrafts })`: điều phối quyết định đăng xuất (`"delete" | "keep" | "cancel"`).
  + Cơ chế chống bấm đúp (`inFlightPurges`) khử trùng lặp các yêu cầu xóa nháp đồng thời.
- Xây dựng linh kiện `web/src/modules/workspace/components/logout-dialog.tsx`:
  + Modal 2 lựa chọn: "Xóa nháp cục bộ" (mặc định, `autoFocus`, `variant="default"` an toàn không gây hoảng kèm giải thích `logout.deleteHint`) và "Giữ nháp lại".
  + Hỗ trợ bàn phím: Esc = Hủy, Enter trên nút mặc định = Xóa, Focus Trap bên trong dialog.
  + Responsive: bố cục thân thiện màn hình 390px, các nút chuyển thành cột dọc, không tràn ngang.
- Tích hợp vào `web/src/components/shell/user-nav.tsx`:
  + Khi người dùng bấm Đăng xuất: kiểm tra có nháp cục bộ thì mở modal `LogoutDialog`.
  + Người dùng chưa có nháp thì đăng xuất thẳng không hiện modal (ca biên).
  + Chọn Xóa thì gọi `purgeUserScope` rồi `logout()`. Chọn Giữ thì giữ nháp rồi `logout()`. Chọn Hủy thì đóng modal.
  + Trạng thái `leaving` vô hiệu hóa nút bấm chống bấm lặp.
- Bổ sung 6 khóa i18n cho cụm `logout.*` trong `web/messages/vi/workspace.json` và `web/messages/en/workspace.json`.

File chính:
- `web/src/modules/workspace/logout-flow.ts`
- `web/src/modules/workspace/logout-flow.test.ts`
- `web/src/modules/workspace/components/logout-dialog.tsx`
- `web/src/components/shell/user-nav.tsx`
- `web/src/components/shell/user-nav.test.tsx`
- `web/messages/vi/workspace.json`, `web/messages/en/workspace.json`

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100% (cụm key `logout.*` khớp đầy đủ giữa `vi` và `en`).
- `npm run lint`: PASS (0 error).
- `npm run typecheck`: PASS (`tsc --noEmit` 0 error).
- `npx vitest run`: PASS 1062/1062 tests (92 test files). Trong đó `logout-flow.test.ts` 19 tests và `user-nav.test.tsx` 9 tests PASS 100%.

Kết quả review: Subagent task-reviewer độc lập thẩm định đạt chuẩn PASS 100% ngay từ vòng 1 (AC1-AC6, ca biên, Core Rule 7). Đủ điều kiện merge vào main. 0 mục `needs_validation` bắt buộc.

Chưa làm được: Không có.
Phát sinh (đưa vào SP999): Không có.

Việc tiếp theo cần biết:
- STR092 tiếp tục với Task 130: Banner 1-Click nhập nháp `guest` vào tài khoản khi đăng nhập lần đầu để hoàn tất 100% Story STR092 và toàn bộ Epic SP019.
