# BIÊN BẢN BÀN GIAO TASK 143

- **Story:** STR099 - Mã hóa snapshot vào URL
- **Epic:** SP022 - Chia sẻ Snapshot qua URL
- **Người thực hiện:** Amelia (Senior Software Engineer subagent)
- **Người review độc lập:** Task-reviewer (Independent Reviewer subagent)
- **Trạng thái:** HOÀN THÀNH 100% - ĐÃ NGHIỆM THU PASS VÒNG 1
- **Thời điểm nghiệm thu:** 2026-11-19

---

## 1. Mục tiêu & Hợp đồng kỹ thuật
Hiện thực hóa module Codec Snapshot phục vụ tính năng chia sẻ workspace qua URL fragment (`#...`) hoàn toàn ở client-side, 0 byte gửi lên máy chủ:
- **Hợp đồng `SnapshotV1`:**
  ```ts
  export interface SnapshotV1 {
    v: 1;
    project: { name: string; engine: "postgres" | "mysql" | "sqlite" };
    tabs: { name: string; sql: string }[];
  }
  ```
- **Hàm cốt lõi:**
  - `encodeSnapshot(snapshot: SnapshotV1): Promise<string>`
  - `decodeSnapshot(payload: string): Promise<SnapshotV1>`
- **Nén & Mã hóa:**
  - JSON sắp xếp thuộc tính theo alphabet bằng `canonicalJsonStringify`.
  - Nén bằng `CompressionStream("gzip")` chuẩn Web Streams.
  - Zero-out timestamp MTIME trong gzip header bảo đảm tính tất định 100% (cùng dữ liệu cho ra cùng 1 chuỗi).
  - Base64url an toàn cho URL (thay `+` bằng `-`, `/` bằng `_`, lược bỏ padding `=`).
- **Khống chế kích thước:**
  - `SNAPSHOT_HARD_LIMIT_BYTES = 32 * 1024` (32.768 bytes độ dài URL fragment). Vượt quá thì ném `SNAPSHOT_TOO_LARGE`.
  - `SNAPSHOT_WARN_LIMIT_BYTES = 8 * 1024` (8.192 bytes): hàm `isSnapshotWarnSize` cảnh báo UI khi dán link vào ứng dụng chat.
- **Fallback:**
  - Tự động fallback sang dạng uncompressed với tiền tố `u.` khi môi trường thiếu `CompressionStream`.

---

## 2. Danh sách file thay đổi
1. `web/src/modules/share/snapshot.ts`: Định nghĩa kiểu `SnapshotV1`, hằng số giới hạn 32KB/8KB, lớp lỗi `SnapshotError`, `isSnapshotWarnSize`, và bộ kiểm tra cấu trúc `validateSnapshotStructure`.
2. `web/src/modules/share/codec.ts`: Triển khai nén gzip, giải nén, mã hóa base64url, tính tất định MTIME, và cơ chế fallback.
3. `web/src/modules/share/codec.test.ts`: Bộ 23 unit test bao phủ toàn diện AC1–AC6 và các ca biên.

---

## 3. Kết quả nghiệm thu theo tiêu chí (AC)

| Tiêu chí | Mô tả | Kết quả | Bằng chứng kiểm thử |
|---|---|---|---|
| **AC1** | Round-trip giải mã khớp 100%, kể cả tab SQL 200KB | **PASS** | SQL lặp 200KB nén xuống dưới 32KB, phục hồi 100% cấu trúc và nội dung SQL. |
| **AC2** | Tính tất định 100% (Deterministic) | **PASS** | `canonicalJsonStringify` + zero-out MTIME gzip, chạy 10 lần và xáo trộn key đều ra cùng chuỗi byte. |
| **AC3** | Kiểm soát trần kích thước 32KB & cảnh báo 8KB | **PASS** | Payload >32KB ném `SNAPSHOT_TOO_LARGE`. Payload >=8KB kích hoạt `isSnapshotWarnSize`. |
| **AC4** | Bẫy lỗi chuỗi hỏng, cắt cụt, version khác 1 | **PASS** | Chuỗi hỏng/sai base64 ném `SNAPSHOT_CORRUPT`. Version khác 1 ném `SNAPSHOT_VERSION_UNSUPPORTED`. |
| **AC5** | Fallback không nén khi thiếu `CompressionStream` | **PASS** | Mock `CompressionStream = undefined` mã hóa sang dạng uncompressed và giải mã khớp 100%. |
| **AC6** | Phủ đầy đủ AC1–AC5 và các ca biên | **PASS** | Đã test: 100 tabs, SQL chỉ có whitespace, Unicode/emoji tiếng Việt (🇻🇳, 🚀, 🔥), format tiền tố `g.`/`u.`. |

### Ca biên & Ràng buộc kiến trúc
- **Bảo mật & Core Rule 7:** 100% xử lý trong RAM client-side, 0 byte gửi ra mạng.
- **Phạm vi độc lập:** Không sửa đổi DB, không gọi API, hoàn toàn độc lập với các module export của SP021.

---

## 4. Kiểm tra chất lượng bằng máy
- `npx vitest run src/modules/share/codec.test.ts`: 23/23 passed (100%).
- `npm run check:i18n`: PASS (0 errors).
- `npx eslint src/modules/share/`: PASS (0 errors).
- `npx tsc --noEmit`: PASS (0 errors).
- `npm run check`: PASS (1.208 unit tests toàn repo passed).
- `npm run build`: PASS (57/57 static pages compiled thành công).

---

## 5. Kết luận
Task 143 hoàn thành xuất sắc và đã được nghiệm thu độc lập PASS 100%.
Sẵn sàng tích hợp vào `main` và tiếp tục với Task 144 (Giao diện Share Dialog).
