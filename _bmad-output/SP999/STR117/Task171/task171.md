# Task171 — Sửa 5 lỗi của migration 006 (Task160)

Thuộc: SP999 / STR117
Nguồn: party-mode review Task160 ngày 2026-11-23. Task160 đã merge vào `main` tại `84083ef` nhưng **chưa từng qua review độc lập**; phiên chính tự đo và dựng lại được 5 lỗi dưới đây bằng PostgreSQL 18 thật.

**Mục tiêu:** migration 006 phải sống sót qua vòng đời test của repo (DROP rồi `Migrate` lại), phải từ chối bảng dở dang thay vì im lặng nhận, và không lưu vé mời dạng thô.

**Điều kiện thi công:** migration 006 **chưa chạy ở đâu ngoài database test** — `main` đang đi trước `origin/main` 5 commit, 006 chưa push, Neon production không thể có nó. Vì vậy **được sửa thẳng file 006**, không cần migration mới. Ghi rõ điều này trong bàn giao để người sau không tưởng là sửa lịch sử đã deploy.

**Phạm vi file (8):**
- `api/migrations/006_live_rooms.sql` (sửa — 4 lỗi)
- `api/internal/store/live_rooms_006_test.go` (sửa — test mới cho từng lỗi)
- `api/internal/store/store_test.go` (dòng 32: thêm 2 bảng vào DROP list)
- `api/internal/store/store_cloud_test.go` (dòng 151, 162, 943, 988: thêm 2 bảng)
- `api/internal/store/tenant_test.go` (dòng 52: thêm 2 bảng)
- `api/internal/httpapi/cloud_projects_test.go` (dòng 92: thêm 2 bảng)
- `api/internal/auth/auth_test.go` (dòng 605: thêm 2 bảng)
- `_bmad-output/SP024/STR116/Task161/task161.md` (sửa sai lệch 1 và 5 — xem dưới)

Không chạm frontend. Không thêm dependency. Không đổi `store.Migrate`.

## Lỗi phải sửa

### L1 (Nghiêm trọng) — mất khóa ngoại vĩnh viễn, test vẫn xanh

Sáu helper dọn database trong test vẫn `DROP TABLE ... cloud_projects ... CASCADE` mà **không** liệt kê `room_invite_tokens`, `room_baton`. `CASCADE` xóa ba khóa ngoại trỏ tới `cloud_projects`/`users` nhưng **để nguyên hai bảng con** (chúng không nằm trong danh sách DROP). Lần `Migrate` kế tiếp chạy lại 006, nhưng `CREATE TABLE IF NOT EXISTS` thấy bảng đã có nên bỏ qua → khóa ngoại **không bao giờ được dựng lại**.

Đo được: `fk_con = 1` trước, `0` sau khi chạy đúng một test cũ; sau đó `DELETE FROM cloud_projects` để lại **1 hàng token mồ côi**. `TestLiveRoom006Catalog` và `TestLiveRoom006Migration` vẫn PASS vì không test nào khẳng định khóa ngoại tồn tại.

**Sửa:** thêm `room_invite_tokens, room_baton` vào **đầu** mỗi danh sách DROP (đúng thứ tự phụ thuộc: con trước cha), ở cả 6 helper + 2 câu DROP cứng `store_cloud_test.go:943` và `:988`.

### L2 (Nghiêm trọng) — 006 hỏng trên schema đã thoái hóa

Sau L1, chạy thẳng file 006 trên database đó báo `ERROR: relation "public.cloud_project_members" does not exist` (exit 3): policy `room_baton_select` đọc `cloud_project_members`, mà helper cũ đã xóa bảng đó. Người gặp lỗi không có manh mối nào nói "schema đang thiếu bảng nền".

**Sửa:** đầu file 006 thêm khối `DO $$` kiểm **điều kiện tiên quyết** — `cloud_projects` và `cloud_project_members` phải tồn tại, và `cloud_project_members` phải có cột `project_id`, `user_id`. Thiếu thì `RAISE EXCEPTION '006_live_rooms: thiếu bảng nền ... chạy lại 003/004 trước'`. Sửa L1 rồi thì lỗi này không còn xảy ra trong luồng test, nhưng vẫn phải có vì người vận hành có thể gặp.

### L3 (Trung bình) — khối tự kiểm không kiểm cột

Dựng sẵn `room_invite_tokens (token, project_id)` rồi chạy 006: exit **0**, chỉ ra NOTICE, bảng vẫn thiếu `role`, `expires_at`, `used_at`, và khối `DO` vẫn in thông báo thành công. Trong khi đó `TestCloudPreexistingPartialTable` chứng minh 003 **từ chối** bảng dở dang — 006 không có gì tương đương.

**Sửa:** khối `DO` cuối file kiểm thêm **tập cột** của cả hai bảng (đúng tên + kiểu) và `RAISE EXCEPTION` nếu lệch. Bảng dở dang phải làm migration **thất bại**, không được im lặng.

### L4 (Trung bình) — `used_at` là cột chết

006 không có policy `UPDATE` trên `room_invite_tokens`, nên **không role nào** ghi được `used_at`. Test hiện tại còn khẳng định `UPDATE ... SET used_at` ảnh hưởng **0 hàng** — tức enshrine cột chết. Task161 ghi nhận đây là sai lệch 5 ("link dùng lại được như link Google Docs").

**Sửa:** **xóa cột `used_at`** khỏi 006. Phòng cần nhiều người vào bằng một link, nên "dùng một lần" là thiết kế sai chứ không phải thiếu policy. Xóa cột rẻ hơn thêm policy + logic thu hồi, và bỏ luôn được test khẳng định 0 hàng. Cập nhật sai lệch 5 trong `task161.md`.

### L5 (Trung bình) — vé mời lưu dạng thô

`token TEXT PRIMARY KEY` giữ nguyên bí mật của link mời trong database, trong khi `001_init.sql:18-20` đã chốt khuôn đúng cho phiên: `token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32)` và comment "không bao giờ lưu token gốc". Task161 định lưu sha256 vào cột tên `token` kiểu `TEXT` — tức cột nói dối về nội dung, và để ngỏ đường cho người sau ghi thẳng vé thô.

**Sửa:** đổi thành `token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32)`. Vì 006 chưa chạy ở production, đổi bây giờ miễn phí. Cập nhật sai lệch 1 trong `task161.md`: 007 khoá policy theo `token_hash = decode(current_setting('app.invite_hash', true), 'hex')`.

### L6 (Thấp) — `room_baton.holder_id` không có index

Khóa ngoại `holder_id → users(id) ON DELETE SET NULL` không có index, nên xóa một user buộc PostgreSQL quét toàn bảng `room_baton`. Thêm `CREATE INDEX room_baton_holder_id_idx ON public.room_baton (holder_id)`.

## Tiêu chí xong

- AC1: Chạy `Migrate` trên database sạch, đếm khóa ngoại của `room_invite_tokens` và `room_baton` = **3** (token→projects, baton→projects, baton→users). Sau đó chạy **một** test cũ bất kỳ có `resetCloud`/`newStore` (ví dụ `TestCloudPrivileges`), rồi `Migrate` lại: vẫn **3**, và `DELETE FROM cloud_projects` **không** để lại hàng mồ côi ở cả hai bảng.
- AC2: Dựng database thiếu `cloud_project_members`, chạy file 006: **thất bại** với thông báo nêu tên bảng thiếu (không phải `relation ... does not exist` của policy).
- AC3: Dựng `room_invite_tokens (token, project_id)` dở dang, chạy 006: **thất bại** và nêu tên cột thiếu. Đối chứng: `TestCloudPreexistingPartialTable` vẫn PASS (003 giữ nguyên hành vi).
- AC4: `room_invite_tokens` **không còn** cột `used_at`; `token_hash` kiểu `bytea` có `CHECK (octet_length(token_hash) = 32)`; `INSERT` vé 31 byte và 33 byte đều bị từ chối.
- AC5: `room_baton` có index trên `holder_id` (đọc `pg_indexes`, không tin câu lệnh vừa chạy).
- AC6: `RLS_TEST_DSN=... T149_DATABASE_URL=... go test -p 1 ./... -count=1` PASS **7/7 package**, chạy **hai lần liên tiếp trên cùng database** đều PASS (đây là phép chứng minh L1 đã chết).
- AC7: `go test -p 1 ./internal/store -shuffle=on -count=1` PASS.
- AC8: Toàn bộ 3 test cũ của Task160 vẫn PASS sau khi sửa; test khẳng định `UPDATE used_at` ảnh hưởng 0 hàng đã bị **xóa**, không phải bị làm cho xanh.

## Ca biên

- Vé mời 32 byte đúng, 31 byte, 33 byte, NULL.
- `role` ngoài `('editor','viewer')` vẫn bị CHECK từ chối.
- Hết hạn: token còn đọc được sau `expires_at` (quyết định 410 là của Task161, không phải của schema).
- Xóa `cloud_projects` → cả hai bảng con CASCADE sạch.
- Xóa `users` → `room_baton.holder_id` thành NULL, `room_invite_tokens` không đổi.

## Kiểm tra

```powershell
$env:RLS_TEST_DSN="postgres://postgres:t152@localhost:54492/app171"
$env:T149_DATABASE_URL=$env:RLS_TEST_DSN
cd api
go test -p 1 ./... -count=1
go test -p 1 ./... -count=1
go test -p 1 ./internal/store -shuffle=on -count=1
```

Container `t160-pg` (PostgreSQL 18, cổng 54492, mật khẩu `t152`). Database `app171` đã dựng sẵn và trống. Dùng `app171`, **không** dùng `app` (Task161/Task163 chạy song song trên database khác).

## Góc review thêm

- Bảo mật: L5 là thay đổi bảo mật, phải đọc kỹ `CHECK` và kiểu cột.
- Nhãn kết luận: mọi con số trong bàn giao phải là số đo thật, kèm lệnh đã chạy.
- Chống xanh giả: AC1 và AC6 là phép phản chứng bắt buộc — nếu chỉ chạy một lần rồi báo xong thì coi như chưa làm.

## Đọc thêm

- `_bmad-output/SP024/STR116/Task160/ban_giao_task160.md`
- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task160
- `api/migrations/003_cloud_projects.sql` (khuôn `DO $$` kiểm điều kiện)
- `api/migrations/001_init.sql:18-20` (khuôn `token_hash`)
