# Task011: Luồng mỏng

Thuộc: SP001 / STR006
Điều kiện bắt đầu: Task003, Task007 và Task008 đã merge.
Mục tiêu: Người dùng dán SQL, PGlite chạy trong trình duyệt, màn hình hiện kết quả và một kết luận mang nhãn Thật. Các Epic sau cắm vào luồng này.
Phạm vi: `web/src/app/[locale]/lab/**`, `web/src/modules/lab/**`, `web/src/engines/postgres/**`, `web/messages/*/lab.json`, `web/playwright.config.ts`, `web/e2e/**`, `.github/workflows/ci.yml` (thêm job `e2e`), `web/package.json`.
Không làm: worker (STR012), role quyền thấp (STR013), CodeMirror (STR025, dùng `textarea` của shadcn/ui), EXPLAIN, đo hiệu năng (STR007). Giao diện được phép đơn giản, nhưng phải dùng component shadcn/ui.

Hợp đồng:
- Trang `/[locale]/lab`.
- `createPostgresAdapter(): Promise<EngineAdapter>` ở `web/src/engines/postgres/adapter.ts`, dùng kiểu từ `web/src/contracts/engine.ts`.
- PGlite chỉ nạp bằng `import()` ở client sau khi người dùng bấm Chạy, không nạp lúc mở trang.
- Sau khi chạy thành công, màn hình nhận `Conclusion` có `label: "real"`, `data` là số câu đã chạy và số dòng của câu cuối.
- `explain` trả `NotSimulated`, vì chưa làm ở task này. Đánh dấu bằng comment `shortcut:` đúng mẫu của Ponytail. Tương tự cho việc chạy trên main thread và role quyền cao.

Tiêu chí xong:
- AC1: Dán `CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2); SELECT * FROM t;` rồi bấm Chạy: hiện bảng 2 dòng và nhãn Thật.
- AC2: Dán `SELEC 1`: hiện lỗi của PostgreSQL, không hiện nhãn Thật, không hiện câu thành công.
- AC3: Ô SQL trống: nút Chạy bị vô hiệu.
- AC4: Trong lúc tải PGlite có trạng thái đang tải. Tải thất bại thì hiện lỗi và cho thử lại.
- AC5: Mở `/lab` không tải file WASM của PGlite, Playwright kiểm bằng cách theo dõi request mạng.
- AC6: Bản `next build` chạy được WASM. E2E chạy trên `next start`, không chạy trên `next dev`.
- AC7: Playwright chạy AC1, AC2 ở cả `/vi` và `/en`. Job `e2e` trong CI thành công trên branch `task/Task011`.
- AC8: `npm run check` và `npm run build` thoát với mã 0. Không có câu nào hàm ý "thiết kế ổn".

Ca biên:
- Chạy lại lần hai trên cùng trang: dùng lại instance PGlite, không tải lại. `CREATE TABLE t` lần hai báo lỗi đúng của PostgreSQL.
- Câu lệnh trả 0 dòng như `SELECT 1 WHERE false`: hiện trạng thái rỗng, không crash.
- Rời trang: gọi `dispose`.
- Sau khi đổi ngôn ngữ phía client, DOM có thể giữ cả bản cũ đã ẩn. Test E2E phải lọc phần tử đang hiển thị.

Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: nhãn kết luận, giao diện.
Đọc thêm: `CLAUDE.md` mục "Nguyên tắc không được phá", "Cần thử khi dựng"; bàn giao Task001, Task007, Task008. Ghi vào bàn giao mọi điều phát hiện về WASM trong Next.js, vì STR007 dùng lại.
