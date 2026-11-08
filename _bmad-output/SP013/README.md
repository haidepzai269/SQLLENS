# SP013: Phát hành

Kết quả: Sản phẩm có trang giới thiệu, luồng không đứt đoạn, E2E đủ hai engine và kiểm tra bảo mật cuối.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR058 Landing | Task067 | Trang `/about` | Không | 1, xong |
| STR059 Đánh bóng luồng | Task080 | Đánh bóng luồng, skeletons, empty states, error boundaries, phím tắt `Ctrl+Enter`, `cursor: pointer`, `prefers-reduced-motion` | Xong các tính năng lõi | 4A, xong |
| STR060 E2E | Task081 | Playwright E2E Suite toàn diện (Golden Path 10 bước xuyên suốt vi/en) | Task080 | 4B, xong |
| STR061 Kiểm tra cuối | Task082 | Security audit đầy đủ, rà soát 100% nhãn kết luận, checklist phát hành V1 | Task081 | 4C, chuẩn bị chạy |

## Các file bị đụng

| Task | File |
|---|---|
| Task067 | `web/src/app/[locale]/about/**`, `web/src/modules/landing/**`, `web/public/about/**`, `web/messages/*/landing.json`, `web/e2e/about.spec.ts`, layout và proxy nếu cần tách khung ứng dụng |
| Task080 | `web/src/components/error-boundary.tsx`, `web/src/components/sql-editor/**`, `web/src/modules/lab/stage/stage.tsx`, `web/src/modules/lab/lab-workspace.tsx`, `web/src/lib/reduced-motion.ts`, `web/messages/*/labStage.json` |
| Task081 | `web/e2e/golden-path.spec.ts` |
| Task082 | Báo cáo kiểm toán bảo mật, rà soát `web/messages/*/*.json`, `_bmad-output/PHAT_HANH_V1.md` |
