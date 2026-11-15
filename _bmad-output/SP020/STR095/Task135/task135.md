# Task135: Xuất file `.sqlite` từ sandbox

Thuộc: SP020 / STR095
Mục tiêu: Người dùng lấy được database đã sửa về máy, để mang sang công cụ khác hoặc lưu lại.

Phạm vi:
- `web/src/engines/sqlite/export-file.ts`
- `web/src/engines/sqlite/export-file.test.ts`
- `web/src/modules/workspace/components/sqlite-file-panel.tsx`

Không làm:
- Không xuất sang định dạng khác (`.sql` thuộc SP021 Task136–138).
- Không ghi file ra ngoài vùng nhớ WASM.
- Không nén file.

Hợp đồng:
- `exportSqliteFile(adapter: EngineAdapter, filename: string): Promise<Blob>`
- Tên mặc định `<tên dự án>-<YYYYMMDD-HHmm>.sqlite`, làm sạch ký tự không hợp lệ.

Tiêu chí xong:
- AC1: Xuất file sau khi tạo bảng và chèn dữ liệu; tải về đúng tên, đúng định dạng.
- AC2: File xuất ra nhập lại qua `importSqliteFile` thì đọc được đủ bảng và đúng số dòng (test vòng tròn).
- AC3: Xuất khi sandbox rỗng vẫn ra file hợp lệ mở được, không lỗi.
- AC4: Không có request mạng nào khi xuất.
- AC5: Có trạng thái đang xuất và thông báo xong (vi/en).

Ca biên: tên dự án có dấu tiếng Việt và ký tự `/`; dữ liệu 40MB; bấm xuất 3 lần liên tiếp.
Giao diện: nút Xuất file nằm cạnh nút Nhập, disable khi engine không phải SQLite, có tooltip giải thích.
Kiểm tra: `npm run check` và `npx vitest run web/src/engines/sqlite/export-file.test.ts`.
Góc review thêm: đúng yêu cầu, giao diện vi/en.
Đọc thêm: `_bmad-output/SP020/STR095/Task134/task134.md`.
