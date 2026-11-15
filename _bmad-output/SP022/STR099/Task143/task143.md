# Task143: Codec snapshot: JSON → gzip → base64url, có version và trần kích thước

Thuộc: SP022 / STR099
Mục tiêu: Biến một workspace thành chuỗi đặt được vào fragment URL và giải ngược lại chính xác, không cần máy chủ.

Phạm vi:
- `web/src/modules/share/snapshot.ts`
- `web/src/modules/share/codec.ts`
- `web/src/modules/share/codec.test.ts`

Không làm:
- Không gọi API, không lưu DB.
- Không mã hóa bảo mật (không phải encrption; đây là nén).
- Không làm UI (Task144).

Hợp đồng:
- `type SnapshotV1` đúng như `_bmad-output/SP022/README.md`.
- `encodeSnapshot(snapshot: SnapshotV1): Promise<string>` trả base64url không có `+`, `/`, `=`.
- `decodeSnapshot(payload: string): Promise<SnapshotV1>`
- `SNAPSHOT_HARD_LIMIT_BYTES = 32 * 1024` (độ dài chuỗi sau mã hóa), `SNAPSHOT_WARN_LIMIT_BYTES = 8 * 1024`.
- Lỗi có mã: `SNAPSHOT_TOO_LARGE`, `SNAPSHOT_CORRUPT`, `SNAPSHOT_VERSION_UNSUPPORTED`.
- Dùng `CompressionStream("gzip")` có sẵn của trình duyệt; nếu không có thì fallback không nén và ghi cờ `n: 0` trong header chuỗi.

Tiêu chí xong:
- AC1: `decodeSnapshot(await encodeSnapshot(s))` trả lại đúng `s`, kể cả tab có SQL 200KB.
- AC2: Cùng snapshot cho ra cùng chuỗi (khóa được sắp xếp, không timestamp).
- AC3: Chuỗi vượt 32KB ném `SNAPSHOT_TOO_LARGE` trước khi tạo URL; từ 8KB trở lên trả cờ cảnh báo cho UI.
- AC4: Chuỗi hỏng, cắt cụt, hoặc version khác 1 ném đúng mã lỗi, không treo.
- AC5: Fallback không nén hoạt động khi `CompressionStream` bị giả lập là undefined, và giải mã vẫn đúng.
- AC6: Unit test phủ AC1–AC5.

Ca biên: snapshot 100 tab; SQL chỉ có khoảng trắng; ký tự Unicode và emoji trong tên tab; payload rỗng; payload có ký tự base64 không hợp lệ.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/share/codec.test.ts`.
Góc review thêm: đúng logic, test thật; kiểm `CompressionStream` trên Safari thật nếu có máy.
Đọc thêm: `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 5 (STR099).
