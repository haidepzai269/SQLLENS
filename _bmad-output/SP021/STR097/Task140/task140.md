# Task140: Xuất cây B-Tree thành SVG vector

Thuộc: SP021 / STR097
Mục tiêu: Cây B-Tree tải về là vector, phóng to không vỡ, để dùng trong slide hoặc tài liệu kỹ thuật.

Phạm vi:
- `web/src/modules/export/capture/btree-svg.ts`
- `web/src/modules/export/capture/btree-svg.test.ts`
- `web/src/modules/export/components/export-menu.tsx` (thêm mục SVG)
- `web/src/modules/btree-reader/` (chỉ đọc, không sửa hành vi)

Không làm:
- Không chụp PNG cây (Task139 làm ERD).
- Không đổi animation hiện có.
- Không thêm thư viện mới (dùng `XMLSerializer`).

Hợp đồng:
- `exportBTreeSvg(element: SVGSVGElement, { title }: { title: string }): Blob`
- SVG đầu ra có `xmlns`, `viewBox`, style cần thiết nhúng inline, không phụ thuộc CSS ngoài.

Tiêu chí xong:
- AC1: File SVG mở được bằng trình duyệt và trình xem vector, cây đúng cấu trúc như trên màn hình.
- AC2: Không mất node, không mất nhãn key, không lệch đường nối sau khi mở lại.
- AC3: Phóng to 400% vẫn sắc nét (vector thật, không phải ảnh nhúng).
- AC4: Có `title` và `desc` cho trợ năng.
- AC5: Cây đang có animation giữa đường vẫn xuất ra trạng thái tĩnh ổn định.
- AC6: Không request mạng nào.

Ca biên: cây 1 node; cây 4 tầng; cây có node đang highlight; theme sáng/tối; cây rỗng.
Giao diện: mục SVG trong ExportMenu, disable khi chưa có cây, thông báo lỗi vi/en.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/export/capture/btree-svg.test.ts`.
Góc review thêm: giao diện (mở file thật sau khi xuất), đúng yêu cầu.
Đọc thêm: `_bmad-output/SP021/STR097/Task139/task139.md`.
