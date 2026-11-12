# Task105: Nâng cấp Dropdown Header nâng cao và Trang Cài Đặt /settings toàn diện 4 phân khu

Thuộc: SP016 / STR075
Mục tiêu: Bổ sung nút "Cài đặt nâng cao..." vào menu thả bánh răng Header (`PanelToggles`); xây dựng trang cấu hình chuyên nghiệp `/settings` chia thành 4 phân khu rõ ràng, tích hợp toàn bộ các linh kiện `CustomSwitch` từ Task104 và hỗ trợ đa ngôn ngữ hoàn chỉnh.

Phạm vi:
- `web/src/components/shell/panel-toggles.tsx`
- `web/src/app/[locale]/settings/page.tsx`
- `web/src/modules/settings/settings-view.tsx`
- `web/src/modules/settings/settings-view.test.tsx`
- `web/messages/vi/settings.json`, `web/messages/en/settings.json`
- `web/messages/vi/shell.json`, `web/messages/en/shell.json`

Không làm: Không làm mất 4 toggle vùng giao diện hiện có trong menu thả `PanelToggles`; không phá vỡ layout Header hiện tại.

Hợp đồng:
- `PanelToggles`: Giữ nguyên danh sách 4 checkbox layout, thêm `<DropdownMenuSeparator />` và mục menu `<DropdownMenuItem onClick={() => router.push('/settings')}>` kèm icon bánh răng cài đặt.
- Route: `/[locale]/settings` hiển thị trang `SettingsView`.

Tiêu chí xong:
- AC1: Dropdown Header hiển thị đường phân cách và mục "Cài đặt nâng cao..." chuyển hướng mượt mà sang `/settings`.
- AC2: Trang `/settings` được bố trí thành 4 cụm phân khu chuẩn mực:
  1. **Soạn thảo SQL (Editor):** Hiển thị số dòng, Tự ngắt dòng, Tô sáng dòng hiện tại, Bộ chọn cỡ chữ (13px, 14px, 16px).
  2. **Giao diện & Màu sắc (Appearance):** Lựa chọn Chủ đề (Tối, Sáng, Hệ thống), Chế độ tương phản cao.
  3. **Trợ lý soạn thảo (Autocomplete):**
     - Gợi ý viết tiếp trực tiếp (Ghost text): Mặc định BẬT kèm mô tả "0ms, 0đ, không tốn token".
     - Menu gợi ý dạng popup (Dropdown): Mặc định TẮT kèm mô tả "Popup danh sách cột, bảng, từ khóa".
     - Gợi ý sâu từ AI Copilot: Mặc định TẮT kèm huy hiệu VIP màu vàng ánh kim và cảnh báo quyền VIP.
  4. **Tài khoản & Phân quyền (Account & VIP):** Hiển thị loại tài khoản hiện tại (Guest, User thường, VIP) và nút CTA "Nâng cấp VIP".
- AC3: 100% các công tắc chuyển trạng thái đều sử dụng linh kiện `CustomSwitch` từ Task104, cập nhật tức thì vào `SettingsContext`.
- AC4: Nút "Quay lại Không gian làm việc" (Back to Workspace) ở góc trang `/settings` giúp người dùng dễ dàng trở về Lab mà không mất phiên làm việc.
- AC5: Đầy đủ bản dịch song ngữ Tiếng Việt và Tiếng Anh trong `settings.json`.
- AC6: Unit test và Component test cho `SettingsView` đạt 100%.

Ca biên: Mở trang `/settings` trên thiết bị di động màn hình hẹp; chuyển đổi qua lại giữa các ngôn ngữ; thay đổi cài đặt và nhấn nút Back trình duyệt.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/settings/settings-view.test.tsx`.
Góc review thêm: Thẩm mỹ thị giác theo phong cách Dark Lab / Trải nghiệm chuyển trang không giật lag.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR075) & `MUC_TIEU_TRUOC_MAT.md` mục 3.

