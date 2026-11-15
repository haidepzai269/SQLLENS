# Task125: Tab Bar: thêm, đóng, đổi tên, kéo sắp xếp

Thuộc: SP019 / STR090
Mục tiêu: Có thanh tab thật trong một dự án: thêm, đóng, đổi tên, kéo sắp xếp, không làm lại giao diện Stage.

Phạm vi:
- `web/src/modules/workspace/components/tab-bar.tsx`
- `web/src/modules/workspace/components/tab-bar.test.tsx`
- `web/messages/vi/workspace.json`
- `web/messages/en/workspace.json`

Không làm:
- Không sửa `lab-workspace.tsx` (Task126).
- Không làm split view, không làm tab chat.
- Không đổi component Stage hiện có.

Hợp đồng:
- `<TabBar />` đọc/ghi `useWorkspaceStore`, không nhận prop dữ liệu.
- Key i18n thuộc module `workspace`: `tab.add`, `tab.close`, `tab.rename`, `tab.untitled`, `tab.lastTabLocked`.

Tiêu chí xong:
- AC1: Nút `+` tạo tab mới rỗng ở cuối và chuyển sang tab đó.
- AC2: Nút đóng hiện khi hover/focus; đóng tab đang mở chọn tab kế bên; còn 1 tab thì nút disabled kèm tooltip `tab.lastTabLocked`.
- AC3: Nháy đúp đổi tên tại chỗ; Enter lưu, Esc hủy, tên rỗng quay về tên cũ.
- AC4: Kéo thả đổi thứ tự, lưu `position` xuống IndexedDB; thả cùng chỗ không đổi gì.
- AC5: 100 tab vẫn mượt, thanh tab cuộn ngang, không mount 100 editor.
- AC6: Đủ vi/en, không hardcode chuỗi; ở 390px thanh tab cuộn ngang, không tràn ngang trang.

Ca biên: tên tab 80 ký tự, tên Unicode, kéo thả ra ngoài thanh tab, bấm `+` liên tục 20 lần.
Giao diện: đủ trạng thái thường/hover/focus/disabled; bàn phím Tab tới được từng nút; aria-label cho nút đóng.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/workspace/components/tab-bar.test.tsx`.
Góc review thêm: giao diện (chạy thật, vi/en, 390px).
Đọc thêm: `web/src/modules/lab/stage/stage.tsx` để giữ đúng ngôn ngữ thiết kế.
