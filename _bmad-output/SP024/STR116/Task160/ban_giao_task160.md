# Bàn giao Task160

Đã làm: Migration `006_live_rooms.sql` tạo hai bảng phòng cộng tác dưới `ENABLE` + `FORCE ROW LEVEL SECURITY`, 6 policy tách theo lệnh (lệnh ghi có `WITH CHECK`), `GRANT` cho `sqllens_app`, index trên `room_invite_tokens(project_id)`, và khối `DO $$` tự đọc lại catalog rồi `RAISE EXCEPTION` nếu thiếu FORCE, thiếu policy, policy ghi thiếu `WITH CHECK`, hay `sqllens_app` thiếu quyền. Quyền: token **chỉ owner** đọc/tạo/xoá (không có policy UPDATE — token dùng một lần); Baton owner đọc/ghi, thành viên dự án **chỉ đọc**. Phòng vẫn là cloud project (quyết định C1), không có bảng `live_rooms`.

File chính:
- `api/migrations/006_live_rooms.sql` (mới)
- `api/internal/store/live_rooms_006_test.go` (mới — `TestLiveRoom006Catalog`, `TestLiveRoom006Migration`, `TestLiveRoom006ForceBlocksNonSuperuserOwner`)
- `api/internal/store/tenant_rls_test.go` (2 bảng mới vào `DROP TABLE` của helper `newRLSEnv`; thiếu bước này thì `DROP ... CASCADE` bảng cha để lại bảng con mất FK và `CREATE TABLE IF NOT EXISTS` không dựng lại)

Kết quả kiểm tra (chạy thật trên PostgreSQL 18 trong Docker, container `t160-pg`, cổng 54492):
- `go test -p 1 ./internal/store -run LiveRoom006 -v` → 3/3 PASS (0,82 s / 0,77 s / 0,80 s).
- `go test -p 1 ./...` → 7/7 package ok (store 22,1 s), không deadlock, không `schema_migrations` conflict.
- `gofmt -l .` → rỗng. `go vet ./...` → sạch.
- Test chạy bằng role **bị RLS áp dụng** (`sqllens_app`, NOSUPERUSER NOBYPASSRLS) và thêm một role chủ non-superuser sở hữu cả 5 bảng (chân dung Neon). Hai phép phản chứng chạy trong mỗi lần test: (1) `DISABLE ROW LEVEL SECURITY` trên `room_invite_tokens` → ngữ cảnh của An **thấy** token của Bình (1 hàng); (2) `NO FORCE` → role chủ thấy 2 token thay vì 1. Cả hai khôi phục lại trước khi test kết thúc.

Kết quả review: **chưa gọi reviewer độc lập** — phiên này không có subagent nên không dựng được `task-reviewer` mới. Cần một reviewer đọc diff `task/Task160` (góc bảo mật RLS + góc "test có kiểm tra thật") trước khi merge.

Chưa làm được: không có.

Phát sinh (cần đưa vào SP999 / chủ dự án quyết):
1. **Cột `token` lưu token thô**, đúng như bản nháp v3 duyệt. Nếu Neon lộ bản dump thì mọi link mời còn hạn dùng được ngay. Đề xuất: Task161 lưu `sha256(token)` vào cột này và chỉ gửi token thô trong URL — chưa có dòng code nào ghi vào bảng nên đổi lúc này là miễn phí. **Không tự đổi hợp đồng trong Task160.**
2. Bản nháp v3 ghi "Phạm vi: chỉ file SQL, không có code Go" nhưng AC1 đòi `TestLiveRoom006Migration` trong `api/internal/store`. Task160 coi file test là phần bắt buộc; đề nghị sửa câu phạm vi trong bản nháp để Task161 không vấp lại.
3. Bảng `room_invite_tokens` không có cột `created_at` và không có cột đếm lượt dùng: token có thể dùng lại nếu Task161 quên `used_at`. Hợp đồng hiện tại đủ cho Task161 nhưng nếu cần giới hạn số lần dùng/người tạo thì phải thêm cột.

Việc tiếp theo cần biết:
- Task161 dùng `WithTenant` (đường duy nhất đặt GUC) trước mọi câu chạm hai bảng này; `set_config` ngoài transaction sẽ rò ngữ cảnh.
- DB **không** kiểm hạn/`used_at`: Task161 phải tự lọc `expires_at > now() AND used_at IS NULL`, và tự `UPDATE used_at` (bảng không có policy UPDATE nên phải thêm policy hoặc một đường ghi riêng — đây là điểm Task161 phải quyết trước khi code).
- Thành viên dự án đọc được `room_baton` nhưng không ghi: chuyền gậy là quyết định của owner, đúng mô hình The Baton.
- `room_baton.holder_id` là `ON DELETE SET NULL`: user bị xoá thì hàng Baton còn, người giữ về `NULL`.
