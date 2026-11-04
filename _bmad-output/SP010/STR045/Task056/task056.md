# Task056: Màn hình so sánh trước và sau

Thuộc: SP010 / STR045
Điều kiện bắt đầu: Task054 đã merge.
Mục tiêu: Người dùng nhập cách sửa, bấm chạy, thấy hai cột trước và sau, sửa rồi chạy lại ngay.
Phạm vi: `web/src/modules/what-if/compare-ui/**`, `web/src/app/[locale]/e2e-whatif/**`, `web/messages/{vi,en}/whatIfUi.json`, `web/e2e/whatif.spec.ts`.
Không làm: gắn vào vùng `stage` của màn hình chính (task riêng), MySQL.

Hợp đồng: `<WhatIfCompare adapter={...} probe={string} />`. Dùng `compareFix`, `SqlEditor`, cây plan của Task048, component shadcn/ui.

Tiêu chí xong:
- AC1: Nhập `CREATE INDEX`, bấm Chạy: hiện số dòng, số trang và cây plan ở mỗi cột, nhãn Thật, số trang chênh lệch rõ ràng.
- AC2: Sửa cách sửa rồi chạy lại: kết quả cũ bị thay, không chồng lên, câu trả về muộn không ghi đè câu mới.
- AC3: `rowsChanged` là `true` thì hiện cảnh báo rõ rằng kết quả không còn tương đương. Số trang giảm cũng không có câu nào hàm ý thiết kế đã ổn.
- AC4: Không có thời gian chạy ở bất kỳ đâu trên màn hình.
- AC5: Dữ liệu bảng không đổi sau khi chạy, kiểm bằng checksum trong test.
- AC6: `npm run check`, `npm run build` thoát 0, `web/e2e/whatif.spec.ts` đạt với `--workers=1`.

Giao diện: trạng thái đang chạy, chưa chạy, lỗi SQL có đúng dòng, `NotSimulated` có lý do. Đủ tiếng Việt và tiếng Anh. Ở 390 px hai cột xếp chồng, không cuộn ngang trang. Có bàn phím. Tự mở ảnh chụp 1440 và 390 ở cả hai ngôn ngữ để nhìn, không chỉ dựa vào test.
Ca biên: ô sửa rỗng, bấm Chạy liên tục, engine đang bận, plan rất sâu.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3156 npx playwright test e2e/whatif.spec.ts --workers=1`.
Góc review thêm: giao diện, nhãn kết luận.
Đọc thêm: `_bmad-output/SP010/STR043/Task054/ban_giao_task054.md`; `_bmad-output/SP007/STR031/Task048/ban_giao_task048.md`.
