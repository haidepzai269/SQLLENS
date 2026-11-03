# Task033: Màn hình sửa và xác nhận schema

Thuộc: SP006 / STR028
Điều kiện bắt đầu: Task030, Task031, Task032 đã merge.
Mục tiêu: Chỉ dán query thì hệ thống hiện bản nháp schema, người dùng sửa và xác nhận rồi mới chạy. Dán schema thì không bị hỏi thừa.
Phạm vi: `web/src/modules/sql-intake/ui/**`, `web/src/modules/lab/**` (chỉ chỗ gắn), `web/messages/*/sql-intake.json`, `web/e2e/sql-intake.spec.ts`.
Không làm: sửa `classify`, `infer`, sơ đồ bảng (SP007).

Tiêu chí xong:
- AC1: `classifyInput` trả `query`, bấm Chạy: mở màn hình xác nhận với bảng và cột từ `inferSchema`, chưa có câu nào được chạy. `schema` và `both` không mở màn hình này.
- AC2: Sửa được tên bảng, tên cột, kiểu, khóa chính, thêm và xóa cột, bỏ gợi ý FK. Phần do đoán có dấu rõ và nêu lý do (`reason`).
- AC3: Bảng `incomplete` và các cảnh báo hiện rõ. Có nhập trực tiếp `CREATE TABLE` cho người muốn tự viết.
- AC4: Xác nhận: chạy schema rồi chạy query. Lỗi ở bước schema thì quay lại màn hình, không mất phần đã sửa.
- AC5: Hủy thì không chạy gì và giữ nguyên SQL. Đóng màn hình rồi mở lại vẫn còn phần đã sửa, cho đến khi query đổi.
- AC6: Không có câu nào hàm ý schema suy ra là đúng hay "thiết kế ổn". Nói rõ đây là bản nháp suy từ query.
- AC7: File dump lớn dùng `prepareDump` trước khi parse, và báo đã bỏ qua bao nhiêu khối dữ liệu.
- AC8: Bàn phím đi hết được, focus quay về nút Chạy khi đóng. Ở 390 px không cuộn ngang. Đủ `vi` và `en`.
- AC9: Playwright phủ AC1, AC2, AC4, AC5 ở `vi` và `en`, chụp ảnh 390 px và 1440 px. `npm run check`, `npm run build`, `npx playwright test` đều đạt.

Ghi chú từ Task031: các cảnh báo của `inferSchema` cần bản dịch theo key `star`, `insert-without-columns`, `ambiguous-column`, `type-conflict`, `schema-ignored`. Cột `_sqllens_placeholder` (bảng MySQL chỉ có `SELECT *`) phải hiện rõ là chỗ giữ, người dùng phải sửa trước khi xác nhận.

Ca biên: query không có bảng nào; tên bảng trùng; xóa hết cột của một bảng thì không cho xác nhận và nói rõ lý do; đang chạy thì không mở màn hình thứ hai.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, chạy thử thật, nhãn kết luận, không ghi log SQL.
Đọc thêm: bàn giao Task030, Task031, Task032; `EXPERIENCE.md`; `CLAUDE.md` nguyên tắc 2 và 4.
