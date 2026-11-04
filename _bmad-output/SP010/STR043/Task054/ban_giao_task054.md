# Bàn giao Task054

Đã làm: `compareFix(adapter, { change, probe })` gọi `adapter.tryChange`, chuẩn hóa hai plan bằng `normalizePostgres`, trả `WhatIfData` nhãn `real` (số dòng, số trang, `pagesChange`, `rowsChanged`) kèm hai bằng chứng trung tính. `NotSimulated` của `tryChange` được chuyển nguyên `reasonKey`. Plan không đọc được thì trả `whatIfCompare.planUnreadable`. `EngineError` không bị bắt.
File chính: `web/src/modules/what-if/compare/compare-fix.ts`, `compare-fix.test.ts`, `web/messages/{vi,en}/whatIfCompare.json`.
Kết quả kiểm tra: `cd web && npm run check` thoát 0 (26 file test đạt, 1 bỏ qua; 327 test đạt, 13 bỏ qua) trên commit bd4d012. Sau khi sửa theo review: `npm run typecheck` sạch, `npx eslint src/modules/what-if` sạch, `npx vitest run src/modules/what-if` 4/4 đạt. Chưa chạy lại cả `npm run check` sau bản sửa test cuối.
Kết quả review: 0 lỗi confirmed, 2 needs_validation đều về test yếu và đã sửa: bỏ assert `history` giả (mảng cục bộ), và kiểm chuỗi dịch bằng `toLowerCase().not.toMatch` trên mọi khóa thay cho `\b` không hoạt động với chữ có dấu. Chưa cho reviewer kiểm lại bản sửa.
Chưa làm được: AC2 phần `history()` không có test thật, vì `compareFix` chỉ gọi `tryChange` và không chạm `history()`; việc `tryChange` không vào history thuộc hợp đồng Task025.
Phát sinh:
- `rows` lấy từ `Actual Rows` của nút gốc plan. Với probe là câu ghi, nút `ModifyTable` thường báo 0 nên `rowsChanged` có thể luôn `false`; chưa tái hiện, giao diện nên chỉ tin `rowsChanged` cho probe `SELECT`.
- `npm ci` trên Windows lỗi `ENOTEMPTY` khi có hai lần chạy chồng nhau; phải xóa `node_modules` rồi chạy lại một lần.
- `e2e/plan-explain.spec.ts:21` có cảnh báo lint biến `hist` không dùng (có sẵn, không thuộc task).
Việc tiếp theo cần biết: nhãn luôn là `real`; các khóa dịch nằm ở namespace `whatIfCompare`. Chuỗi `pages` đã kèm câu giới hạn phạm vi, giao diện không nên thêm câu kết luận tốt hay xấu.
