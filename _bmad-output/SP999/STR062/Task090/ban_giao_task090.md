# Bàn giao Task090

Đã làm:
1. Header SQL cố định: Bổ sung prop `headerRight?: ReactNode` cho `Pane` trong `lab-workspace.tsx`. Header mang lớp `sticky top-0 z-10 flex h-[var(--h-bar)] flex-none items-center justify-between border-b border-line bg-surface px-[var(--edge)] font-semibold`, bám đỉnh cố định không bị trôi khi cuộn dọc nội dung ô soạn thảo SQL trên cả máy tính lẫn điện thoại di động.
2. Toolbar trên Header SQL: Đưa nút Sinh dữ liệu (`tth("open")`, giữ nguyên dạng chữ text, `size="sm"`, `variant="outline"`, icon Lock cho khách) và nút Chạy (thay bằng icon tam giác Play SVG `<Play className="h-4 w-4 fill-current" />`, `size="sm"`, `variant="default"`, `aria-label={t("run")}`) lên phía bên phải của Header SQL.
3. Dọn sạch đáy cột SQL: Bỏ hoàn toàn 2 nút cũ ở cuối `sqlZone`, dọn dẹp giao diện sạch sẽ, thoáng đãng, giữ lại thông báo khách `GuestNote` và thông báo mẫu `DumpNotice`.
4. Vi tương tác Debounce Tooltip "Ấn để chạy": State `showRunTip` kết hợp `useEffect` debounce 1200ms khi người dùng dừng gõ SQL, tự động mở tooltip "Ấn để chạy" (`tip.clickToRun` song ngữ vi/en), tự tắt sau 3500ms hoặc tắt ngay khi người dùng gõ tiếp hoặc bấm nút Chạy. Hover chuột thông thường vào nút Play vẫn hiển thị tooltip hướng dẫn đầy đủ.
5. Mở rộng component `Tip` hỗ trợ prop `open` và `onOpenChange` kiểm soát mở tự động (controlled mode) tương thích hoàn toàn với `@base-ui/react`.

File chính:
- `web/src/modules/lab/lab-workspace.tsx`
- `web/src/components/shell/tip.tsx`
- `web/src/components/shell/tip.test.tsx`
- `web/messages/vi/shell.json`
- `web/messages/en/shell.json`
- `_bmad-output/SP999/STR062/Task090/task090.md`

Kết quả kiểm tra:
- `npm run check` (i18n check, eslint, typecheck, vitest): Thoát 0. 574 tests passed.
- `playwright test e2e/data-lab.spec.ts`: PASS 100% (cả vi & en).
- `playwright test e2e/shell-polish.spec.ts`: PASS 22/22 (100%).
- `playwright test e2e/lab-stage.spec.ts`: PASS 100%.

Kết quả review:
- Reviewer độc lập đã thẩm định commit `3e59c60` và kết luận **PASS 100%** không có lỗi (0 confirmed, 0 needs_validation).

Chưa làm được:
- Chưa mở trình duyệt thật để quay video tooltip bật/tắt (đã kiểm định bằng Playwright và Unit test).

Phát sinh:
- Không có.

Việc tiếp theo cần biết:
- Nút Chạy trên Header SQL nay là nút icon Play có `aria-label={t("run")}`, các bộ test E2E tìm `button` theo tên "Chạy" / "Run" vẫn hoạt động bình thường mà không cần sửa selector.
