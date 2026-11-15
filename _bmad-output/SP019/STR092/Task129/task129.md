# Task129: Modal đăng xuất & xóa nháp cục bộ

Thuộc: SP019 / STR092
Mục tiêu: Trên máy dùng chung, người dùng quyết định xóa hay giữ nháp khi đăng xuất, và lựa chọn an toàn là mặc định.

Phạm vi:
- `web/src/modules/workspace/components/logout-dialog.tsx`
- `web/src/modules/workspace/logout-flow.ts`
- `web/src/modules/workspace/logout-flow.test.ts`
- `web/messages/vi/workspace.json`
- `web/messages/en/workspace.json`

Không làm:
- Không đụng logic xóa session ở Gin.
- Không xóa bất cứ thứ gì trên cloud.
- Không đổi `auth-controls.tsx` ngoài việc gọi modal mới.

Hợp đồng:
- `confirmLogout({ hasLocalDrafts }): Promise<"delete" | "keep" | "cancel">`
- `purgeUserScope(userId: string): Promise<number>` trả số tab đã xóa.
- Key i18n: `logout.title`, `logout.delete`, `logout.keep`, `logout.cancel`, `logout.deleteHint`.

Tiêu chí xong:
- AC1: Đăng xuất khi có nháp cục bộ thì hiện modal 2 lựa chọn, mặc định chọn "Xóa nháp cục bộ".
- AC2: Chọn xóa chỉ xóa scope `user_<uuid>`; scope `guest` còn nguyên; đếm đúng số tab đã xóa.
- AC3: Chọn giữ thì không xóa gì, đăng xuất vẫn thành công.
- AC4: Hủy thì không đăng xuất, không xóa gì.
- AC5: Không gọi API cloud nào trong cả 3 nhánh (test bằng mock fetch).
- AC6: Đủ vi/en; modal dùng được bằng bàn phím (Esc = hủy), đọc được ở 390px.

Ca biên: người dùng chưa có nháp thì không hiện modal, đăng xuất thẳng; xóa lỗi giữa đường thì báo phần còn lại; bấm đăng xuất 2 lần.
Giao diện: mặc định là hành vi xóa, nhãn nút nói rõ hậu quả, không dùng màu gây hoảng.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/logout-flow.test.ts`.
Góc review thêm: bảo mật (không đụng dữ liệu cloud), giao diện vi/en.
Đọc thêm: `web/src/modules/auth/auth-controls.tsx`.
