# Task081: Playwright E2E Suite toàn diện — Golden Path 10 bước

## 1. Mục tiêu & Bối cảnh
- **Story:** SP013 / STR060 (E2E Suite trọn vẹn).
- **Mục tiêu:** Xây dựng bộ kiểm thử tự động Playwright E2E "Luồng vàng" (Golden Path) chạy xuyên suốt toàn bộ vòng đời của người dùng trong SQLLens: từ trang giới thiệu `/about` → phòng Lab `/vi` và `/en` → nạp mẫu SQL → phím tắt `Ctrl+Enter` chạy SQL → Sơ đồ Schema → Cây Plan & Join animation → B-Tree Reader (rơi key, range scan, cuộc đua số trang/dòng) → Rủi ro Findings (tô sáng SQL & focus node) → Thử sửa What-if (so sánh trước/sau rollback) → Mô phỏng Tranh chấp Conflict Sim (timeline 2 session, deadlock Cytoscape, tiêu chí hỏng) → kiểm tra trên cả Desktop 1440px và Mobile 390px (không tràn ngang).
- **Nguyên tắc cốt lõi:**
  - Nguyên tắc 1: Kiểm tra tự động 100% nhãn kết luận (`Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được`, `Không đặt tiêu chí`).
  - Nguyên tắc 2: Tuyệt đối không có câu nào hàm ý "thiết kế này ổn".
  - Nguyên tắc 7: Không ghi log SQL người dùng.
  - Nguyên tắc 8: Coi SQL là untrusted.

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)
- **AC1 (Golden Path E2E Suite):** Tạo file mới `web/e2e/golden-path.spec.ts` hiện thực trọn vẹn 10 bước Golden Path:
  1. Truy cập `/about`, kiểm tra các khối giới thiệu GSAP, bấm CTA "Vào phòng Lab" chuyển hướng sang `/{lang}`.
  2. Bấm nút nạp mẫu SQL ("Mẫu SQL" / "Sample SQL" hoặc mẫu trong ô soạn thảo), nội dung xuất hiện chuẩn trong CodeMirror.
  3. Nhấn tổ hợp phím `Control+Enter` (hoặc `Meta+Enter`), PGlite worker chạy, lưới kết quả (Result Grid) hiển thị dữ liệu và nhãn `Thật` (`Real`).
  4. Mở tab Schema: kiểm tra các node bảng, quan hệ FK, thao tác pan canvas bằng phím `Space`.
  5. Mở tab Plan: kiểm tra Cây kế hoạch nhãn `Thật` và khối hoạt ảnh Join (Nested Loop / Hash Join).
  6. Mở tab B-Tree: kiểm tra B-Tree Reader hoạt động (rơi key, chuyển đổi Range Scan, thanh cuộc đua BTreeRace số trang/dòng).
  7. Mở tab Findings: kiểm tra danh sách rủi ro (bọc hàm, thiếu index,...), bấm vào 1 rủi ro xác nhận CodeMirror được highlight và node sơ đồ/plan được focus.
  8. Mở tab What-if: bấm áp dụng cách sửa trong transaction, kiểm tra bảng so sánh trước và sau (số trang, số dòng).
  9. Mở tab Conflict: chọn kịch bản Deadlock, chạy timeline nhịp của 2 session, kiểm tra đồ thị chờ khóa Cytoscape và tiêu chí hỏng nhãn `Mô phỏng`.
  10. Kiểm tra trên cả 2 ngôn ngữ (`/vi` và `/en`) và 2 độ phân giải màn hình chuẩn (Desktop 1440x900 và Mobile 390x844).
- **AC2 (Đa ngôn ngữ `/vi` & `/en`):** Bộ test chạy thành công trên cả 2 locale tiếng Việt và tiếng Anh, không gặp lỗi missing translation key hay chuỗi chưa dịch.
- **AC3 (Đa màn hình Desktop 1440px & Mobile 390px):** Bộ test chạy trên cả Desktop và Mobile. Trên Mobile (viewport 390x844), xác nhận `document.documentElement.scrollWidth <= window.innerWidth` (không bị tràn ngang).
- **AC4 (Kiểm tra nhãn kết luận):** Kiểm tra tự động xác nhận mọi kết luận hiển thị trên màn hình đều mang đúng 1 trong các nhãn quy định (`Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được`, `Không đặt tiêu chí`).
- **AC5 (Độ ổn định cao - Zero Flakiness):** Sử dụng các locator ngữ nghĩa (`getByRole`, `getByTestId`), tận dụng cơ chế `data-hydrated="true"`, không dùng `sleep` cứng; test chạy lặp lại không bị flake.
- **AC6 (Tốc độ thực thi):** Bộ test E2E Golden Path hoàn thành trong thời gian dưới 60 giây trên máy local và pass 100% trong `npx playwright test web/e2e/golden-path.spec.ts`.

## 3. File tác động & Tạo mới
- Tạo mới: `web/e2e/golden-path.spec.ts`
- Cập nhật (nếu cần tinh chỉnh nhỏ để test ổn định): `web/e2e/helpers.ts` hoặc các selector trợ năng trong component.

## 4. Kiểm tra chất lượng (Verification)
- `npm run check` (typecheck + lint + unit tests) đạt 100%.
- `npx playwright test web/e2e/golden-path.spec.ts` đạt 100% (cả Desktop và Mobile, cả `/vi` và `/en`).
