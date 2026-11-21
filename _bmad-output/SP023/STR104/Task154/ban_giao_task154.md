# Bàn giao Task154: Cloud panel trong giao diện

Thuộc: SP023 / STR104. Viết ngày 2026-11-22 sau vòng review độc lập thứ hai.

## Trạng thái: hoàn thành một phần

Panel cloud đã có, chạy được, có test, và đã nối nhánh `remote_gone` của Task153. Nhưng **Task154 chưa xong**: chưa có bàn giao này trước đó, và phần lớn giao diện mới ở mức khung.

## Đã làm

| File | Nội dung |
|---|---|
| `web/src/modules/cloud/components/cloud-panel.tsx` (511 dòng) | Panel trạng thái cloud: đăng nhập/đăng xuất theo phiên, nút Lưu lên cloud, Kéo từ cloud, Xóa, đóng panel, khối xung đột (giữ bản này / lấy bản cloud), khối `remote_gone` với hai lối thoát (lưu thành dự án mới, gỡ liên kết) |
| `web/src/modules/cloud/apply.ts` (108 dòng) | Áp kết quả kéo về workspace: thay toàn bộ tab trong **một** transaction, giữ id dự án |
| `web/src/modules/cloud/status.ts` (67 dòng) | Tính trạng thái hiển thị từ dự án local + kết quả đồng bộ |
| `web/src/modules/workspace/repository.ts` | Thêm `replaceProjectTabs` (xóa tab cũ + ghi tab mới trong cùng transaction) |
| `web/src/modules/workspace/store.ts` | Thêm `setProjectCloud` |
| `web/src/modules/workspace/components/project-switcher.tsx` | Nút mở panel cloud |
| `web/messages/{vi,en}/cloud.json` | 35 key mỗi ngôn ngữ, khớp nhau |

## Kiểm tra

- `web/src/modules/cloud/components/cloud-panel.test.tsx`: 403 dòng test.
- `web/src/modules/cloud/apply.test.ts`: 169 dòng test, gồm ca "thay toàn bộ tab, xóa tab cũ, giữ id".
- Trình duyệt thật (`next start`, Chromium) ngày 2026-11-22:
  - Chưa đăng nhập: `needLoginVisible = 1`, `saveVisible = 0`, link trỏ `/vi/login` thật.
  - Đã đăng nhập: `needLoginVisible = 0`, `saveVisible = 1`; chỉ **1** request `GET /api/me` khi mount.
  - vi/1280, vi/390, en/390: `docOverflow = 0`, `panelOverflow = 0`, panel nằm trong viewport.
  - `cloud-close` và `cloud-save` là `<button>` thật, Tab vào được. `cloud-pull`/`cloud-delete` **không hiện** ở trạng thái local (đúng: chưa có gì để kéo/xóa).
- Không có `dangerouslySetInnerHTML` trong `web/src`; không có chuỗi giao diện cứng trong `cloud-panel.tsx`.

## Vấn đề đã biết

1. **Vượt phạm vi commit.** `task154.md` ghi "Không đổi logic sync (Task153)", nhưng commit `bcfe308` sửa cả `sync.ts` (thêm `asNew`, `remote_gone`, `unpersistedLinks`, `detachCloudLink`), `apply.ts`, `status.ts`, `repository.ts`, `store.ts`, `types.ts`, `hydrate.ts`. Nguyên nhân: phần sửa LỖI 4/5 của Task153 cần `apply.ts` để `tsc` build được cây. Nội dung đúng và có test, nhưng nhãn commit không sạch.
2. **`unpersistedLinks` là Map cấp module**, không có hook đăng xuất/đổi người dùng/đóng tab. Rò rỉ bộ nhớ ở mức thấp (có trần thực tế nhỏ), nhưng liên kết của người dùng trước có thể còn khi người khác đăng nhập trong cùng tab. `forgetUnpersistedLinks()` hiện chỉ được test gọi.
3. **Chưa có ảnh/không có kiểm trên thiết bị thật** (mới Chromium headless ở 1280 và 390).
4. **Chưa rà hết nơi dùng `PushResult`**: nay có thêm nhánh `remote_gone`, chỗ nào so `result.kind === "ok"` mà không xét nhánh mới thì cần xem lại.

## Việc còn phải làm để đóng Task154

- Rà mọi nơi dùng `PushResult`, bảo đảm xử lý đủ 4 nhánh (`ok`, `conflict`, `remote_gone`, lỗi).
- Quyết định hook dọn `unpersistedLinks` (đăng xuất / đổi người dùng / `visibilitychange`).
- Kiểm trên trình duyệt thật có đăng nhập OAuth (chưa kiểm được luồng thật vì cần Google/GitHub).
- Ảnh chụp 3 kích thước màn hình vào bàn giao.
