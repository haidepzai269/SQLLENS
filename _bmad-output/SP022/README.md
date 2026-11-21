# SP022: Chia sẻ Snapshot qua URL

Epic này cho người dùng gửi một liên kết để người khác xem bài đang làm, không cần tài khoản và không cần lưu gì trên máy chủ.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 5.

Quyết định của chủ dự án: nhúng payload vào URL (gzip + base64url trong fragment `#`), không bảng share, không TTL, không rate limit, không endpoint tạo link. Giá phải trả: URL có trần độ dài và OG card không cá nhân hóa được.

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR099** | `Task143` | Codec snapshot: JSON → gzip → base64url, có version và trần kích thước | Amelia | Hoàn thành 100% |
| **STR099** | `Task144` | Share dialog: sao chép link, cảnh báo, đường lui khi link quá dài | Amelia | Hoàn thành 100% |
| **STR100** | `Task145` | Route `/share` đọc fragment, trạng thái lỗi, chặn referrer | Amelia | Hoàn thành 100% |
| **STR100** | `Task146` | Renderer chỉ đọc bám prototype | Amelia | Hoàn thành 100% |
| **STR101** | `Task147` | Fork snapshot vào workspace | Amelia | Hoàn thành 100% |
| **STR101** | `Task148` | Chạy thử snapshot ngay trên trang share | Amelia | Hoàn thành 100% |

## Hợp đồng payload dùng chung

```ts
interface SnapshotV1 {
  v: 1;
  project: { name: string; engine: "postgres" | "mysql" | "sqlite" };
  tabs: { name: string; sql: string }[];
}
```

Mọi task trong Epic đọc/ghi đúng kiểu này. Không task nào tự thêm trường mà không tăng `v`.
