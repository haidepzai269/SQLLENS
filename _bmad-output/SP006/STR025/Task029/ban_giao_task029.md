# Bàn giao Task029

Đã làm: Component ô soạn SQL dùng CodeMirror 6, tải riêng bằng `next/dynamic` có skeleton. Đổi dialect giữ nội dung và con trỏ. Tô lỗi theo `position` (đếm từ 0, đúng với CRLF), có dấu `!` ở lề và thông báo `role="alert"` hiện dạng chữ. Tự xuống dòng, số dòng theo dòng logic. `Tab` thụt lề, `Esc` rồi `Tab` thoát khỏi ô. Có `SAMPLE_SQL` cho hai engine và `SampleButton`.
File chính: `web/src/components/sql-editor/` (`sql-editor.tsx`, `sql-editor-impl.tsx`, `dialect.ts`, `samples.ts`, `sample-button.tsx`, `sql-editor.test.ts`), `web/messages/{vi,en}/sql-editor.json`, `web/src/app/[locale]/e2e-editor/`, `web/e2e/sql-editor.spec.ts`. Ảnh chụp: `anh_390.png`, `anh_1440.png` cùng thư mục với file này.
Kết quả kiểm tra (trong `web/`, `API_ORIGIN=http://localhost:8080`, `E2E_PORT=3129`):
- `npm run check` thoát 0 (77 test vitest qua). Lần chạy đầu một test của `result-grid` (Task khác) quá 5 giây do máy bận, chạy riêng và chạy lại đều qua, không sửa gì.
- `npm run build` thoát 0.
- `npx playwright test e2e/sql-editor.spec.ts` 9/9 qua. Cả bộ `npx playwright test` 47/47 qua trước lần sửa cuối.
- AC6: khung chờ lâu nhất 83 ms khi dán 1 MB nhiều dòng, 100 ms khi dán 1 MB một dòng (ngưỡng 500 ms).
- AC7: chunk JS của ô soạn nặng khoảng 145,6 KB gzip, `/vi` không chứa chunk này.
- AC5: ở 390 px không cuộn ngang, chữ 16 px, dán được, ô giữ chiều cao do trang cấp và cuộn bên trong.
Kết quả review: 2 mục đã báo đều xử lý, reviewer kiểm lại xác nhận. (1) Ảnh `SP003/.../Task020/anh-vi-1440.png` bị test Task020 ghi đè khi chạy cả bộ, đã hoàn nguyên. (2) `position` trỏ vào LF của cặp CRLF tô nhầm sang dòng sau, đã sửa và thêm test vị trí 9 và 10. Không còn needs_validation.
Chưa làm được: Firefox, Safari, iOS thật chưa kiểm. Màu tô cú pháp (backtick, `::`) chỉ kiểm ở tầng parser, chưa so màu trên màn hình.
Phát sinh:
- Route `/[locale]/e2e-editor` là route thử, phải chặn ở SP013 trước khi phát hành.
- `@codemirror/language` và `@lezer/highlight` được import trực tiếp nhưng chỉ là phụ thuộc gián tiếp, chưa khai báo trong `web/package.json`. Phiên chính thêm khi có dịp.
- Chạy cả bộ Playwright làm đổi ảnh `anh-vi-1440.png` của Task020 (ảnh bị ghi đè mỗi lần chạy), nên Task020 nên ghi ảnh ra chỗ không bị theo dõi hoặc so sánh có kiểm soát.
Việc tiếp theo cần biết: Marker lỗi được giữ qua các thay đổi trong ô, nhưng thành phần cha phải tự bỏ `error` khi người dùng sửa (Task032). Nội dung đổi từ ngoài (nạp mẫu) không gọi `onChange`. Tải Vercel thật chưa đo chunk.
