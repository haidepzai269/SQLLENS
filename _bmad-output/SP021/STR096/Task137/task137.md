# Task137: Serializer `.sql` theo dialect, tách `ALTER` cho vòng FK

Thuộc: SP021 / STR096
Mục tiêu: File `.sql` tải về chạy được ngay trên engine tương ứng, kể cả schema có vòng khóa ngoại.

Phạm vi:
- `web/src/modules/export/sql-serializer.ts`
- `web/src/modules/export/sql-serializer.test.ts`
- `web/src/modules/export/dialects.ts`

Không làm:
- Không làm menu UI (Task138).
- Không xuất dữ liệu (chỉ DDL).
- Không tự sửa schema người dùng.

Hợp đồng:
- `serializeSchema(input: { tables: TableSpec[]; engine: "postgres" | "mysql" | "sqlite"; projectName: string; now: Date }): string`
- File có header comment: engine, tên dự án, thời điểm, thứ tự phụ thuộc.
- FK thuộc chu trình được đưa xuống khối `ALTER TABLE ... ADD CONSTRAINT` cuối file (MySQL dùng `ADD CONSTRAINT ... FOREIGN KEY`).

Tiêu chí xong:
- AC1: Với Postgres, file sinh ra chạy được trong PGlite mới, không lỗi FK (test chạy file thật bằng PGlite).
- AC2: Vòng A↔B cho ra file chạy được, FK của vòng nằm ở khối cuối.
- AC3: Quote định danh đúng dialect (Postgres `"`; MySQL/SQLite `` ` ``), escape ký tự bên trong.
- AC4: Cùng đầu vào và cùng `now` cho ra cùng chuỗi (tất định).
- AC5: Header có đủ engine, dự án, thời điểm, thứ tự.
- AC6: Unit test phủ 4 kịch bản: 5 bảng có FK, vòng FK, bảng tự tham chiếu, schema rỗng.

Ca biên: tên cột có dấu cách và nháy; `DEFAULT` chuỗi có nháy đơn; kiểu dữ liệu riêng của MySQL (không chuyển sang Postgres); schema rỗng vẫn ra file hợp lệ có header.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/export/sql-serializer.test.ts`.
Góc review thêm: đúng nhãn (file là Thật vì đã chạy thử), test chạy PGlite thật.
Đọc thêm: `_bmad-output/SP021/STR096/Task136/task136.md`.
