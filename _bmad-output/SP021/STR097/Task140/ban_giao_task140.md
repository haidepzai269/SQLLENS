# Bàn giao Task140

Đã làm: Xuất cây B-Tree đang vẽ thành file `.svg` vector. Hàm `exportBTreeSvg(element, { title })` sao chép cây, chép style **đã tính** (fill, stroke, font, opacity…) vào từng phần tử nên file không phụ thuộc CSS ngoài, gắn `xmlns`/`viewBox`/kích thước, chèn nền theo theme, thêm `<title>` + `<desc>`, bỏ class/tabindex/role/cursor. Cây bị làm mờ (Seq Scan) giữ đúng độ mờ 0.22 và `<desc>` chép lý do từ banner của BTreeView. `findBTreeSvg` chọn cây đang nhìn thấy, không có thì cây đầu tiên trong DOM. ExportMenu thêm mục "Tải cây B-Tree (SVG)", tắt kèm lý do khi chưa mở tab/chọn chỉ mục, tên file `<dự án>-btree-<YYYYMMDD-HHmm>.svg`.

File chính:
- `web/src/modules/export/capture/btree-svg.ts` (+ `.test.ts`, 15 test)
- `web/src/modules/export/components/export-menu.tsx` (+ 4 test trong `export-menu.test.tsx`)
- `web/messages/{vi,en}/export.json`
- Bằng chứng: `_bmad-output/SP021/STR097/Task140/{btree-export-dark.svg,btree-export-light.svg,btree-export-1x.png,btree-export-4x.png,svg-measure.json}`

Kết quả kiểm tra:
- `npm run check` PASS: 1247 test passed, 18 skipped (test cần `T051/T055_DATABASE_URL`), i18n + lint + typecheck sạch.
- Chrome thật (dev server + Playwright, 1440px): 17/17 PASS. Luồng thật: nạp câu mẫu → chạy → tab B-Tree → chọn `idx_orders_user` → Xuất → SVG. File 8.3 KB, `272×78`, mở lại trong trình duyệt đúng `svg`/namespace/viewBox, 1 node + 4 nhãn + title/desc, 0 `<image>`, 0 class, nền `rgb(14,14,16)` (tối) / `rgb(241,242,244)` (sáng), font JetBrains Mono 12.5px nhúng thật.
- Chrome: dựng lớp phủ animation đúng cấu trúc BTreeDrop (`data-heap`, `data-key`, `data-playing`) cạnh cây rồi xuất → file không lẫn viên bi/heap; mục SVG tắt khi chưa có cây; bản tiếng Anh đúng nhãn.
- Ảnh mở lại: `btree-export-1x.png` và `btree-export-4x.png` (cùng file SVG, phóng 400% vẫn là nét vector).

Kết quả review: **Chưa gọi reviewer độc lập** (phiên này không có subagent). Đã tự soát theo 6 AC và 4 ca biên. Lỗi tự bắt trong lúc kiểm Chrome: chuỗi i18n viết `{{name}}` (ICU của next-intl dùng `{name}`) làm `<title>` ra `export.svgTitle`; đã sửa và thêm test hồi quy cho đúng tham số.

Chưa làm được:
- Cây thật trong Lab chỉ có 1 trang (300 dòng), nên AC2 "không lệch đường nối" và "cây 4 tầng" được chứng minh bằng unit test (giữ nguyên `d`, số node/nhãn, `data-lit`), chưa có ảnh Chrome nhiều tầng.
- Cây đang bị làm mờ thì file chỉ có cây mờ + lý do trong `<desc>`; trình xem vector thường không hiện `desc`, nên ảnh dán vào slide vẫn có thể bị hiểu là "cây hỏng".
- Trình kiểm tra i18n hiện chỉ so khóa, không bắt lỗi cú pháp ICU — lỗi `{{name}}` chỉ lộ khi chạy thật.

Phát sinh (đưa vào SP999):
1. Nên chặn hoặc hỏi khi xuất cây đang mờ, hay vẽ kèm dải lý do vào chính ảnh (hiện chỉ nằm trong `desc`).
2. `check:i18n` nên thử dựng từng message bằng `createTranslator` để bắt `INVALID_MESSAGE` sớm.

Việc tiếp theo cần biết: selector xuất cây là `[data-testid="btree-svg"]` và ưu tiên cây có bề rộng > 0; đổi cấu trúc DOM của BTreeView phải chạy lại test này. Task140 là task cuối của STR097 — đóng story sau khi có reviewer độc lập nghiệm thu.
