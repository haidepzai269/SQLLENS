# BIÊN BẢN BÀN GIAO TASK 138

- **Story:** STR096 - Xuất DDL schema theo dialect
- **Epic:** SP021 - Export schema & dữ liệu
- **Người thực hiện:** Amelia (Senior Software Engineer subagent)
- **Người review độc lập:** Task-reviewer (Independent Reviewer subagent)
- **Trạng thái:** HOÀN THÀNH 100% - ĐÃ NGHIỆM THU PASS VÒNG 1
- **Thời điểm nghiệm thu:** 2026-11-17

---

## 1. Mục tiêu & Hợp đồng kỹ thuật
Hiện thực hóa Menu Export tập trung duy nhất cho dự án, cho phép người dùng tải về file DDL `.sql` bằng một cú bấm:
- **Component:** `<ExportMenu engine={...} tables={...} projectName={...} disabled={...} />` tại `web/src/modules/export/components/export-menu.tsx`.
- **Tên file tải về:** `<tên dự án>-schema-<YYYYMMDD-HHmm>.sql` (làm sạch ký tự cấm `/\:*?"<>|`, hỗ trợ tiếng Việt có dấu, fallback `sqllens`).
- **i18n:** Song ngữ Anh/Việt đầy đủ trong `web/messages/{vi,en}/export.json`.
- **0 Byte gửi mạng:** Tải thuần client-side qua Blob `application/sql`, tuân thủ tuyệt đối Core Rule 7.
- **Responsive & Trợ năng:**
  - Desktop: Popover dropdown neo góc phải thanh Stage header.
  - Mobile (390px): Bottom Sheet có backdrop mờ và focus trap, không che nút Run.
  - Bàn phím: Mở bằng Enter/Space/ArrowDown, đóng bằng Escape, trap focus bằng Tab, live region thông báo trạng thái.

---

## 2. Danh sách file thay đổi
1. `web/messages/vi/export.json`: Bản dịch tiếng Việt các key (`title`, `sql`, `disabledEmpty`, `done`, `failed`, `exporting`, `sheetTitle`, `close`, v.v.).
2. `web/messages/en/export.json`: Bản dịch tiếng Anh tương ứng 1-1, đồng bộ cấu trúc.
3. `web/src/modules/export/components/export-menu.tsx`: Linh kiện Menu Export tập trung, tự động chuyển đổi `TableInfo[]` sang `TableSpec[]`, bóc tách khóa ngoại, tích hợp serializer Task 137, xử lý responsive sheet/popover.
4. `web/src/modules/export/components/export-menu.test.tsx`: Bộ 22 unit test bao phủ toàn diện AC1–AC6 và các ca biên.
5. `web/src/modules/lab/stage/stage.tsx`: Tích hợp `<ExportMenu />` vào thanh header của Stage, chia sẻ catalog cache giữa `SchemaTab` và `ExportMenu`.

---

## 3. Kết quả nghiệm thu theo tiêu chí (AC)

| Tiêu chí | Mô tả | Kết quả | Bằng chứng kiểm thử |
|---|---|---|---|
| **AC1** | Tải file `.sql` đúng tên, nội dung khớp `serializeSchema` | **PASS** | Tên file `<dự án>-schema-<YYYYMMDD-HHmm>.sql`, nội dung khớp serializer từng engine (Postgres `"`, MySQL `` ` ``, SQLite inline FK). |
| **AC2** | Schema rỗng thì mục `.sql` bị disabled kèm tooltip | **PASS** | Khi `tables.length === 0`, nút bị `disabled={true}`, tooltip và phụ đề hiển thị `export.disabledEmpty`. |
| **AC3** | Trạng thái đang xuất & thông báo xong/lỗi | **PASS** | Icon xoay `export.exporting`, thông báo toast `export.done` hoặc `export.failed`, kèm live region trợ năng. |
| **AC4** | Bàn phím & trợ năng aria-label | **PASS** | Enter/Space/ArrowDown mở, Esc đóng và trả focus, Tab trap focus, đầy đủ `aria-haspopup="dialog"` và `aria-expanded`. |
| **AC5** | Mobile 390px mở dạng sheet, không che nút Run | **PASS** | Mobile hiển thị Bottom Sheet cố định đáy có backdrop, desktop hiển thị popover góc phải Stage header. |
| **AC6** | Không có request mạng nào khi xuất | **PASS** | Giám sát cả `fetch` và `XMLHttpRequest`: 0 network call, 100% xử lý client-side qua Blob (Core Rule 7). |

### Ca biên (Edge cases)
- Tên dự án 100 ký tự: Giữ nguyên độ dài hợp lệ.
- Tên có `/` và dấu tiếng Việt (`Dự án / Quản lý <Kho>`): Làm sạch thành `Dự-án-Quản-lý-Kho`.
- Bấm xuất 2 lần liên tiếp: Chặn race condition bằng cờ `isExporting`, chỉ 1 file tải về.
- Đang chạy query: Nút disabled theo cờ `working` của Stage.

---

## 4. Kiểm tra chất lượng bằng máy
- `npx vitest run src/modules/export/components/export-menu.test.tsx`: 22/22 passed (100%).
- `npm run check:i18n`: PASS (0 errors).
- `npm run check`: 1.182 passed, 18 skipped (100 test files).
- `npm run build`: PASS (57/57 static routes compiled thành công).

---

## 5. Kết luận
Task 138 hoàn thành xuất sắc và đã được nghiệm thu độc lập PASS 100%.
**CHÍNH THỨC HOÀN TẤT 100% TOÀN BỘ STORY STR096!**
Sẵn sàng tiếp tục với Story STR097 (Task 139 - Xuất ERD thành PNG).
