# BIÊN BẢN BÀN GIAO TASK 137

- **Story:** STR096 - Xuất DDL schema theo dialect
- **Epic:** SP021 - Export schema & dữ liệu
- **Người thực hiện:** Amelia (Senior Software Engineer subagent)
- **Người review độc lập:** Task-reviewer (Independent Reviewer subagent)
- **Trạng thái:** HOÀN THÀNH 100% - ĐÃ NGHIỆM THU PASS VÒNG 1
- **Thời điểm nghiệm thu:** 2026-11-17

---

## 1. Mục tiêu & Hợp đồng kỹ thuật
Xây dựng module serializer DDL `.sql` theo từng dialect (`postgres`, `mysql`, `sqlite`), hỗ trợ tải về và chạy được ngay trên database engine tương ứng, kể cả schema phức tạp chứa các chu trình vòng khóa ngoại (FK cycles):
- Hợp đồng chính:
  ```ts
  export function serializeSchema(input: {
    tables: TableSpec[];
    engine: "postgres" | "mysql" | "sqlite";
    projectName: string;
    now: Date;
  }): string;
  ```
- Định danh và dialect:
  - Postgres: Quote bằng `"`, escape `""`.
  - MySQL: Quote bằng `` ` ``, escape ```` `` ````.
  - SQLite: Quote bằng `` ` ``, escape ```` `` ````.
- Chu trình khóa ngoại (Cycle FKs):
  - Tách các cạnh chu trình ra khỏi đồ thị phụ thuộc để sắp xếp thứ tự tạo bảng `creationOrder` hợp lệ.
  - Với Postgres & MySQL: Tách các cycle FKs đưa xuống khối `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...` ở cuối file.
  - Với SQLite: Không hỗ trợ `ALTER TABLE ADD CONSTRAINT`, giữ inline FK trong `CREATE TABLE` (SQLite cho phép tạo bảng khi foreign keys check đang tắt lúc chạy DDL).

---

## 2. Danh sách file thay đổi
1. `web/src/modules/export/dialects.ts`: Định nghĩa các hàm format câu lệnh theo dialect (`quoteIdentifier`, `formatColumnDefinition`, `formatPrimaryKeyConstraint`, `formatInlineForeignKeyConstraint`, `formatAlterTableForeignKey`, `formatPostgresComments`, `supportsAlterForeignKey`).
2. `web/src/modules/export/sql-serializer.ts`: Triển khai hàm `serializeSchema` bóc tách cycle edges, tích hợp `buildDependencyGraph` và `topoSort` từ Task 136, tạo header comment chuẩn mực, sinh khối `CREATE TABLE` và khối `ALTER TABLE` cuối file.
3. `web/src/modules/export/sql-serializer.test.ts`: Bộ 13 test case kiểm thử toàn diện trên instance `@electric-sql/pglite` thật, kiểm tra tính tất định, escaping, và bao phủ 4 kịch bản bắt buộc cùng các ca biên.

---

## 3. Kết quả nghiệm thu theo tiêu chí (AC)

| Tiêu chí | Mô tả | Kết quả | Bằng chứng kiểm thử |
|---|---|---|---|
| **AC1** | Chạy được trên PGlite mới, không lỗi FK | **PASS** | Chạy DDL 5 bảng (`categories`, `users`, `orders`, `posts`, `comments`) trên PGlite thật, query thấy đủ 5 bảng, chèn bản ghi kiểm tra FK hoạt động chính xác. |
| **AC2** | Vòng A↔B cho ra file chạy được, FK vòng ở cuối | **PASS** | Cả chu trình 2 bảng (A↔B) và 3 bảng (A->B->C->A) đều tách FK vòng xuống khối `ALTER TABLE` cuối file, chạy trên PGlite không lỗi. |
| **AC3** | Quote định danh đúng dialect & escape | **PASS** | Postgres dùng `"`, escape `""`; MySQL/SQLite dùng `` ` ``, escape ```` `` ````. Đã test với tên có khoảng trắng, nháy kép, nháy đơn, backtick. |
| **AC4** | Tính tất định (Deterministic) | **PASS** | Chạy 10 lần với thứ tự mảng bảng đầu vào xáo trộn ngẫu nhiên, kết quả chuỗi DDL khớp 100%. |
| **AC5** | Header metadata đầy đủ | **PASS** | Header chứa engine, tên dự án, thời điểm ISO, và danh sách thứ tự phụ thuộc bảng `Dependency Order: [...]`. |
| **AC6** | Phủ 4 kịch bản bắt buộc | **PASS** | Đã phủ: 5 bảng có FK, vòng FK, bảng tự tham chiếu (self-reference inline FK), và schema rỗng (header hợp lệ). |

### Ca biên (Edge Cases)
- `DEFAULT` chuỗi có nháy đơn (`'O''Reilly'`) chạy trên PGlite và đọc lại đúng chuỗi gốc.
- Kiểu dữ liệu đặc thù của MySQL (`DATETIME`, `TINYINT(1)`, `AUTO_INCREMENT`, inline comment) được bảo toàn 100%.
- Composite Primary Key (`PRIMARY KEY ("col1", "col2")`) sinh đúng chuẩn.
- SQLite: Không sinh khối `ALTER TABLE`, giữ FK inline tương thích với engine SQLite.
- Core Rule 1 & Core Rule 7: 100% logic chạy client-side, 0 byte dữ liệu người dùng gửi cloud hay server.

---

## 4. Kiểm tra chất lượng bằng máy
- `npx vitest run src/modules/export/sql-serializer.test.ts`: 13/13 passed (100%).
- `npx vitest run src/modules/export/`: 30/30 passed (100%).
- `npm run check:i18n && npm run lint && npm run typecheck`: PASS (0 lỗi).
- `npx vitest run`: 1.139 passed, 18 skipped (0 hồi quy).
- `npm run build`: PASS (Turbopack compile thành công 57 route).

---

## 5. Kết luận
Task 137 hoàn thành xuất sắc và đã được nghiệm thu độc lập PASS 100%. Sẵn sàng tiếp tục với Task 138 (UI Export Menu & Dialog).
