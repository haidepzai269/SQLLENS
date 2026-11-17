# Bàn giao Task135

Đã làm: nút Xuất lấy toàn bộ database đang mở trong sandbox SQLite thành file `.sqlite` tải về máy, tên mặc định `<tên dự án>-<YYYYMMDD-HHmm>.sqlite`, có trạng thái "đang xuất" và thông báo xong kèm dung lượng. Không nén, không đổi định dạng, không ghi ra ngoài vùng nhớ WASM.

Cách làm: thêm `exportDatabase(): Promise<Uint8Array>` vào `SqliteAdapter` và message `export` vào protocol; worker gọi `sqlite3_serialize` trên handle đang mở rồi copy byte ra khỏi heap WASM, main thread bọc thành `Blob` (`application/vnd.sqlite3`) và tải bằng object URL. **Cố ý không dùng `VACUUM INTO`**: SQLite ghi file vào FS ảo, đường đó đã bị rào chắn Task133 chặn cho SQL người dùng, và nó tạo bản đã dọn chứ không phải bản sao nhị phân của database. DB rỗng vẫn serialize ra file 8.192 byte hợp lệ (đã đo), nên AC3 không cần đường đặc biệt.

File chính:
- `web/src/engines/sqlite/export-file.ts` (`SQLITE_MIME`, `sqliteExportName`, `ensureSqliteName`, `exportSqliteFile` → `Blob & { name }`)
- `web/src/engines/sqlite/{adapter,worker,protocol}.ts` (`exportDatabase`, `sqlite3_serialize`, message `export`)
- `web/src/modules/workspace/components/sqlite-file-panel.tsx` (nút Xuất cạnh nút Nhập, tự tắt khi engine không phải SQLite)
- `web/messages/{vi,en}/labStage.json`

Kết quả kiểm tra (chạy thật):
- `npx vitest run web/src/engines/sqlite/export-file.test.ts`: 8/8 PASS (định dạng tên `20261117-0905`, tên có dấu tiếng Việt và ký tự `/ : * ? " < > |`, tên rỗng, `.db` → `.db.sqlite`, Blob đúng MIME và giữ nguyên từng byte, sandbox rỗng 8.192 byte, adapter lỗi thì lỗi đi thẳng ra ngoài).
- `npx vitest run web/src/engines/sqlite/adapter.test.ts`: 12/12 PASS; test vòng tròn trên WASM thật: tạo bảng + chèn 2 dòng → `serialize()` → nạp vào session mới → `SELECT` ra đúng `An`/`Bình` (đúng AC2 không cần mock).
- `npm run check`: PASS, 1.147 test pass / 18 skip; lint chỉ còn 1 warning có sẵn ở `e2e/plan-explain.spec.ts`.
- `API_ORIGIN=http://127.0.0.1:8080 npx next build`: PASS.
- `npx playwright test e2e/sqlite.spec.ts` (Chrome thật, bản build): 6/6 PASS. Test Task135: bấm Xuất → sự kiện `download` với tên đuôi `.sqlite` → đọc 16 byte đầu của file tải về đúng `SQLite format 3\0` → nạp lại chính file đó qua `importSqliteFile`, đếm lại đúng 2 dòng; không có request mạng nào ngoài `/api/me`.

Kết quả review: Chưa gọi reviewer độc lập trong phiên này; cần reviewer đọc diff trước khi merge.

Chưa làm được: chưa đo xuất file 40MB trên trình duyệt thật (chỉ test vòng tròn với DB nhỏ; `sqlite3_serialize` copy một lần nên bộ nhớ đỉnh xấp xỉ 2 lần dung lượng DB); chưa có lựa chọn tên file trong hộp thoại (tên do hệ thống đặt theo tên dự án); bấm Xuất 3 lần liên tiếp thì tạo 3 lần tải (không khoá nút sau lần đầu, mỗi lần vẫn đúng dữ liệu).

Phát sinh cần đưa vào SP999: tên dự án trùng nhau sẽ ra tên file gần giống nhau, chỉ khác phút; nếu cần phân biệt thì thêm giây vào tên.

Việc tiếp theo cần biết: `exportSqliteFile` trả `Blob & { name }` để chỗ tải về không phải chuẩn hoá tên lần hai. `sqlite3_serialize` trả con trỏ phải `sqlite3_free` sau khi copy, nếu quên là rò rỉ heap WASM mỗi lần xuất.
