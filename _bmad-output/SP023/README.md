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
| **STR103** | `Task151` | Policy RLS theo từng lệnh, `FORCE RLS`, helper transaction | Amelia | Hoàn thành 100% (chưa gọi reviewer độc lập) |
| **STR103** | `Task152` | Test cross-tenant thật và test rò ngữ cảnh qua pool | Amelia | Chờ thực hiện |
| **STR104** | `Task153` | Kéo/đẩy dự án và xử lý xung đột | Amelia | Chờ thực hiện |
| **STR104** | `Task154` | Cloud panel trong giao diện | Amelia | Chờ thực hiện |
| **STR105** | `Task155` | Cổng `security-audit` cho toàn Epic | Amelia | Chờ thực hiện |
| **STR105** | `Task156` | Kiểm referrer/XSS của share và hồi quy RLS | Amelia | Chờ thực hiện |

## Không làm

Không có cột `is_public` trên `cloud_projects` (share đã đi đường URL ở SP022). Không autosave ngầm lên cloud.
