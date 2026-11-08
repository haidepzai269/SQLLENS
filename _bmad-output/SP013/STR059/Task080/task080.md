# Task080: Đánh bóng luồng trải nghiệm, skeleton, empty states, error boundaries, phím tắt và giảm chuyển động

Thuộc: SP013 / STR059  
Mục tiêu: Đưa trải nghiệm phòng Lab lên mức mượt mà, trực quan, không góc chết: luôn hiển thị 7 tabs của Stage kèm empty states chi tiết khi chưa có dữ liệu; cho phép Conflict Sim chạy độc lập; bổ sung ErrorBoundary cho từng tab; phím tắt `Ctrl+Enter` chạy SQL; `Space` kéo canvas; chuẩn hóa `cursor: pointer` trên mọi nút bấm và phần tử tương tác; hỗ trợ `prefers-reduced-motion` trong GSAP.  
Phạm vi:
- `web/src/app/globals.css`
- `web/src/components/error-boundary.tsx`
- `web/src/components/sql-editor/sql-editor.tsx` & `sql-editor-impl.tsx`
- `web/src/modules/lab/stage/stage.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/lib/reduced-motion.ts`
- `web/src/modules/btree-reader/anim/btree-drop.tsx`
- `web/src/modules/plan-runner/join-anim/join-animation.tsx`
- `web/messages/vi/labStage.json` & `web/messages/en/labStage.json`
- `web/e2e/lab-polish.spec.ts`

Không làm:
- Không sửa logic engine PGlite hay parser SQL.
- Không sửa luật phát hiện rủi ro Findings hay kịch bản mô phỏng Conflict Sim.

Hợp đồng:
- Component `<StageErrorBoundary onReset?: () => void>{children}</StageErrorBoundary>` bọc tab an toàn.
- Prop `onRun?: () => void` cho `SqlEditor` và keymap `Mod-Enter` trong CodeMirror.
- Hook `usePrefersReducedMotion(): boolean` cho phép phát hiện `(prefers-reduced-motion: reduce)`.
- Quy tắc CSS toàn cục: `button, [role="button"], [role="tab"], select, summary { cursor: pointer; }` và `[disabled], [aria-disabled="true"] { cursor: not-allowed; }`.

Tiêu chí xong:
- **AC1 (Empty State trực quan trên 7 tabs):** Khi người dùng chưa dán/chạy SQL (`run === null`), thanh 7 Tabs của Stage vẫn hiển thị đầy đủ (`schema`, `plan`, `btree`, `whatif`, `capacity`, `mentor`, `conflict`). Khi bấm vào từng tab (ngoại trừ conflict), hiển thị Empty State mô tả rõ tính năng của tab và có nút gợi ý hành động (ví dụ nút "Nạp mẫu SQL").
- **AC2 (Conflict Sim chạy độc lập):** Khi `run === null`, bấm tab `Tranh chấp` (conflict) vẫn cho phép xem và chạy mô phỏng 5 kịch bản mẫu bình thường.
- **AC3 (Phím tắt `Ctrl+Enter` / `Cmd+Enter`):** Trong `SqlEditor`, bấm `Ctrl+Enter` (Windows/Linux) hoặc `Cmd+Enter` (macOS) sẽ kích hoạt chạy SQL (gọi `onRun`). Không kích hoạt khi đang gõ dấu tiếng Việt (`e.isComposing`), có debounce tránh gọi lặp lại khi đang chạy.
- **AC4 (Kéo Canvas bằng Space):** Giữ phím `Space` và rê chuột trên canvas Sơ đồ bảng và Cây Plan cho phép kéo thả vùng nhìn (pan view) mượt mà với con trỏ bàn tay (`cursor: grab` / `grabbing`).
- **AC5 (Error Boundary bảo vệ từng tab):** Mỗi tab trong Stage được bọc bởi `StageErrorBoundary`. Khi có lỗi Javascript runtime trong tab, hiển thị Alert thông báo lỗi tinh gọn kèm nút "Thử lại" (Retry / Reset) mà không làm sập toàn bộ ứng dụng.
- **AC6 (Tuân thủ `prefers-reduced-motion`):** Khi hệ thống bật `prefers-reduced-motion: reduce`, các hiệu ứng hoạt ảnh GSAP (rơi key B-Tree, join animation) tự động hoàn tất ngay lập tức (duration = 0).
- **AC7 (Skeleton mượt mà & CLS = 0):** Chuẩn hóa Skeleton cho các tab khi đang tải, kích thước khớp với khung nội dung để tránh nhảy layout.
- **AC8 (Chuẩn hóa `cursor: pointer` & `cursor: not-allowed`):** Toàn bộ các nút bấm (`button`, `[role="button"]`, `[role="tab"]`, sample buttons, trigger dropdown, nút chạy, nút đóng) đều có `cursor: pointer` khi hover; khi phần tử bị vô hiệu hóa (`disabled` hoặc `aria-disabled="true"`), con trỏ chuyển thành `cursor: not-allowed`.
- **AC9 (Song ngữ & a11y đầy đủ):** 100% nội dung empty states, tooltip phím tắt và thông báo lỗi có cả tiếng Việt (`/vi`) và tiếng Anh (`/en`), hỗ trợ đầy đủ thuộc tính ARIA cho screen reader.

Ca biên:
- Bấm `Ctrl+Enter` khi đang gõ IME tiếng Việt (Telex/VNI) -> không kích hoạt chạy nhầm.
- Bấm `Ctrl+Enter` khi ô soạn thảo rỗng hoặc đang chạy (`working === true`) -> nút bấm disabled, không kích hoạt query mới.
- Một tab gặp ngoại lệ render (throw error) -> ErrorBoundary cô lập lỗi tại tab đó, các tab khác vẫn bấm qua lại được bình thường.
- Màn hình mobile 390px: Thanh Tabs cuộn/xuống dòng êm ái, Empty State không tràn ngang (`scrollWidth <= clientWidth`).

Giao diện:
- Mọi nút bấm tương tác có `cursor: pointer`, disabled có `cursor: not-allowed`.
- Empty state có icon, tiêu đề, mô tả ngắn gọn và nút CTA.
- Alert lỗi trong ErrorBoundary hiển thị viền đỏ nhẹ, nút "Thử lại" viền outline.

Kiểm tra:
- `npm run check` (typecheck, lint, unit tests pass 100%).
- `npx playwright test e2e/lab-polish.spec.ts` pass 100% trên cả Desktop 1440px và Mobile 390px.
- `npx playwright test e2e/conflict.spec.ts` và `e2e/lab.spec.ts` không bị hồi quy.

Góc review thêm:
- Giao diện & Trợ năng (Sally): Kiểm tra `cursor: pointer`, phím tắt và `prefers-reduced-motion`.
- Kiến trúc & An toàn (Winston): Kiểm tra ErrorBoundary cô lập lỗi tốt, không rò rỉ state giữa các lần reset.
