# SP020: Đo lường & Engine SQLite thứ ba

Epic này thêm SQLite thành engine chạy hoàn toàn trong trình duyệt, để người dùng mang file `.sqlite` có sẵn lên xem và thử mà không cần dựng server.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 3.

Điều kiện vào Epic: `Task131` là cổng chặn. Chủ dự án chốt "đo bundle và RAM trước". Không có bảng số trong `CLAUDE.md` thì `Task132` trở đi không được bắt đầu.

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR093** | `Task131` | Đo bundle, RAM, thời gian khởi động SQLite WASM (cổng go/no-go) | Amelia | Hoàn thành 100% (Go có điều kiện) |
| **STR094** | `Task132` | Adapter SQLite trong worker theo hợp đồng `EngineAdapter` | Amelia | Hoàn thành 100% |
| **STR094** | `Task133` | Rào chắn SQL SQLite & UI chọn engine, nhãn "chưa mô phỏng được" | Amelia | Hoàn thành 100% |
| **STR095** | `Task134` | Nhập file `.sqlite` / `.db` vào vùng nhớ WASM | Amelia | Chờ thực hiện |
| **STR095** | `Task135` | Xuất file `.sqlite` từ sandbox | Amelia | Chờ thực hiện |

## Ranh giới nhãn kết luận

SQLite không có `pageinspect` và không có `EXPLAIN (ANALYZE, BUFFERS)`. Tab Plan và tab B-Tree của SQLite phải hiện `chưa mô phỏng được` kèm lý do. Cấm vẽ dữ liệu giả (Core Rule 4).
