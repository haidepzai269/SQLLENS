# Bàn giao Task124

Đã làm: Hiện thực hóa hàm `bootWorkspace` và `flushWorkspace` tại `hydrate.ts` để nạp dữ liệu workspace từ IndexedDB vào Zustand store và tự động đồng bộ ngược lại qua autosave debounce 300ms; xóa bỏ hoàn toàn `useState` giữ `sql` trong `lab-workspace.tsx` để chuyển sang đọc/ghi trực tiếp qua active tab của `useWorkspaceStore`, giữ nguyên 100% bố cục Stage, phím tắt và giao diện; xử lý ca biên IndexedDB bị chặn (Private mode/SecurityError) bằng cơ chế fallback an toàn in-memory có thông báo cảnh báo song ngữ vi/en không chặn người dùng; viết bộ unit test và E2E test xác minh gõ SQL -> reload trang bảo toàn nội dung 100%, không tạo trùng project/tab và 0 request mạng mang nội dung SQL (Core Rule 7).
File chính:
- `web/src/modules/workspace/hydrate.ts`: Điều phối nạp dữ liệu từ IndexedDB, tạo project "Mặc định" và tab "Query 1" cho lần mở đầu tiên, liên kết autosave debounce và subscription lắng nghe store, xử lý fallback in-memory khi IndexedDB lỗi.
- `web/src/modules/workspace/hydrate.test.ts`: Bộ 6 unit tests kiểm tra fresh boot, reload bảo toàn SQL, debounce autosave, phân tách scope guest/user, fallback IndexedDB lỗi và an toàn khi 2 tab cùng ghi.
- `web/src/modules/lab/lab-workspace.tsx`: Nối editor vào active tab của workspace store, xóa bỏ `useState` cục bộ, bổ sung banner cảnh báo lỗi lưu trữ dismissible.
- `web/e2e/workspace-persist.spec.ts`: Bộ 3 Playwright tests chạy thật trên Chromium xác minh gõ SQL -> F5 khớp 100%, không tạo trùng project/tab và 0 request chứa SQL.
- `web/messages/vi/workspace.json` & `web/messages/en/workspace.json`: File bản dịch module workspace song ngữ cho thông báo cảnh báo lưu trữ.
Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100%.
- `npm run lint`: PASS 100% (0 errors).
- `npm run typecheck`: PASS 100% (`tsc --noEmit` không lỗi).
- `npx vitest run src/modules/workspace/`: 35/35 tests PASS.
- `npm run check`: 87 test files PASS, 981 tests PASS 100%.
- `npx playwright test e2e/workspace-persist.spec.ts`: 3/3 tests PASS 100% trên Chromium thật.
Kết quả review: Reviewer độc lập thẩm định PASS 100% toàn bộ AC1 – AC6 và các ca biên, 0 lỗi, không có mục needs_validation.
Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Store và editor đã liên kết chặt chẽ với IndexedDB; Task125 có thể kế thừa active tab và mảng `tabs` để xây dựng giao diện Tab Bar đa tab (thêm, đóng, đổi tên, kéo sắp xếp) mà không cần cấu trúc lại logic lưu trữ.
