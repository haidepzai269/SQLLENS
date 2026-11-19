# BIÊN BẢN BÀN GIAO TASK 139

- **Story:** STR097 - Xuất ảnh ERD PNG & B-Tree SVG
- **Epic:** SP021 - Export schema & dữ liệu
- **Người thực hiện:** Amelia (Senior Software Engineer)
- **Người review độc lập:** task-reviewer (review độc lập theo `QUY_TRINH.md`, vòng 2 sau khi sửa lỗi)
- **Trạng thái:** HOÀN THÀNH 100% - ĐÃ NGHIỆM THU PASS (sau 1 lỗi phải sửa)
- **Thời điểm nghiệm thu:** 2026-11-19

---

## 1. Mục tiêu & hợp đồng kỹ thuật

Người dùng tải được ảnh sơ đồ bảng sạch, không dính nút điều khiển, để dán vào tài liệu.

- **Hàm:** `captureErdPng({ root?, scale = 2, width?, height?, onProgress? }): Promise<Blob>` tại
  `web/src/modules/export/capture/erd-png.ts`.
- **Tiến trình:** `onProgress(step)` với `"prepare" | "capture" | "encode"`.
- **Mục menu:** thêm vào `<ExportMenu />` — một chỗ duy nhất chứa các mục xuất (hợp đồng Task138).
- **Tên file:** `<tên dự án>-erd-<YYYYMMDD-HHmm>.png`, dùng lại `sanitizeFileName` / `formatExportTimestamp`.
- **Thư viện:** `modern-screenshot@4.7.0` (thêm vào `web/package.json`), import tĩnh trong `export-menu.tsx`.
- **0 byte gửi mạng:** ảnh tạo và tải thuần client-side (Core Rule 7).

## 2. Quyết định thiết kế (và vì sao)

1. **Chụp theo biên nội dung sơ đồ, không theo khung canvas.** Đọc toạ độ thế giới của từng
   `.react-flow__node` (`transform: translate(Xpx, Ypx)` + `width/height`), lấy hình chữ nhật bao + lề 24 px,
   rồi đặt lại `transform` của bản sao về `translate(PAD - minX, PAD - minY) scale(1)`. Hệ quả: ảnh sát sơ đồ
   (AC1), không phụ thuộc pan/zoom của người dùng, tab đang ẩn vẫn có toạ độ thẻ để tính.
2. **Tab sơ đồ đang ẩn: mở layout một nhịp, không nhìn thấy.** `display: none` làm React Flow đo ra 0 px,
   nó dồn thẻ thành một cột và xoá đường nối khoá ngoại khỏi DOM. Trước khi chụp, các tổ tiên đang
   `display: none` được đặt `display: block !important` + `visibility: hidden !important`, chờ layout ổn định,
   chụp, rồi trả nguyên trạng trong `finally`.
3. **Chờ layout ổn định, không chờ "đã có bề rộng"** — xem mục 5, đây là lỗi vòng 1.
4. **Bản sao gắn vào khung off-screen** (`left: -100000px`) có kích thước xác định, nên việc chụp không phụ
   thuộc layout của tab đang hiện.
5. **Lọc trước khi chụp:** bỏ `.react-flow__minimap`, `.react-flow__controls`, `.react-flow__panel`,
   `.react-flow__attribution`, `.react-flow__handle` (`pruneCaptureClone`, xuất ra để kiểm thử được).
6. **Nền ảnh lấy từ `background-color` thật của canvas** → PNG không trong suốt, dán vào tài liệu nền trắng vẫn đọc được.
7. **Chặn cạnh 16.384 px và tổng 100 M điểm ảnh** (`planScale`). Không bao giờ cắt bớt sơ đồ để vừa giới hạn;
   hạ độ nét trước, dưới 1x thì từ chối kèm mã `too_large`.
8. **`saveBlob` dùng chung** cho cả `.sql` và `.png`, `revokeObjectURL` hoãn 1 giây.
9. **`lastStatus` → `lastNotice`:** live region đọc đúng câu lỗi thật (`pngNotFound` / `pngFailed`) thay vì
   luôn đọc "Xuất file thất bại" — sửa luôn một chỗ mù của Task138.

## 3. File thay đổi

| File | Nội dung |
|---|---|
| `web/src/modules/export/capture/erd-png.ts` | Mới. `captureErdPng`, `contentBounds`, `planScale`, `pruneCaptureClone`, `ErdCaptureError`, `waitForLayout` |
| `web/src/modules/export/capture/erd-png.test.ts` | Mới. 14 test |
| `web/src/modules/export/components/export-menu.tsx` | Mục PNG, tiến trình 3 bước, `getErdFileName`, `saveBlob`, `lastNotice` |
| `web/src/modules/export/components/export-menu.test.tsx` | +6 test cho mục PNG (tên file, tiến trình, lỗi, disable, en) |
| `web/messages/{vi,en}/export.json` | `png`, `pngDescription`, `pngDone`, `pngFailed`, `pngNotFound`, `pngStep.*` |
| `web/package.json`, `web/package-lock.json` | `modern-screenshot@4.7.0` |

## 4. Kết quả nghiệm thu theo tiêu chí (AC)

| Tiêu chí | Mô tả | Kết quả | Bằng chứng |
|---|---|---|---|
| **AC1** | PNG không có minimap, không nút zoom, không viền thừa | **PASS** | `erd-dark.png` 1232×612 = (568+48)×(258+48)×2 — đúng biên nội dung + lề 24 px mỗi bên; test `pruneCaptureClone` + `AC1 + AC2` |
| **AC2** | Ảnh đúng độ phân giải scale 2 | **PASS** | Mặc định `scale: 2` (test khẳng định `options.scale === 2`); ảnh 1232×612 so với khung CSS 616×306 |
| **AC3** | Sơ đồ 50 bảng xuất xong, UI phản hồi, có tiến trình | **PASS** | Chrome thật: 50 node / 49 edge, chụp **1.399 ms**, ảnh 16.295×89 px (`erd-50-tables.png`), tiến trình 3 bước hiện trong mục menu + live region |
| **AC4** | Tab sơ đồ đang ẩn vẫn chụp ra ảnh đúng, không ra ảnh trắng | **PASS (sau khi sửa)** | Chrome thật: ảnh khi tab ẩn **trùng khít** ảnh khi tab hiện — 1232×612, 569 màu, 4,0% mực (`erd-hidden.png`). Xem mục 5 |
| **AC5** | Theme sáng và tối đều đọc được | **PASS** | `erd-one-table-light.png` (nền `rgb(241,242,244)`, nhãn PK/TEXT rõ) và `erd-dark.png` (nền `rgb(14,14,16)`) |
| **AC6** | Không request mạng nào, ảnh không rời máy | **PASS** | Test chặn `fetch`; chạy Chrome thật không có `POST/PUT/PATCH/DELETE` nào lên `/api/*` |

### Ca biên

| Ca | Kết quả |
|---|---|
| Sơ đồ 1 bảng | `erd-one-table-light.png` — lề 24 px đều, không viền thừa |
| Tab sơ đồ ẩn (`display: none`) | Ảnh giống hệt lúc hiện (sau khi sửa) |
| Zoom 30% / 200% | `erd-zoom-in.png` / `erd-zoom-out.png` cùng kích thước ảnh gốc — ảnh không phụ thuộc zoom |
| Màn hình 390 px | Xuất từ tab **Simulation** (Stage) của layout dọc: PNG 592×648 `erd-mobile-390.png`, 0 px tràn ngang |
| Sơ đồ 50 bảng | 16.295×89 px, scale hạ còn 1.00x (xem hạn chế 3) |
| Schema rỗng | Mục PNG `disabled` + tooltip `disabledEmpty` |
| Nén ảnh thất bại | Ném `failed`, khung off-screen vẫn được dọn |

## 5. Lỗi tìm thấy khi review và cách sửa

**Lỗi (AC4, bắt được trên Chrome thật):** khi tab Sơ đồ đang ẩn, `waitForLayout` cũ chỉ chờ "canvas có bề
rộng + `.react-flow__edge` đã quay lại DOM" rồi chụp ngay. Nhưng bề rộng có ngay khi CSS đổi, còn **vị trí thẻ**
phải qua thêm một vòng React: `narrow` còn `true` từ lúc khung rộng 0 px, nên ảnh ra **bố cục cột dọc**
(**592×844**, mất đường nối FK) trong khi ảnh lúc tab hiện là **1232×612**. Test unit cũ mô phỏng đúng kết quả
mong muốn nên không bắt được; phải chụp thật mới thấy.

**Sửa:** `waitForLayout` giờ chờ **layout ổn định** — dấu vân tay `layoutSignature` (biên thẻ + số đường nối)
phải không đổi 6 nhịp liền (≈96 ms) trong ngân sách 1.500 ms; đổi layout là đếm lại từ đầu. Thêm điều kiện
`revealLayout` trả số lớp đã mở (không mở được lớp nào thì không chờ vô ích), và chấp nhận thẻ có `style.width`
để phép đo không phụ thuộc `offsetWidth`. Kèm **1 unit test hồi quy** dựng đúng kịch bản: hai thẻ xếp cột lúc ẩn,
48 ms sau mới về bố cục 2 chiều, khẳng định ảnh dùng biên của bố cục 2 chiều.

Ảnh bằng chứng: `erd-50-tables.png`, `erd-dark.png`, `erd-hidden.png`, `erd-one-table-light.png`,
`erd-zoom-in.png`, `erd-zoom-out.png`, `erd-mobile-390.png`, `erd-mobile-390-canvas.png`; số đo `png-measure.json`.

## 6. Kiểm tra bằng máy

- `npm run check`: **PASS** — 102 file test pass (2 file skip), **1.228 test PASS**, 18 skip; lint 0 error, `tsc --noEmit` sạch.
  - Ghi chú trung thực: lần chạy đầu của cùng bản code có **2 test timeout** (`panel-toggles`, `ai-copilot`) kèm lỗi
    `Failed to start forks worker` — máy bị nghẽn tiến trình, không phải lỗi logic: chạy riêng 2 file đó PASS
    25/25 và lần chạy `npm run check` thứ hai PASS sạch (không đổi một dòng code nào giữa hai lần).
- `npx vitest run src/modules/export/capture/erd-png.test.ts`: **14/14 PASS**.
- `npx vitest run src/modules/export/components/export-menu.test.tsx`: **28/28 PASS**.
- `next build` (Turbopack, `API_ORIGIN`): **PASS**.
- Playwright trên Chrome thật (spec tạm, đã xoá sau khi đo): 50 bảng, tab ẩn, 390 px — tất cả PASS.

## 7. Hạn chế & việc còn lại (nói rõ, không giấu)

1. **Sơ đồ rất rộng bị hạ độ nét.** Chuỗi 50 bảng rộng ~16.300 px CSS nên ảnh ra ở **1.00x** (16.295×89 px)
   thay vì 2x, để không vượt cạnh canvas 16.384 px. Không cắt bớt bảng nào, nhưng **người dùng không được báo**
   là ảnh đã hạ độ nét — cần một thông báo khi `planScale < scale` (đề xuất đưa vào SP999).
2. **Sơ đồ quá lớn bị từ chối** (mã `too_large`) nhưng UI chỉ hiện câu chung `pngFailed`; chưa có chuỗi riêng
   kiểu "sơ đồ quá lớn để chụp" (SP999).
3. **Bundle:** `modern-screenshot` nằm trong chunk `0bxz40azyxj-7.js` (222 KB min / **69 KB gzip**); riêng thư
   viện ~**14 KB gzip**. Chấp nhận được cho route Lab, nhưng nên `dynamic import` trong `handleDownloadPng`
   nếu sau này cần nhẹ hơn (SP999, không chặn task).
4. **Tab ẩn bị sửa DOM ~100–1.500 ms** (`display`/`visibility` rồi trả lại). Không nhìn thấy được, nhưng nếu
   React render xen vào đúng lúc đó thì tab có thể bị vẽ lại một lần.
5. **Lỗi có sẵn của sơ đồ ở 390 px (không thuộc Task139):** trên layout dọc, đường nối FK bị vẽ ở `x ≈ -4`
   (ra ngoài khung) nên mắt thường không thấy đường nối; ảnh PNG phản ánh đúng những gì đang hiện trên màn hình
   (`erd-mobile-390-canvas.png`). Cần đưa vào SP999.
6. **`planScale` hạ độ nét im lặng** — xem hạn chế 1.

## 8. Kết luận

Task 139 đã được review độc lập, một lỗi AC4 thật đã được sửa và có test hồi quy, `npm run check` PASS
1.228 test, ảnh bằng chứng đo trên Chrome thật cho cả 6 AC. **ĐÓNG TASK 139.**
Story STR097 còn **Task 140** (xuất cây B-Tree thành SVG vector).
