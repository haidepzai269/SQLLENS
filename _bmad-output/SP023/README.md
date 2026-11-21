# SP023: Đồng bộ Cloud & RLS cấp Project

Epic này cho người dùng đã đăng nhập lưu dự án lên Neon để mở từ máy khác, và bảo vệ dữ liệu đó bằng RLS ở tầng database chứ không chỉ bằng code Go.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 6.

## Yêu cầu cứng của chủ dự án (2026-11-15)

Role tạo bảng là owner thì **mặc định bỏ qua RLS**. Epic này phải xử lý đúng chuyện đó, không được chỉ bật `ENABLE ROW LEVEL SECURITY` rồi coi là xong:

1. Role ứng dụng (`sqllens_app`) **không phải owner** của ba bảng; bảng do role migration tạo.
2. `GRANT` chỉ quyền cần thiết; role app không `SUPERUSER`, không `BYPASSRLS`.
3. `FORCE ROW LEVEL SECURITY` là lớp thứ hai.
4. Policy tách theo từng lệnh, có `WITH CHECK`; `cloud_project_members` **phải có policy**.
5. `SET LOCAL app.current_user_id` chỉ dùng trong transaction, qua một helper duy nhất.
6. Có test cross-tenant chạy thật bằng role app; test phải fail nếu tắt RLS.

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR102** | `Task149` | Migration 3 bảng cloud + role app không phải owner | Amelia | Hoàn thành 100% |
| **STR102** | `Task150` | Gin CRUD lưu dự án cloud, quota, không log SQL | Amelia | Hoàn thành 100% (chưa gọi reviewer độc lập) |
| **STR103** | `Task151` | Policy RLS theo từng lệnh, `FORCE RLS`, helper transaction | Amelia | Hoàn thành 100% + **đã sửa 5 lỗi review** (xem `ban_giao_task151_fix.md`) |
| **STR103** | `Task152` | Test cross-tenant thật và test rò ngữ cảnh qua pool | Amelia | Hoàn thành 100% (chưa gọi reviewer độc lập) |
| **STR104** | `Task153` | Kéo/đẩy dự án và xử lý xung đột | Amelia | Hoàn thành 100% + **đã sửa 2 lỗi chặn** (LỖI 4, 5) |
| **STR104** | `Task154` | Cloud panel trong giao diện | Amelia | Hoàn thành một phần: panel + `apply.ts` + `status.ts` đã có và chạy, **chưa có `ban_giao_task154.md`** |
| **STR105** | `Task155` | Cổng `security-audit` cho toàn Epic | Amelia | Chờ thực hiện |
| **STR105** | `Task156` | Kiểm referrer/XSS của share và hồi quy RLS | Amelia | Chờ thực hiện |

## Vòng sửa lỗi sau review độc lập (2026-11-21)

Reviewer độc lập tìm 5 lỗi, đã sửa hết, mỗi lỗi có test **FAIL trước / PASS sau**. Chi tiết và số đo thật ở `STR103/Task151/ban_giao_task151_fix.md`.

| Lỗi | Mức | Nội dung | Sửa ở đâu |
|---|---|---|---|
| 1 | BLOCKER | `viewer` vẫn UPDATE/DELETE/INSERT được tab của dự án được chia sẻ | `api/migrations/005_cloud_tabs_write_role.sql` |
| 2 | BLOCKER | `go test ./...` đỏ 8 test `auth`: `DROP TABLE users` thiếu `CASCADE` | `api/internal/auth/auth_test.go` |
| 3 | — | Trần body 1MB toàn cục chặn quota 100 tab × 512KB | `store/cloud.go`, `httpapi/router.go`, `httpapi/cloud_projects.go` |
| 4 | CHẶN | Đẩy hai lần tạo hai dự án cloud trùng (POST lặp) | `web/src/modules/cloud/sync.ts` |
| 5 | CHẶN | 404 của dự án đã bị xóa làm kẹt vĩnh viễn, không có lối thoát | `web/src/modules/cloud/sync.ts` + `cloud-panel.tsx` |

**Giới hạn mới cần biết:** `MaxCloudProjectBytes = 2MB` là trần **tổng** của một dự án, nên tab 512KB chỉ chứa được 3–4 tab/dự án. Con số "100 tab" trong quota chỉ đạt được khi tab nhỏ. Nâng lên ~52MB cần chủ dự án quyết vì ảnh hưởng RAM Gin trên Render free.

## Vòng sửa thứ hai (2026-11-22)

Reviewer độc lập vòng 2 kết luận **PASS**: cả 5 lỗi trên đã sửa đúng, mỗi lỗi có test FAIL trước / PASS sau (chứng minh bằng đột biến ngược). Reviewer còn tìm thêm 3 điểm và chủ dự án đã cho sửa ngay trong cùng vòng:

| Điểm | Nội dung | Sửa ở đâu |
|---|---|---|
| i18n | `en/cloud.json` có **5 key trùng** (`remoteGone*`); `JSON.parse` giữ khối sau nên UI hiện câu của khối chết, `check-i18n.mjs` không bắt được | `web/messages/en/cloud.json` |
| Đồng bộ song song | Hai lượt `pushProject` **chạy chồng** cùng dự án đều thấy `cloud` trống nên cùng POST → hai dự án trùng | `web/src/modules/cloud/sync.ts` (`inFlight`, mã lỗi `BUSY`) |
| Hổng test | Gỡ liên kết khi liên kết **chỉ nằm trong bộ nhớ** (`unpersistedLinks`) không có test; phá code thì không test nào đỏ | `web/src/modules/cloud/sync.test.ts` |

Kết quả sau vòng 2: `go test ./...` 7/7 package ok, `npm run check` 1421 passed / 18 skipped, `gofmt` chỉ còn 2 file `internal/ai/*_test.go` lệch chuẩn từ trước.

## Không làm

Không có cột `is_public` trên `cloud_projects` (share đã đi đường URL ở SP022). Không autosave ngầm lên cloud.
