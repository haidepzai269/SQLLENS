# Bàn giao Task080

Đã làm:
- Luôn hiển thị thanh 7 Tabs của Stage khi `run === null`, bổ sung component `<EmptyTab>` trực quan với icon và nút CTA "Nạp mẫu SQL" cho 6 tab.
- Cho phép tab Conflict Sim mở và chạy được 5 kịch bản mô phỏng độc lập bình thường mà không cần dán hoặc chạy SQL ở editor trước.
- Bổ sung phím tắt `Ctrl+Enter` / `Cmd+Enter` trong `SqlEditor` để chạy nhanh SQL, hỗ trợ IME tiếng Việt `!isComposing`, debounce an toàn khi đang chạy.
- Hiện thực hook `useSpacePan` cho phép giữ phím `Space` và kéo pan canvas với con trỏ bàn tay (`cursor: grab/grabbing`) trên SchemaDiagram và PlanTree.
- Xây dựng component `<StageErrorBoundary>` trong `web/src/components/error-boundary.tsx` bọc quanh từng tab trong Stage, bắt ngoại lệ JS runtime và hiển thị Alert kèm nút "Thử lại".
- Xây dựng hook `usePrefersReducedMotion` và áp dụng cho các hoạt ảnh GSAP trong `btree-drop.tsx` và `join-animation.tsx` để nhảy thẳng tới frame cuối (duration = 0) khi bật giảm chuyển động.
- Chuẩn hóa Skeleton của các tab (`CapacityPanel`, `MentorPanel`, `ConflictPanel`, `BTreeDrop`) khớp chiều cao hiển thị để chống giật nhảy layout (CLS = 0).
- Bổ sung quy tắc CSS toàn cục trong `globals.css`: `button, [role="button"], [role="tab"], select, summary` có `cursor: pointer`; `button:disabled, [role="button"][aria-disabled="true"], [disabled]` có `cursor: not-allowed`.
- Hoàn thiện 100% bản dịch song ngữ tiếng Việt & tiếng Anh trong `web/messages/vi/labStage.json` và `web/messages/en/labStage.json`.
- Viết mới test E2E `web/e2e/lab-polish.spec.ts` kiểm thử toàn bộ các tính năng trên trên cả Desktop 1440px và Mobile 390px (10/10 tests pass).

File chính:
- `web/src/app/globals.css`
- `web/src/components/error-boundary.tsx` & `web/src/components/error-boundary.test.tsx`
- `web/src/components/sql-editor/sql-editor-impl.tsx` & `web/src/components/sql-editor/sql-editor.tsx`
- `web/src/modules/lab/stage/stage.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/lib/reduced-motion.ts` & `web/src/lib/reduced-motion.test.ts`
- `web/src/lib/space-pan.ts` & `web/src/lib/space-pan.test.ts`
- `web/src/modules/btree-reader/anim/btree-drop.tsx`
- `web/src/modules/plan-runner/join-anim/join-animation.tsx`
- `web/messages/vi/labStage.json` & `web/messages/en/labStage.json`
- `web/e2e/lab-polish.spec.ts`

Kết quả kiểm tra:
- `npm run check:i18n`: PASS 100%
- `npm run lint`: PASS 100% (0 errors)
- `npm run typecheck`: PASS 100% (0 errors)
- `npm run test` (Vitest): 517 tests passed (100%)
- `npx playwright test e2e/lab-polish.spec.ts`: 10/10 tests passed (Desktop 1440px & Mobile 390px, vi & en)
- Hồi quy: `e2e/conflict.spec.ts` (30/30 passed) & `e2e/lab.spec.ts` (42/42 passed).

Kết quả review:
- Reviewer độc lập thẩm định commit `85c5712`: PASS 9/9 ACs, 0 lỗi confirmed, 0 lỗi needs_validation. Tuân thủ nghiêm ngặt 4 nguyên tắc cốt lõi (1, 2, 7, 8).

Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết:
- Khởi động Đợt 4B — SP013 / STR060 (Task081: Playwright E2E Suite toàn diện) xây dựng kịch bản Golden Path 10 bước xuyên suốt toàn bộ vòng đời sản phẩm.
