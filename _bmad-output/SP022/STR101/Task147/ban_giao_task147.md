# Bàn giao Task147 — Fork snapshot vào workspace

Đã làm: nút **Thêm vào workspace** trên trang `/share` biến snapshot đang xem thành dự án riêng trong IndexedDB của người nhận, một cú bấm: `forkSnapshot(snapshot, scope)` ghi dự án + toàn bộ tab trong **một transaction**, tab nhận id mới nhưng giữ nguyên tên/thứ tự/nội dung, engine giữ nguyên, tên `<tên gốc> (bản sao)` / `(fork)`. Sau khi ghi, hàm đánh dấu dấu vân tay snapshot vào `localStorage` (chỉ 8 ký tự hex, không lưu SQL), ghi id dự án vào `sessionStorage`, rồi giao diện báo toast `Đã thêm vào workspace (N tab)` và điều hướng về workspace. Lần fork thứ hai của **cùng** một snapshot mở hộp thoại hỏi lại thay vì im lặng nhân bản. Scope được hỏi đúng lúc bấm Fork (`/api/me` một lần, lỗi mạng/401 rơi về `guest`), nên trang share vẫn không phụ thuộc backend khi chỉ xem.

Thay đổi ngoài danh sách phạm vi (đều cần cho AC, đã ghi rõ):
- `web/src/app/[locale]/providers.tsx`: mount `<Toaster />` toàn cục. Trước đó `sonner` có trong repo nhưng **chưa từng được mount**, nên `toast()` của menu Export không hiển thị ở đâu cả; toast Fork cần sống qua bước điều hướng.
- `web/src/modules/workspace/{pending-project.ts, hydrate.ts, repository.ts}`: dấu chờ "mở dự án này sau khi điều hướng" có TTL 10 phút; `bootWorkspace` chỉ mở và chỉ dọn khi id thuộc scope đang nạp (lab boot hai lần: guest trước, user sau khi `/api/me` xong — xóa ở lần boot guest sẽ làm mất dự án vừa fork trong scope user). `putProjectWithTabs` là transaction gộp dự án + tab.
- `readonly-workspace.test.tsx` / `share-view.test.tsx`: mock router, nới `waitFor` của CodeMirror lên 5 giây khi cả bộ test chạy song song (flake có sẵn từ Task146, không phải lỗi sản phẩm).

Kiểm tra (máy):
- `npx vitest run src/modules/share/fork.test.ts src/modules/workspace/pending-project.test.ts src/modules/share/components/readonly-workspace.test.tsx`: 29/29 PASS (ghi đúng scope, tab giữ nội dung, không đụng dự án khác, snapshot 0 tab, IndexedDB bị chặn, lịch sử fork, `/api/me` 200/401/lỗi mạng, boot hai scope).
- `npm run check`: PASS 1.331 test (18 skip), i18n + lint + typecheck sạch.
- Chrome thật (Playwright trên bản `next build` + `next start` tại máy, 1440px và 390px), bằng chứng ở `fork-check.json` + 4 ảnh:
  - Bấm Fork điều hướng về `/vi`, nút chuyển dự án hiện đúng `E-Commerce Deadlock Test (bản sao)`, toast `Đã thêm vào workspace (2 tab)` hiện ra và sống qua bước điều hướng.
  - F5: dự án fork còn nguyên, SQL của tab đầu còn nguyên (đã ghi thật vào IndexedDB).
  - **0 request mang payload** trong toàn bộ lượt chạy; sau khi giải mã, trang share không phát sinh request chứa nội dung.
  - Fork lần hai của cùng link mở hộp thoại `Bạn đã thêm liên kết này trước đó`; bấm Hủy đóng đúng, không tạo bản sao.
  - 390px: nút `Thêm vào workspace` hiện đầy đủ, không tràn ngang, `document.scrollWidth` không vượt bề rộng.
  - `/vi/login` vẫn dựng đúng (hồi quy cho lỗi `AuthProvider` đã sửa lúc merge Task145).

Chưa làm được / giới hạn:
- **Chưa gọi reviewer độc lập**, chưa merge.
- Badge "Snapshot chỉ đọc" ẩn dưới `sm` để nhường chỗ nút Fork ở 390px (khác prototype một chút, đã chụp ảnh).
- Nếu `/api/me` trả đúng lúc người dùng vừa đăng nhập nhưng mạng lỗi, dự án rơi vào scope `guest` và người dùng chỉ thấy sau khi đăng xuất; chưa có nút "chuyển dự án sang tài khoản" cho ca này.
- Snapshot 0 tab tạo dự án 0 tab; lab tự thêm `Query 1` khi mở (hành vi có sẵn của `bootWorkspace`), nên số tab trong toast là 0 còn workspace hiện 1 tab.
- Safari/Firefox chưa kiểm (Playwright WebKit thiếu executable như Task131/145).

Phát sinh (SP999): (1) `<Toaster />` vừa được mount lần đầu — cần soát lại vị trí/màu toast của menu Export và các trang khác; (2) nên có cách chuyển một dự án `guest` sang `user` khi fork rơi nhầm scope; (3) dấu chờ mở dự án dùng `sessionStorage` nên mở link share ở tab mới rồi tự điều hướng vẫn đúng, nhưng nếu người dùng chặn sessionStorage thì fork xong chỉ thấy dự án trong danh sách, không tự mở.

Việc tiếp theo cần biết: Task148 (chạy thử snapshot) thêm vùng kết quả vào `readonly-workspace.tsx`; đừng gọi `/api/me` khi tải trang, chỉ gọi trong hành động. `forkSnapshot` đã ghi dấu chờ mở dự án, Task148 không được xóa key `sqllens:open-project`.
