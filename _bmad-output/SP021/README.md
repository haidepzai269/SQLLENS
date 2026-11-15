# SP021: Xuất báo cáo & sơ đồ (Export)

Epic này để người dùng mang kết quả ra khỏi SQLLens: file `.sql` chạy được, ảnh sơ đồ, và báo cáo PDF để kẹp vào PR hoặc gửi cho người khác.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 4.

Toàn bộ Epic chạy trong trình duyệt. Không có headless browser trên server (bất biến hạ tầng Render free 512MB).

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR096** | `Task136` | Đồ thị phụ thuộc khóa ngoại & sắp xếp tô-pô | Amelia | Chờ thực hiện |
| **STR096** | `Task137` | Serializer `.sql` theo dialect, tách `ALTER` cho vòng FK | Amelia | Chờ thực hiện |
| **STR096** | `Task138` | Menu Export & tải file `.sql` | Amelia | Chờ thực hiện |
| **STR097** | `Task139` | Xuất ERD thành PNG | Amelia | Chờ thực hiện |
| **STR097** | `Task140` | Xuất cây B-Tree thành SVG vector | Amelia | Chờ thực hiện |
| **STR098** | `Task141` | Bố cục báo cáo Audit A4 3 trang | Amelia | Chờ thực hiện |
| **STR098** | `Task142` | In PDF bằng Playwright và kiểm nội dung | Amelia | Chờ thực hiện |

## Ràng buộc nhãn

Báo cáo PDF nhắc lại đúng nhãn của từng kết luận (Thật / Mô phỏng / Ước lượng) và câu disclaimer sandbox. Không câu nào được hàm ý "thiết kế này ổn" (Core Rule 2).
