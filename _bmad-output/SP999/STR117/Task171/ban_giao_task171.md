# Bàn giao Task171 — Sửa 6 lỗi migration 006 (Live Rooms)

**Migration `006_live_rooms.sql` đã bị sửa trực tiếp, không tạo migration mới.** Việc này hợp lệ vì 006 **chưa từng chạy ở đâu ngoài database test**: `main` đang đi trước `origin/main` 5 commit, 006 chưa push, Neon production không thể có nó. Đây không phải viết lại lịch sử đã deploy; nhưng nếu sau này 006 đã lên production thì mọi sửa đổi phải đi bằng migration mới.

## Sáu lỗi L1–L6
**L1 (Cao) — sáu helper dọn database DROP thiếu hai bảng.** `DROP TABLE ... CASCADE` chỉ xoá khoá ngoại của bảng *được nêu tên*; bảng con không tên sống sót, rồi `CREATE TABLE IF NOT EXISTS` ở lần `Migrate` sau bỏ qua nó, nên bảng vĩnh viễn mất khoá ngoại mà không có lỗi nào. Sửa: gộp danh sách về **một chỗ duy nhất** — `api/migrations/tables.go` với `migrations.DropAllTablesSQL` và `migrations.DropCloudTablesSQL`; tám chỗ dọn database trong repo giờ gọi chung hằng số đó, không còn bản sao nào để lệch. Canh bằng `TestDropAllTablesCoversEveryMigrationTable` (đối chiếu ngược từ mọi `CREATE TABLE` trong `migrations/*.sql`, đòi phủ đủ và thứ tự con-trước-cha) và `TestNoHandCopiedDropList` (cấm chép tay danh sách nhiều bảng trong file test).
**L2 (Cao)** — 006 không kiểm điều kiện tiên quyết. Thêm khối 0 kiểm `cloud_projects`, `cloud_project_members`, `users` và bốn cột mà 006 phụ thuộc; thiếu thì `RAISE EXCEPTION` nêu đúng tên.
**L3 (Cao)** — khối `DO $$` cuối không kiểm cột. Thêm 6g (cột phải có đủ tên + kiểu) và 6h (11 ràng buộc: 2 PK, 3 FK kèm `confdeltype`, 2 CHECK, 4 NOT NULL).
**L4 (Trung bình)** — cột chết `used_at`. Xoá khỏi 006, xoá luôn khẳng định `UPDATE ... SET used_at` ảnh hưởng 0 hàng (nó enshrine cột chết).
**L5 (Trung bình, bảo mật)** — `token TEXT PRIMARY KEY` lưu vé thô. Đổi thành `token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32)` theo khuôn `001_init.sql:18-20`. Test chèn vé 31 byte, 33 byte và NULL — cả ba bị từ chối.
**L6 (Thấp)** — `room_baton.holder_id` không có index. Thêm `room_baton_holder_id_idx`. Hai `CREATE INDEX` dời xuống mục 7 sau khối tự kiểm, để bảng dở dang thiếu cột không nổ lỗi thô trước khi 6g kịp nêu tên.

## Năm lỗi reviewer vòng 1 (F1–F5)
**F1 (nặng nhất) — năm trong sáu helper không được test canh.** Reviewer chứng minh bằng đột biến: bỏ hai bảng khỏi từng helper, `go test -p 1 ./...` vẫn xanh ba lần. Đề xuất ban đầu là "một test gọi cả sáu helper", nhưng sáu helper nằm ở ba package (store/httpapi/auth), đều unexported, mỗi package đọc DSN riêng — không test nào gọi được cả sáu. Thay vào đó bỏ hẳn khả năng lệch bằng hằng số dùng chung (mô tả ở L1), cộng `TestLiveRoom006FKSurvivesEveryResetHelper` gọi thật năm đường dọn của package store rồi đếm khoá ngoại từ catalog. Lead đã duyệt.
**F2** — 6g đòi khớp đúng tập cột, làm 006 vĩnh viễn không chạy lại được sau 007. Đổi thành chỉ kiểm cột **thiếu** (phép thử tập con); cột thừa hợp lệ vì 007 của Task161 thêm `room_baton.arena_step`.
**F3** — 6g chỉ kiểm tên cột, không kiểm ràng buộc. Thêm khối 6h.
**F4** — thiếu `users` trong kiểm tiên quyết; index đứng trước khối tự kiểm. Thêm `users` vào khối 0; dời index xuống mục 7.
**F5** — tài liệu sai cổng và sai phạm vi. Sửa `task171.md`: 54492 → 54493, `t160-pg` → `t171-pg`, cập nhật phạm vi file, ghi chú `_bmad-output/SP024/STR116/Task161/task161.md` **không cần sửa** vì base `e375517` đã có sẵn hai chỗ sửa cho sai lệch 1 và 5.
**Phát hiện thêm khi chạy đột biến:** xoá khối 6g và xoá khối 6h ban đầu **vẫn xanh**, vì AC3 chỉ đòi "có lỗi" mà 6h che 6g. Đã thêm hai ca biên để mỗi khối có ca đỏ riêng: `sai_kieu_cot` (đủ cột, đủ ràng buộc, chỉ `room_baton.updated_at` kiểu `text`) bắt 6g; `fk_thieu_set_null` (đủ cột, đúng kiểu, FK thiếu `ON DELETE SET NULL`) bắt 6h.

## Số đo thật
Môi trường: container `t171-pg`, PostgreSQL 18, cổng **54493**, mật khẩu `t152`, database `app171`. Cluster riêng là bắt buộc vì role là đối tượng cấp cluster còn `GRANT` là cấp database — hai task chung cluster thì `DROP ROLE sqllens_app` vướng quyền task kia đã cấp. Lệnh chạy trong `api/`: đặt `RLS_TEST_DSN`, `T149_DATABASE_URL`, `T041_DATABASE_URL`, `T151_DATABASE_URL`, `T150_DATABASE_URL` cùng trỏ `postgres://postgres:t152@localhost:54493/app171`, rồi:
- `gofmt -l .` → **rỗng**; `go vet ./...` → **sạch**.
- `go test -p 1 ./... -count=1` → **8/8 package ok, 0 FAIL**, chạy **hai lần liên tiếp** trên cùng database đều 8/8 (store 37,0 giây / 31,8 giây); `-shuffle=on` → **ok, 32,0 giây**.
- `go test -p 1 ./internal/store -run LiveRoom006 -count=1 -v` → **7 test, 14 ca, tất cả PASS**.
- AC1: đếm khoá ngoại hai bảng = **3** sau `Migrate`; qua đường dọn + `Migrate` lại vẫn **3**; `DELETE FROM cloud_projects` không để lại hàng mồ côi. Trước khi sửa, cùng phép đo cho **0** khoá ngoại và còn 2 bảng `room_*` sống sót.
- F2: `ALTER TABLE public.room_baton ADD COLUMN arena_step integer NOT NULL DEFAULT 0` rồi chạy lại 006 → **exit 0**; trước khi sửa lệnh này làm 006 thất bại.
- F3: bỏ `room_invite_tokens_role_check` và `room_baton_holder_id_fkey` rồi chạy lại 006 → `ERROR: 006_live_rooms: thiếu hoặc sai ràng buộc: khóa ngoại room_baton.holder_id -> users(id) ON DELETE SET NULL; CHECK room_invite_tokens.role IN (editor, viewer).`, **exit 3**.
- F4: `DROP TABLE public.users CASCADE` rồi chạy 006 → `ERROR: 006_live_rooms: thiếu bảng nền (users). Chạy lại 001/003/004 trước.`, **exit 3**. Bảng dở dang thiếu `holder_id` → `ERROR: 006_live_rooms: room_baton thiếu cột ({holder_id:uuid}).`, không còn lỗi thô `column ... does not exist` (đo với `ON_ERROR_STOP=1`, đúng như `store.Migrate`).

## Mười đột biến đã chạy (mỗi phép phải làm test đỏ, rồi khôi phục)
Bỏ `room_baton` khỏi `DropAllTablesSQL` → `TestDropAllTablesCoversEveryMigrationTable` đỏ. Chép tay danh sách DROP vào `store_test.go` → `TestNoHandCopiedDropList` đỏ. Đổi `DropAllTablesSQL` → `DropCloudTablesSQL` lần lượt trong `newStore`, `newTenantEnv`, `newRLSEnv`, `resetCloud`, `cleanupCloudTables` → ca tương ứng đỏ cả năm. Đổi `token_hash BYTEA ... CHECK (octet_length = 32)` về `token_hash TEXT` → 6g đỏ. Xoá khối 6g → ca `sai_kieu_cot` đỏ. Xoá khối 6h → ca `fk_thieu_set_null` đỏ.

## Hai việc còn mở và quy ước cho task sau
**Còn mở:** (1) chưa push, chưa merge — lead làm; branch `task/Task171`, base `e375517`, commit `a24ac71`. (2) **F2 chặn Task161**: 007 của Task161 thêm `room_baton.arena_step`, và 006 giờ đã chạy lại được sau 007 (đo exit 0), nhưng Task161 cần biết điều này trước khi viết 007.
**Quy ước:** `migrations.DropAllTablesSQL` / `DropCloudTablesSQL` là **đường duy nhất** được phép dọn bảng — thêm bảng mới vào migration thì thêm tên vào đó, **không chép tay** ở helper nào (`TestNoHandCopiedDropList` và `TestDropAllTablesCoversEveryMigrationTable` sẽ đỏ nếu quên). Khối 6g của 006 chỉ kiểm cột **thiếu**, không đòi khớp đúng tập cột, nên 007 thêm cột là hợp lệ và 006 vẫn chạy lại được.

## File đã chạm (10 đường dẫn: 8 sửa, 2 mới — tất cả trong `api/`)
`api/migrations/006_live_rooms.sql`, `api/migrations/tables.go` (mới), `api/migrations/tables_test.go` (mới), `api/internal/store/live_rooms_006_test.go`, `api/internal/store/store_test.go`, `api/internal/store/store_cloud_test.go`, `api/internal/store/tenant_test.go`, `api/internal/store/tenant_rls_test.go`, `api/internal/httpapi/cloud_projects_test.go`, `api/internal/auth/auth_test.go`. Không chạm frontend, không thêm dependency, không đổi `store.Migrate`.
