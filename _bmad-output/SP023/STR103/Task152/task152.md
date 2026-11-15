# Task152: Test cross-tenant thật và test rò ngữ cảnh qua pool

Thuộc: SP023 / STR103
Mục tiêu: Chứng minh bằng test chạy thật rằng user A không đọc/ghi được dữ liệu của B, và test phải đỏ nếu RLS bị tắt.

Phạm vi:
- `api/internal/store/tenant_rls_test.go`
- `api/internal/store/testdata/rls_fixtures.sql`
- `api/internal/store/tenant.go` (chỉ sửa lỗi test phát hiện)

Không làm:
- Không mock database; test chạy Postgres thật (Docker hoặc Neon nhánh thử).
- Không nới policy để test dễ qua.
- Không bỏ test khi môi trường thiếu database: phải skip rõ ràng bằng biến môi trường `RLS_TEST_DSN`.

Hợp đồng:
- Test kết nối bằng role `sqllens_app` (không phải owner), chạy fixture 2 user + 2 project.
- Có test phụ chứng minh: nếu chạy cùng truy vấn bằng role owner thì thấy dữ liệu chéo — chứng minh RLS mới là thứ chặn.

Tiêu chí xong:
- AC1: A `SELECT` project của B trả 0 dòng; A `UPDATE`/`DELETE` project của B trả 0 dòng bị ảnh hưởng.
- AC2: A `INSERT` tab vào project của B bị từ chối (kiểm `WITH CHECK`).
- AC3: Thành viên được mời `SELECT` được project và tab của chủ, nhưng không `DELETE` được.
- AC4: Test rò ngữ cảnh: 2 lần `WithTenant` liên tiếp trên cùng pool, lần sau không thấy dữ liệu lần trước.
- AC5: Có test chứng minh tắt RLS (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY` trong transaction test) thì truy vấn chéo thấy dữ liệu — tức test cross-tenant thực sự có tác dụng.
- AC6: Tất cả test chạy pass trên Postgres thật; ghi log kết quả vào bàn giao.

Ca biên: user không tồn tại; project không tồn tại; members rỗng; hai user cùng tên.
Kiểm tra: `RLS_TEST_DSN=... cd api && go test ./internal/store/... -run RLS -v`.
Góc review thêm: bảo mật (test có thật sự chứng minh), chất lượng test.
Đọc thêm: `_bmad-output/SP023/STR103/Task151/task151.md`.
