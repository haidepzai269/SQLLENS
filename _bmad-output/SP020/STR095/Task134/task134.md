# Task134: Nhập file `.sqlite` / `.db` vào vùng nhớ WASM

Thuộc: SP020 / STR095
Mục tiêu: Người dùng mở được database SQLite có sẵn trên máy mà file không rời khỏi trình duyệt.

Phạm vi:
- `web/src/engines/sqlite/import-file.ts`
- `web/src/engines/sqlite/import-file.test.ts`
- `web/src/modules/workspace/components/sqlite-file-panel.tsx`
- `web/messages/vi/labStage.json`, `web/messages/en/labStage.json`

Không làm:
- Không upload file lên server.
- Không sửa adapter (Task132).
- Không làm xuất file (Task135).

Hợp đồng:
- `importSqliteFile(file: File, adapter: EngineAdapter): Promise<{ tables: string[]; bytes: number }>`
- Giới hạn cứng `MAX_IMPORT_BYTES = 50 * 1024 * 1024`.
- Lỗi có mã: `FILE_TOO_LARGE`, `NOT_SQLITE`, `IMPORT_FAILED`.

Tiêu chí xong:
- AC1: Chọn file `.sqlite`/`.db` hợp lệ thì nạp vào FS của WASM, liệt kê đúng tên bảng.
- AC2: Sau khi nạp, chạy `SELECT` trên bảng đó trả dữ liệu thật của file.
- AC3: File > 50MB bị chặn trước khi đọc, thông báo rõ; file không phải SQLite báo `NOT_SQLITE`, không treo tab.
- AC4: 0 request upload (kiểm network log); file không xuất hiện trong bất kỳ payload nào.
- AC5: Có trạng thái đang nạp, có nút hủy, UI phản hồi trong lúc đọc file 40MB.
- AC6: Đủ vi/en, dùng được ở 390px.

Ca biên: file 0 byte; file SQLite mã hóa; file có 500 bảng; chọn cùng file hai lần; đổi sang engine Postgres giữa lúc đang nạp.
Giao diện: trạng thái rỗng/đang nạp/lỗi/thành công đủ 4; thông báo lỗi nêu đúng mã.
Kiểm tra: `npm run check` và `npx vitest run web/src/engines/sqlite/import-file.test.ts`.
Góc review thêm: bảo mật (file không rời máy), giao diện vi/en.
Đọc thêm: `_bmad-output/SP020/STR094/Task132/task132.md`.
