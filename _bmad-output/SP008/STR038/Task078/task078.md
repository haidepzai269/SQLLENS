# Task078: Cuộc đua Seq Scan với Index Scan và Cây B-Tree tối

Thuộc: SP008 / STR038
Mục tiêu: Thể hiện trực quan cuộc đua giữa Seq Scan và Index Scan bằng số dòng và số trang đã đọc (không dùng thời gian), và làm cây B-Tree tối đi khi query không dùng được index.
Phạm vi:
- `web/src/modules/btree-reader/race/**` (component thanh cuộc đua `BTreeRace`)
- `web/src/modules/btree-reader/anim/**` (hỗ trợ cờ cây tối `dimmed` / `dark` và giải thích không dùng được index)
- `web/src/modules/btree-reader/view/**` (hỗ trợ style dimmed cho cây B-Tree)
- `web/src/modules/lab/stage/stage.tsx` (tích hợp BTreeRace và chế độ cây tối vào tab B-Tree khi có query / plan)
- `web/src/app/[locale]/e2e-btree-race/**` (trang thử nghiệm độc lập cho test Playwright)
- `web/messages/{vi,en}/btree-anim.json` và `web/messages/{vi,en}/btree.json` (bản dịch song ngữ)
- `web/e2e/btree-race.spec.ts` (test E2E Playwright)

Không làm:
- Dựng cây MySQL thật (STR034).
- So sánh thời gian thực thi mili-giây (vi phạm nguyên tắc cốt lõi số 3).
- Kết luận chủ quan "thiết kế này ổn" (vi phạm nguyên tắc cốt lõi số 2).

Hợp đồng:
- `BTreeRace({ idxPages, seqPages, idxRows, seqRows, noIndex, label }: BTreeRaceProps)`: Component hiển thị hai thanh so sánh trực quan theo tỷ lệ trang thực tế. `maxPages = Math.max(seqPages, idxPages, 1)`. Tỷ lệ thanh `% = (pages / maxPages) * 100`. Nhãn mang đúng một trong các giá trị quy chuẩn (`real` | `sim` | `est`).
- `BTreeDrop` / `BTreeView` nhận thêm prop hoặc trạng thái `dimmed?: boolean`, `dimReason?: string`. Khi `dimmed === true`: toàn bộ node và edge chuyển sang opacity mờ (`opacity: 0.22 - 0.25`), key marker không rơi, hiện thông báo giải thích rõ lý do planner chuyển sang quét toàn bảng.
- Dữ liệu đo thật lấy từ `Plan` (`EXPLAIN (ANALYZE, BUFFERS)`), bao gồm `pagesRead` và `actualRows`.

Tiêu chí xong:
- AC1: Khi query không dùng được index (ví dụ: bọc hàm/biểu thức `WHERE customer_id + 0 = 123`, hoặc `WHERE total > 100` khi không có index tương ứng), cây B-Tree chuyển sang trạng thái tối mờ (`data-dimmed="true"` hoặc lớp mờ), key marker không chạy, khung giải thích hiện thông báo rõ ràng rằng index không được đọc và engine phải quét toàn bộ bảng.
- AC2: Thanh cuộc đua (The Race) hiển thị so sánh trực quan giữa Index Scan và Seq Scan bằng số trang và số dòng đã đọc. Độ rộng hai thanh đúng tỷ lệ thực tế. Trường hợp noindex: thanh Index Scan hiển thị rõ "không dùng được" (`not usable`).
- AC3: Tuyệt đối không hiển thị millisecond (`ms`), microsecond (`µs`) hay thời gian chạy trong component cuộc đua. Có dòng ghi chú khẳng định so sánh bằng số trang đọc, không phải thời gian.
- AC4: Toàn bộ kết luận và số đo từ database thật mang đúng nhãn `Thật` (`real`).
- AC5: Giao diện chuẩn shadcn/ui, co giãn tốt ở cả màn hình desktop 1440px và điện thoại 390px. Hỗ trợ đầy đủ `prefers-reduced-motion` (hiển thị ngay trạng thái tĩnh, không chạy animation liên tục).
- AC6: Song ngữ 100% tiếng Việt và tiếng Anh trong các file messages tương ứng. Không hardcode chuỗi hiển thị.
- AC7: `npm run check` thoát 0, `npm run build` thoát 0, Playwright test `btree-race.spec.ts` đạt 100% trên cả 1440px và 390px.

Ca biên:
- `pagesRead` của cả 2 bằng 0 hoặc 1: tỷ lệ chia không lỗi `NaN` hoặc chia cho 0.
- Bảng rỗng (0 dòng): thanh hiển thị 0 dòng, không sập.
- Cây rất lớn hoặc tỷ lệ chênh lệch cực cao (ví dụ 3 trang vs 50.000 trang): thanh nhỏ vẫn có độ rộng tối thiểu hiển thị được (ví dụ `min-width: 4px` hoặc `min-w-[4px]`) để người dùng thấy vạch.

Kiểm tra:
`cd web && npm run check && npm run build && npx playwright test btree-race.spec.ts`

Góc review thêm:
- Nhãn kết luận (nguyên tắc 1)
- Không dùng thời gian sandbox để so sánh (nguyên tắc 3)
- i18n song ngữ và accessibility (aria-label, role, screen reader)
