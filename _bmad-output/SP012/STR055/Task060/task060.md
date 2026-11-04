# Task060: Chạy thử SQL do AI đề xuất

Thuộc: SP012 / STR055
Mục tiêu: Mỗi khối SQL trong câu trả lời của AI được chạy thử không đổi dữ liệu trước khi hiển thị. Khối lỗi hoặc không được phép thì không hiện SQL đó.
Phạm vi: `web/src/modules/mentor/verify/**`, `web/messages/{vi,en}/mentorVerify.json`.
Không làm: giao diện, áp dụng thật đề xuất, adapter MySQL, sửa `web/src/engines/**` (nếu buộc phải sửa thì sửa tối thiểu và ghi vào bàn giao).

Hợp đồng:
- `verifyAnswer(adapter: Pick<EngineAdapter, "engine" | "explain" | "tryChange">, answer: string, options: { probe?: string; signal?: AbortSignal }): Promise<VerifiedAnswer>`.
- `VerifiedAnswer = { parts: VerifiedPart[]; hiddenCount: number }`. `VerifiedPart` là `{ kind: "text"; text }` hoặc `{ kind: "sql"; sql; outcome: Conclusion<...> }`. Khối bị loại không xuất hiện trong `parts`, ở đúng chỗ đó có `{ kind: "hidden"; reasonKey }` không chứa SQL gốc.
- Danh sách câu cho phép, kiểm bằng `parseSql` có sẵn và mỗi khối đúng một câu: `SELECT` chạy thử bằng `explain`; `CREATE INDEX` và `ALTER TABLE` chạy thử bằng `tryChange(sql, probe)`. Không có `probe` thì hai loại này là `hidden`. Mọi loại khác là `hidden`, gồm `DO`, `CALL`, `DROP`, `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`, `COPY`, `SET`, `CREATE FUNCTION`, `CREATE ROLE`, `GRANT`.
- Lý do chặt hơn SQL người dùng: rủi ro `DO` với `EXECUTE` thoát role đã được chấp nhận cho SQL của chính người dùng (Task021), không áp cho SQL do AI sinh ra.
- `adapter.engine` khác `postgres`: mọi khối SQL là `hidden`, `reasonKey` là chưa mô phỏng được. Không đoán.

Tiêu chí xong:
- AC1: Câu trả lời có một `CREATE INDEX` đúng và `probe`: khối được giữ, nhãn `real`, có số trang trước và sau. Checksum bảng, danh sách index và `history()` không đổi.
- AC2: `SELECT` sai tên cột: thành `hidden`, trong JSON kết quả không còn chuỗi SQL đó hay thông báo lỗi chứa SQL đó.
- AC3: Mỗi loại bị chặn ở trên đều có test, không đụng tới adapter (fake đếm số lần gọi bằng 0). Khối có hai câu, ví dụ `SELECT 1; DROP TABLE t`, bị chặn.
- AC4: `SELECT set_config('role', 'postgres', false)`, `SELECT pg_read_file('/etc/passwd')`, `SELECT nextval('s')`, `SELECT pg_advisory_lock(1)`, `SELECT lo_import('/etc/passwd')` chạy trên adapter thật: không làm đổi role của phiên, không để lại khóa, không tiến sequence, và không được hiện. Có lớp nào không chặn được thì chặn thêm bằng parser và báo trong bàn giao.
- AC5: Văn bản ngoài khối SQL giữ nguyên thứ tự. Khối có nhãn `sql`, `pgsql`, `postgresql`, `postgres`, `mysql` hoặc không có nhãn đều được xem là SQL. Khối chưa đóng tính đến hết câu trả lời. Khối ngôn ngữ khác giữ nguyên là text.
- AC6: `tryChange` hoặc `explain` ném lỗi, hết giờ, hoặc `signal` hủy: khối là `hidden`, hàm không ném lỗi ra ngoài trừ khi bị hủy, các khối sau không chạy khi đã hủy. Tối đa 5 khối được chạy thử cho một câu trả lời, phần còn lại là `hidden`.
- AC7: `npm run check` thoát 0.

Ca biên: không có khối nào; khối rỗng; ba dấu backtick trong chuỗi SQL; chú thích che giấu câu thứ hai; `EXPLAIN` lồng; phiên đang có transaction mở của người dùng.
Kiểm tra: `cd web && npm run check`. Không cần chạy Playwright.
Góc review thêm: bảo mật, nhãn kết luận, nguyên tắc 6 và 8 trong `CLAUDE.md`, dòng "Rủi ro thoát role trong PGlite".
Đọc thêm: `_bmad-output/SP003/STR015/Task025/ban_giao_task025.md`; `web/src/engines/postgres/guard.ts`; `web/src/modules/sql-intake/parser/`.
