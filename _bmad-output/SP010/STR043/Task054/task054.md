# Task054: So sánh trước và sau khi sửa trên PostgreSQL

Thuộc: SP010 / STR043
Mục tiêu: Từ một cách sửa và một câu thăm dò, trả về số dòng, số trang và plan đã chuẩn hóa của cả hai phía, nhãn Thật, dữ liệu không đổi.
Phạm vi: `web/src/modules/what-if/compare/**`, `web/messages/{vi,en}/whatIfCompare.json`.
Không làm: giao diện, adapter MySQL, sửa `web/src/engines/**` (nếu buộc phải sửa thì sửa tối thiểu và ghi vào bàn giao).

Hợp đồng:
- `compareFix(adapter: Pick<EngineAdapter, "tryChange">, input: { change: string; probe: string }): Promise<Outcome<WhatIfData>>`, kiểu ở `web/src/contracts/whatif.ts`.
- Dùng `adapter.tryChange` có sẵn (Task025) và `normalizePostgres` có sẵn (Task046), không tự chạy SQL.
- `NotSimulated` từ `tryChange` được chuyển nguyên `reasonKey`. Lỗi `EngineError` của `change` hay `probe` vẫn được ném, giao diện bắt.

Tiêu chí xong:
- AC1: Bảng 10k dòng không có index, `change` là `CREATE INDEX` trên cột lọc, `probe` là `SELECT` theo cột đó: `pagesChange` là `fewer`, `after.plan` có nút `index_scan` hoặc `bitmap_scan`, nhãn `real`.
- AC2: Sau khi chạy, checksum bảng không đổi, index mới không tồn tại, `history()` không đổi.
- AC3: `change` không ảnh hưởng đến câu thăm dò: `pagesChange` là `same`. `change` làm số dòng khác (ví dụ `DELETE`): `rowsChanged` là `true`.
- AC4: `change` có `COMMIT` hoặc `probe` nhiều câu: trả `NotSimulated` với `reasonKey` của `tryChange`.
- AC5: Kết quả và `evidence` không chứa trường hay giá trị thời gian. Câu dịch `evidence` không có ý nói thiết kế đã ổn, kể cả khi số trang giảm.
- AC6: `npm run check` thoát 0.

Ca biên: JSON plan của `tryChange` không đọc được thì trả `NotSimulated` thay vì ném lỗi lạ; số trang cả hai phía bằng 0; `probe` là câu ghi dữ liệu.
Kiểm tra: `cd web && npm run check`. Test Vitest chạy `tryChange` thật như `try-rollback.test.ts`. Không cần chạy Playwright.
Góc review thêm: nhãn kết luận, nguyên tắc 2 và 3 trong `CLAUDE.md`.
Đọc thêm: `_bmad-output/SP003/STR015/Task025/ban_giao_task025.md`, `_bmad-output/SP007/STR029/Task046/ban_giao_task046.md`.
