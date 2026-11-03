# Task041: CSDL của app

Thuộc: SP005 / STR021
Mục tiêu: Gin lưu được tài khoản và phiên đăng nhập trên Postgres (Neon khi chạy thật), có migration chạy lại an toàn.
Phạm vi: `api/internal/store/**`, `api/migrations/**`, `api/go.mod`, `api/go.sum`.
Không làm: OAuth và route (Task042), quota (Task043), nối vào `router.go`.

Hợp đồng (Task042 dựa vào):
- Bảng `users` (id, tên hiển thị, email nếu nhà cung cấp trả, ảnh, thời điểm tạo), `identities` (nhà cung cấp `google` hoặc `github`, mã người dùng của nhà cung cấp, user id; cặp nhà cung cấp và mã là duy nhất), `sessions` (băm của token phiên, user id, thời điểm tạo, hết hạn, lần dùng cuối).
- Token phiên không bao giờ lưu dạng gốc, chỉ lưu băm SHA-256.
- Package `store` có: `Open(ctx, databaseURL) (*Store, error)`, `Migrate(ctx) error`, `UpsertIdentity(ctx, provider, subject string, profile Profile) (User, error)`, `CreateSession(ctx, userID string, ttl time.Duration) (token string, err error)`, `SessionUser(ctx, token string) (User, error)`, `DeleteSession(ctx, token string) error`, `DeleteExpired(ctx) (int, error)`. Không tìm thấy hoặc hết hạn trả lỗi `ErrNotFound`.
- Dùng `pgx` (ghim phiên bản). Migration là file SQL trong `api/migrations/`, nhúng bằng `embed`, có bảng ghi phiên bản đã chạy. Không thêm thư viện migration riêng.
- Pool kết nối nhỏ (tối đa 4) và tự đóng kết nối rảnh, để Neon tự tắt được. `/healthz` không chạm database.

Tiêu chí xong:
- AC1: Test với Postgres 18 trong Docker: `Migrate` chạy hai lần liên tiếp không lỗi, lần hai không làm gì.
- AC2: `UpsertIdentity` gọi hai lần cùng nhà cung cấp và mã thì trả cùng user, cập nhật tên và ảnh. Hai nhà cung cấp khác nhau tạo hai user khác nhau, không tự gộp theo email.
- AC3: `CreateSession` trả token ngẫu nhiên ít nhất 32 byte. Database chỉ chứa băm. `SessionUser` với token đúng trả user, với token sai, đã xóa hoặc hết hạn trả `ErrNotFound`.
- AC4: Hai `UpsertIdentity` đồng thời cùng nhà cung cấp và mã không tạo hai user.
- AC5: Mọi câu SQL dùng tham số, không ghép chuỗi.
- AC6: `cd api && go vet ./... && go test ./...` thoát với mã 0. Test cần Docker thì bỏ qua có thông báo khi không có Docker, và CI vẫn chạy được phần còn lại.

Ca biên: tên hiển thị có emoji hoặc dài 1.000 ký tự; database tạm không kết nối được thì trả lỗi rõ, không panic.
Kiểm tra: `cd api && go vet ./... && go test ./...`
Góc review thêm: bảo mật (token phiên, SQL injection).
Đọc thêm: `_bmad-output/SP005/README.md`; `CLAUDE.md` dòng "Postgres của app" và "Quota và giới hạn tần suất"; mục Neon trong "Đã kiểm chứng".
