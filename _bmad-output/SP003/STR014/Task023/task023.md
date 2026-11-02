# Task023: Lõi sinh dữ liệu

Thuộc: SP003 / STR014
Mục tiêu: Từ schema thật trong PGlite, sinh câu SQL tạo dữ liệu giống thật, nhanh, lặp lại được, và chỉnh được độ lệch.
Phạm vi: `web/src/modules/data-lab/generate/**`.
Không làm: giao diện (Task024), gọi engine trực tiếp.

Hợp đồng:
- `type ColumnInfo = { name: string; type: string; nullable: boolean; isPrimaryKey: boolean; isUnique: boolean; references?: { table: string; column: string } }`
- `type TableInfo = { schema: string; name: string; columns: ColumnInfo[] }`
- `SCHEMA_QUERY: string`: câu SQL đọc `information_schema` và `pg_catalog` để lấy `TableInfo[]` của schema `public`. Task024 chạy câu này qua adapter.
- `parseSchema(result: QueryResult): TableInfo[]`
- `type ColumnRule = { distinct?: number; nullRatio?: number; skew?: "uniform" | "zipf" }`
- `planData(tables: TableInfo[], rowsPerTable: Record<string, number>, rules?: Record<string, ColumnRule>, seed?: number): { order: string[]; batches: string[] }`: trả thứ tự bảng (bảng cha trước bảng con) và danh sách câu `INSERT`, mỗi câu tối đa 10.000 dòng.
- Hàm thuần, không phụ thuộc trình duyệt.

Cách sinh:
- Dùng `generate_series` trong SQL để tạo số lượng lớn. Dùng `@faker-js/faker` với seed để tạo một tập giá trị mẫu nhỏ (ví dụ 1.000 tên, 1.000 email), rồi SQL chọn theo chỉ số. Không tạo 500k giá trị bằng JS.
- Đoán theo tên cột: `email`, `name`, `full_name`, `phone`, `status`, `price`, `amount`, `total`, `created_at`, `updated_at`, `country`, `city`. Còn lại đoán theo kiểu: `int`, `bigint`, `smallint`, `numeric(p,s)`, `real`, `double precision`, `text`, `varchar(n)`, `char(n)`, `boolean`, `date`, `timestamp`, `timestamptz`, `uuid`, `jsonb`.
- Khóa chính và cột `unique`: giá trị không trùng. Khóa ngoại: chỉ lấy giá trị đã có ở bảng cha.
- `distinct`: số giá trị khác nhau của cột. `zipf`: vài giá trị chiếm phần lớn số dòng. Đây là cách cho người dùng thấy khi nào planner chọn index.

Tiêu chí xong:
- AC1: Test với schema mẫu `customers`, `orders`, `order_items` có FK: `order` đúng thứ tự cha trước con; chạy toàn bộ `batches` trên PGlite thật trong test (Node) không lỗi khóa ngoại, khóa chính hay unique.
- AC2: Cùng `seed` cho ra cùng câu SQL. Seed khác cho ra dữ liệu khác.
- AC3: `distinct: 3` cho cột `status` thì `SELECT count(DISTINCT status)` trả 3. `zipf` thì giá trị phổ biến nhất chiếm hơn 40% số dòng.
- AC4: `varchar(n)` không sinh chuỗi dài hơn `n`. `numeric(p,s)` không tràn. `nullable: false` không sinh `NULL`.
- AC5: Chạy 100k dòng cho bảng `orders` trên PGlite trong Node: ghi thời gian vào bàn giao, mục tiêu dưới 5 giây.
- AC6: Kiểu không hỗ trợ (ví dụ `tsvector`, kiểu tự định nghĩa): bỏ qua cột nếu cho phép `NULL`, nếu không thì trả lỗi rõ tên bảng và cột, không sinh SQL hỏng.
- AC7: Bảng khóa ngoại vòng (A trỏ B, B trỏ A) hoặc tự trỏ: trả lỗi rõ, hoặc sinh cột FK là `NULL` nếu được phép. Ghi cách đã chọn.
- AC8: `npm run check` thoát với mã 0.

Ca biên: tên bảng hoặc cột cần đặt trong ngoặc kép (chữ hoa, có dấu cách, từ khóa) vẫn sinh SQL đúng. Giá trị chuỗi luôn được escape.
Kiểm tra: `cd web && npm run check`
Góc review thêm: bảo mật (escape tên và giá trị).
Đọc thêm: `CLAUDE.md` mục "Quyết định đã chốt" dòng giới hạn số dòng; `_bmad-output/SP002/STR007/Task012/ket_qua.md`.
