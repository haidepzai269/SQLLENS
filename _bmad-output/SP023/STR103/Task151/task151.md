# Task151: Policy RLS theo từng lệnh, `FORCE RLS`, helper transaction

Thuộc: SP023 / STR103
Mục tiêu: Database tự chặn truy cập chéo tenant, kể cả khi code Go có lỗi, và không rò ngữ cảnh user giữa các request dùng chung connection.

Phạm vi:
- `api/migrations/004_cloud_rls.sql`
- `api/internal/store/tenant.go`
- `api/internal/store/tenant_test.go`

Không làm:
- Không sửa handler Gin (Task150 đã xong).
- Không dùng `SET ROLE` trong runtime.
- Không thêm đường query nào đi ngoài helper.

Hợp đồng:
- `WithTenant(ctx context.Context, userID string, fn func(tx pgx.Tx) error) error`: mở transaction, `SELECT set_config('app.current_user_id', $1, true)`, chạy `fn`, commit hoặc rollback.
- Policy cho `cloud_projects`: `SELECT`/`UPDATE`/`DELETE` dùng `owner_id = current_setting('app.current_user_id')::uuid`; `INSERT` có `WITH CHECK` cùng biểu thức; thành viên được `SELECT` qua `cloud_project_members`.
- Policy cho `cloud_tabs`: cùng logic qua `EXISTS (SELECT 1 FROM cloud_projects ...)`.
- Policy cho `cloud_project_members`: `SELECT` nếu là thành viên của project đó hoặc là chủ; `INSERT`/`DELETE` chỉ chủ project.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **và** `FORCE ROW LEVEL SECURITY` cho cả 3 bảng.

Tiêu chí xong:
- AC1: Có `FORCE ROW LEVEL SECURITY` trên cả 3 bảng (kiểm bằng `pg_class.relforcerowsecurity`).
- AC2: Không có policy `FOR ALL`; mỗi lệnh một policy và lệnh ghi có `WITH CHECK` tường minh.
- AC3: `cloud_project_members` có policy (đây là lỗi của spec gốc: bật RLS mà không có policy thì bảng khóa sạch).
- AC4: `WithTenant` là đường duy nhất mở transaction có `set_config`; có test grep chặn `current_setting`/`set_config` ngoài file này.
- AC5: Hai request liên tiếp trên cùng connection không thấy dữ liệu của nhau (test rò ngữ cảnh).
- AC6: Chạy migration hai lần không lỗi.

Ca biên: `userID` rỗng (phải từ chối trước khi mở transaction); transaction bị hủy giữa đường; user là thành viên project người khác; user bị xóa khỏi members giữa phiên.
Kiểm tra: `cd api && go test ./internal/store/... -run Tenant -v`; chạy migration trên Postgres thật và kiểm `pg_policies`.
Góc review thêm: bảo mật (RLS thật, không phải hình thức), đúng yêu cầu cứng của chủ dự án.
Đọc thêm: `_bmad-output/SP023/README.md` mục yêu cầu cứng.
