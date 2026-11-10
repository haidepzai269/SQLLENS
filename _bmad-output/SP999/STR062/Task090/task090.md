# Task090: Header SQL cố định (sticky), nút Chạy icon Play & Sinh dữ liệu trên header, vi tương tác Debounce Tooltip

## Bối cảnh & Mục tiêu
Hiện tại trong giao diện phòng lab (`/lab`), hai nút **Chạy** và **Sinh dữ liệu** đang nằm ở cuối cột soạn thảo SQL. Khi câu lệnh SQL dài hoặc khi màn hình nhỏ, người dùng phải cuộn chuột xuống đáy mới thấy nút bấm, đồng thời thanh tiêu đề "SQL" bị trôi mất.
Mục tiêu của Task090:
1. Đưa Header của cột SQL thành cố định (`sticky top-0 bg-surface z-10`), không trôi theo khi người dùng cuộn nội dung ô soạn thảo.
2. Đưa cụm nút thao tác lên phía bên phải của Header SQL:
   - Nút **Chạy**: Thay thế bằng icon tam giác Play (SVG Lucide Play), nút bấm gọn gàng, nổi bật. Giữ `aria-label={t("run")}` để bảo toàn 100% khả năng tiếp cận và không ảnh hưởng tới các bộ test E2E.
   - Nút **Sinh dữ liệu**: Đặt cạnh nút Chạy trên header, giữ nguyên dạng nút chữ ("Sinh dữ liệu") kèm icon khóa nếu là khách.
3. Thêm vi tương tác thông minh bằng `useState` + `useEffect` debounce: Khi người dùng dừng gõ SQL (sau ~1200ms - 1500ms) và SQL có thể chạy (`canRun`), tự động hiện Tooltip ở nút Play với nội dung `"Ấn để chạy"` (`Click to run`), tự ẩn sau 3.5s hoặc khi gõ tiếp, hoặc khi bấm Chạy.

## Tiêu chí chấp nhận (AC)
- **AC1 (Header cố định):** Header của vùng SQL bám đỉnh (`sticky top-0 bg-surface z-10 border-b border-line`) khi cuộn dọc trong cột SQL trên desktop và mobile.
- **AC2 (Toolbar trên Header):**
  - Bên trái header: Tiêu đề `SQL` (`ts("tab.sql")`).
  - Bên phải header: Toolbar gồm:
    + Nút "Sinh dữ liệu": `variant="outline"`, `size="sm"`, nhãn `tth("open")`, icon `Lock` nếu `authStatus === "anon"`, giữ nguyên logic disable và dialog mở sinh dữ liệu.
    + Nút "Chạy": Icon tam giác Play SVG `<Play className="h-4 w-4 fill-current" />`, `size="sm"` (hoặc class tương thích), `variant="default"`, `aria-label={t("run")}`, giữ nguyên ref `runBtn` và logic `disabled` / `onClick={onRun}`.
- **AC3 (Dọn sạch đáy cột):** Bỏ 2 nút Chạy và Sinh dữ liệu ở cuối `sqlZone` để không bị trùng lặp, giữ lại thông báo khách `GuestNote` và thông báo mẫu `DumpNotice`, `StatementList` nếu có.
- **AC4 (Debounce Tooltip thông minh):**
  - Quản lý state `showRunTip` bằng `useState(false)`.
  - Lắng nghe thay đổi của `sql`:
    + Mỗi khi gõ: tắt ngay `showRunTip`.
    + Debounce 1200ms: nếu `sql.trim() !== ""` và `canRun === true`, bật `showRunTip(true)`.
    + Tự động tắt sau 3500ms nếu người dùng không thao tác.
    + Tắt ngay khi bấm Chạy (`onRun`).
  - Nút Play hỗ trợ cả hover thông thường và trigger tự động khi `showRunTip === true`.
- **AC5 (i18n & Kiểm tra bằng máy):**
  - Bổ sung key `tip.clickToRun` trong cả `web/messages/vi/shell.json` ("Ấn để chạy") và `web/messages/en/shell.json` ("Click to run").
  - `cd web && npm run check` (bao gồm i18n check, ESLint, TypeScript, Vitest) thoát 0.
  - Chạy Playwright E2E xác nhận các test có click nút Chạy / Sinh dữ liệu vẫn đạt 100%.

## Hướng dẫn triển khai
1. Chỉnh sửa `Pane` trong `web/src/modules/lab/lab-workspace.tsx` để hỗ trợ `headerRight?: ReactNode` và thêm `sticky top-0 z-10 bg-surface border-b border-line`.
2. Tạo toolbar header cho `sqlZone` gồm `GenerateButton` và `RunPlayButton`.
3. Cài đặt hook / effect debounce thông minh cho tooltip nút Play.
4. Xóa cụm nút cũ ở đáy `sqlZone`.
5. Bổ sung bản dịch `tip.clickToRun` cho cả `vi` và `en`.
6. Chạy `npm run check` và Playwright E2E để kiểm thử.
