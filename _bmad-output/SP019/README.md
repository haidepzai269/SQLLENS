# SP019: Local-First Workspace (Nháp, Tabs, Đa dự án)

Epic này biến SQLLens từ "một editor dùng một lần" thành nơi làm việc giữ được nhiều bản nháp: tab, dự án, và nháp sống sót qua F5 mà không cần đăng nhập.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 2.

Nguyên tắc của Epic: nội dung nháp thuộc về máy người dùng. Không request nào mang SQL nháp lên server (Core Rule 7). Đồng bộ cloud là Epic khác (SP023).

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR089** | `Task122` | Nền IndexedDB & repository workspace 2 tầng scope | Amelia | Đã hoàn thành (100%) |
| **STR089** | `Task123` | Store workspace & autosave debounce | Amelia | Đã hoàn thành (100%) |
| **STR089** | `Task124` | Nối workspace vào Lab, bỏ state cục bộ | Amelia | Đã hoàn thành (100%) |
| **STR090** | `Task125` | Tab Bar: thêm, đóng, đổi tên, kéo sắp xếp | Amelia | Đã hoàn thành (100%) |
| **STR090** | `Task126` | Chuyển tab không dựng lại sandbox & thông báo schema đổi | Amelia | Đã hoàn thành (100%) |
| **STR091** | `Task127` | Project switcher: tạo, đổi tên, nhân bản, xóa | Amelia | Đã hoàn thành (100%) |
| **STR091** | `Task128` | Engine ghim theo dự án & nhả phiên MySQL khi rời | Amelia | Đã hoàn thành (100%) |
| **STR092** | `Task129` | Modal đăng xuất & xóa nháp cục bộ | Amelia | Đã hoàn thành (100%) |
| **STR092** | `Task130` | Nhập nháp khách vào tài khoản khi đăng nhập | Amelia | Đã hoàn thành (100%) |

**Toàn bộ Epic SP019 ĐÃ HOÀN THÀNH 100%!**

## Điều kiện vào Epic

- `fake-indexeddb` (devDependency) phải được phiên chính thêm trước `Task122`.
- `Task122` là chặn cứng của 8 task còn lại: chưa có repository thì không task nào có chỗ ghi.
- `Task125` và `Task126` không được sửa cùng file. `Task125` chỉ làm component Tab Bar; `Task126` chỉ làm runtime chuyển tab và `lab-workspace.tsx`.
