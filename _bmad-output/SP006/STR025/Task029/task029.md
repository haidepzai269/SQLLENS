# Task029: Component ô soạn SQL

Thuộc: SP006 / STR025
Mục tiêu: Component CodeMirror 6 dùng được trên máy tính và điện thoại, đổi được dialect, nạp được câu mẫu, tô được chỗ lỗi.
Phạm vi: `web/src/components/sql-editor/**`, `web/src/app/[locale]/e2e-editor/**`, `web/e2e/sql-editor.spec.ts`, `web/messages/*/sql-editor.json`.
Không làm: gắn vào màn hình chính (Task032), gọi parser hay engine.

Hợp đồng:
- `SqlEditor({ value, onChange, engine, error, ariaLabel }: { value: string; onChange: (v: string) => void; engine: EngineId; error?: { position: number; message: string }; ariaLabel: string })`. `position` đếm từ 0.
- Tải riêng bằng `next/dynamic`, có skeleton đúng hình dạng khi đang tải.
- `SAMPLE_SQL: Record<EngineId, string>`: câu mẫu có `CREATE TABLE`, `CREATE INDEX`, `INSERT`, `SELECT`. Mẫu MySQL không dùng cú pháp riêng của PostgreSQL và ngược lại.
- `SampleButton({ engine, onLoad })`: nút nạp câu mẫu, chuỗi lấy từ bản dịch.
- Dùng `@uiw/react-codemirror`, `@codemirror/lang-sql`, token trong `globals.css`, theo `DESIGN.md` và `EXPERIENCE.md`.

Tiêu chí xong:
- AC1: Đổi `engine` thì đổi dialect mà không mất nội dung và không mất vị trí con trỏ. Backtick chỉ tô như tên ở MySQL, `::` chỉ tô như toán tử ở PostgreSQL.
- AC2: Có `error` thì tô đúng ký tự tại `position`, có dấu ở lề dòng lỗi, trình đọc màn hình đọc được thông báo. Bỏ `error` thì hết tô. `position` lớn hơn độ dài chuỗi không làm sập.
- AC3: Tự xuống dòng. Số dòng ở lề tính theo dòng logic, theo `EXPERIENCE.md`.
- AC4: Bàn phím: `Tab` thụt lề, `Esc` rồi `Tab` thoát khỏi ô, để không bẫy người dùng bàn phím. Có test.
- AC5: Ở 390 px: trang không cuộn ngang, cỡ chữ từ 16 px trở lên để iOS không tự phóng to, dán được. Kiểm bằng Playwright, chụp ảnh lưu vào thư mục task.
- AC6: Dán 1 MB SQL không làm treo: không có khung nào chờ quá 500 ms sau khi dán. Ghi số đo vào bàn giao.
- AC7: Phần JS của ô soạn không nằm trong bundle ban đầu của `/vi`. Ghi dung lượng gzip vào bàn giao.
- AC8: Đủ `vi` và `en`, không có chuỗi cứng. `npm run check` và `npm run build` thoát với mã 0.

Vì task không được sửa màn hình chính, Playwright dùng route thử riêng `web/src/app/[locale]/e2e-editor/`, cách làm giống `e2e-adapter` của Task019. Ghi route này vào Phát sinh để chặn ở SP013.

Ca biên: `value` đổi từ ngoài (nạp mẫu) không tạo vòng lặp `onChange`; nội dung có CRLF thì `position` vẫn đúng; chuỗi có HTML hiện dạng chữ.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test`
Góc review thêm: giao diện, chạy thử thật trên Chromium ở 390 px và 1440 px.
Đọc thêm: `DESIGN.md`; `EXPERIENCE.md` mục ô SQL và trợ năng.
