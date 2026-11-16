# Biên bản bàn giao Task 130: Banner 1-Click nhập nháp khách vào tài khoản khi đăng nhập

- **Story:** STR092 (Đăng xuất an toàn trên máy dùng chung & Chuyển đổi nháp khi đăng nhập)
- **Epic:** SP019 (Local-First Workspace)
- **Người thực hiện:** Amelia (Software Engineer)
- **Người thẩm tra:** Task130 Reviewer (độc lập, fresh context)
- **Ngày hoàn thành:** 16/11/2026
- **Trạng thái thẩm tra:** **PASS (100%)**

---

## 1. Mục tiêu và Phạm vi bàn giao

Giúp người dùng thử nghiệm SQLLens khi chưa đăng nhập (scope `guest`) không bị mất bài đang làm khi quyết định đăng ký/đăng nhập tài khoản. Hệ thống tự động phát hiện nháp khách và hiển thị Banner nhắc nhở 1-Click để nhập toàn bộ dự án và tab vào tài khoản người dùng (`user_<uuid>`).

### Các file đã thay đổi:
- `web/src/modules/workspace/import-guest.ts`: Logic kiểm tra nháp (`hasGuestDrafts`), sao chép sang scope người dùng (`importGuestDrafts`), quản lý cờ phiên (`sessionStorage`) và cờ vĩnh viễn (`localStorage`), chống bấm đúp (in-flight deduplication) và bẫy lỗi tràn dung lượng `WorkspaceQuotaError`.
- `web/src/modules/workspace/components/import-guest-banner.tsx`: Linh kiện UI Banner nhắc nhở với 2 nút (Nhập / Bỏ qua), không autofocus, responsive 390px, Toast thông báo kết quả tự ẩn sau 5s, tự động cập nhật lại Zustand store qua `bootWorkspace`.
- `web/src/modules/lab/lab-workspace.tsx`: Tích hợp `<ImportGuestBanner />` vào phân khu `sqlZone` phía trên `SqlEditor`.
- `web/messages/vi/workspace.json` & `web/messages/en/workspace.json`: Cặp key song ngữ `guestImport.title`, `guestImport.action`, `guestImport.dismiss`, `guestImport.done`.
- `web/src/modules/workspace/import-guest.test.ts`: Bộ kiểm thử toàn diện 23 test cases.

---

## 2. Kết quả kiểm tra nghiệm thu

| Tiêu chuẩn | Kết quả | Chi tiết kiểm chứng |
|---|---|---|
| **AC1: Hiển thị 1 lần mỗi phiên khi có nháp** | **ĐẠT** | Chỉ hiện khi đã đăng nhập (`status === "user"`), chưa dismiss trong phiên (`sessionStorage`), chưa từng import (`localStorage`), và `hasGuestDrafts()` trả về true. |
| **AC2: Nhân bản với UUID mới, giữ nguyên guest** | **ĐẠT** | Toàn bộ projects và tabs được nhân bản sang `user_${userId}` với UUID mới, giữ nguyên vị trí, tên, nội dung SQL; 100% dữ liệu gốc trong scope `guest` không bị sửa hay xóa. |
| **AC3: Toast thông báo số lượng, banner biến mất** | **ĐẠT** | Bấm nhập xong banner lập tức ẩn, Toast nổi lên thông báo số dự án và tab đã nhập (có i18n), tự tắt sau 5s; nạp lại store người dùng thấy ngay dữ liệu mới. |
| **AC4: Bỏ qua không hiện lại cùng phiên** | **ĐẠT** | Bấm "Bỏ qua" lưu cờ `sessionStorage`, banner ẩn ngay lập tức và không làm phiền lại trong phiên đó; phiên sau sẽ hiện lại nếu guest vẫn còn nháp. |
| **AC5: Chống nhập lặp** | **ĐẠT** | Lưu cờ `localStorage`, chặn ngay từ tầng UI và trả về `{ projects: 0, tabs: 0 }` ở tầng core nếu gọi lại; có in-flight deduplication chống click liên tiếp nhanh. |
| **AC6: Không che editor, 390px, không autofocus** | **ĐẠT** | Nằm trong luồng layout trên editor, co giãn tự nhiên ở 390px (`flex-col sm:flex-row`), không chiếm focus của editor hay nút Play. |
| **Ca biên** | **ĐẠT** | Xử lý hoàn hảo 50 tabs; bỏ qua guest rỗng (không hiện banner); bẫy `QuotaExceededError` thành `WorkspaceQuotaError` mà không làm mất dữ liệu guest. |
| **Core Rule 7** | **ĐẠT** | 0 byte dữ liệu SQL gửi lên server hay cloud; mọi thao tác diễn ra 100% cục bộ trong IndexedDB/Storage của trình duyệt. |

---

## 3. Kết quả kiểm tra tự động bằng máy

- `npx vitest run src/modules/workspace/import-guest.test.ts`: **23/23 tests PASS (100%)**
- `npx vitest run src/modules/workspace/`: **9/9 test files PASS, 134/134 tests PASS (100%)**
- `npm run check:i18n`: **PASS (0 missing keys)**
- `npm run typecheck`: **PASS (0 errors)**
- `npm run lint`: **PASS (0 errors)**
- `npx vitest run`: **93/93 test files PASS, 1085/1085 tests PASS (100%)** không có bất kỳ lỗi hồi quy nào.

---

## 4. Kết luận

Task 130 đã hoàn thành xuất sắc, được Task Reviewer độc lập thẩm định PASS 100%.
Chính thức đóng Story **STR092** và hoàn tất **100% toàn bộ Epic SP019 (Local-First Workspace)**!
