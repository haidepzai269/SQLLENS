# Task150: Gin CRUD lưu dự án cloud, quota, không log SQL

Thuộc: SP023 / STR102
Mục tiêu: Người dùng đăng nhập bấm "Lưu vào Cloud" là dự án nằm trên Neon, không có gì tự động đẩy ngầm.

Phạm vi:
- `api/internal/httpapi/cloud_projects.go`
- `api/internal/httpapi/cloud_projects_test.go`
- `api/internal/store/cloud.go`
- `api/internal/httpapi/router.go` (chỉ đăng ký route)

Không làm:
- Không viết policy RLS (Task151).
- Không đồng bộ hai chiều (Task153).
- Không log nội dung SQL ở bất kỳ mức log nào.

Hợp đồng:
- `POST /api/v1/cloud/projects` (tạo, kèm tabs), `GET /api/v1/cloud/projects` (danh sách), `GET /api/v1/cloud/projects/:id`, `PUT /api/v1/cloud/projects/:id`, `DELETE /api/v1/cloud/projects/:id`.
- Bắt buộc session hợp lệ; trả 401 nếu không, 403 nếu không phải chủ.
- Giới hạn: 50 dự án/user, 512KB/tab, 100 tab/dự án; vượt thì 400 kèm mã lỗi.
- Request/response dùng `owner_id` từ session, không nhận từ body.

Tiêu chí xong:
- AC1: Tạo dự án kèm 3 tab, đọc lại đúng nội dung và thứ tự tab.
- AC2: Người khác gọi `GET/PUT/DELETE` bằng id của chủ thì nhận 403 hoặc 404, không lộ dữ liệu.
- AC3: Vượt quota trả 400 có mã lỗi rõ; không ghi một phần.
- AC4: Xóa dự án xóa luôn tab (cascade), trả 204.
- AC5: Toàn bộ log của handler không chứa nội dung SQL (test grep log + test ghi log).
- AC6: Unit test handler phủ AC1–AC5.

Ca biên: body thiếu trường; SQL 600KB; 101 tab; id không phải UUID; xóa hai lần.
Giao diện: không có (API).
Kiểm tra: `cd api && go test ./...`, `go vet ./...`.
Góc review thêm: bảo mật (auth, không log SQL), đúng hợp đồng API.
Đọc thêm: `_bmad-output/SP023/STR102/Task149/task149.md`, `api/internal/auth/`.
