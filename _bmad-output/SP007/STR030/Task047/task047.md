# Task047: Sơ đồ bảng

Thuộc: SP007 / STR030
Mục tiêu: Component hiện các bảng, cột, PK, FK, tự xếp, kéo và di chuyển được, dùng tốt trên điện thoại.
Phạm vi: `web/src/modules/plan-runner/schema-diagram/**`, `web/src/app/[locale]/e2e-schema/**`, `web/messages/*/schema-diagram.json`, `web/e2e/schema-diagram.spec.ts`.
Không làm: gắn vào màn hình chính, đọc schema từ engine.

Hợp đồng:
- `SchemaDiagram({ tables }: { tables: TableInfo[] })`, `TableInfo` lấy từ `web/src/modules/data-lab/generate`.
- Dùng `@xyflow/react`, thẻ dùng component shadcn/ui, xếp bằng `@dagrejs/dagre`. Không thêm thư viện. Tải riêng bằng `next/dynamic`.
- Lưu vị trí ở `sqllens.schema.*`, tách bản rộng và bản hẹp, đọc ghi trong `try/catch`.

Tiêu chí xong:
- AC1: 3 bảng có FK: mỗi thẻ hiện cột, kiểu, dấu PK và FK. Đường nối đúng cột. Bố cục tự xếp không chồng thẻ.
- AC2: Kéo thẻ thì đường nối chạy theo. Kéo khoảng trống hoặc giữ Space để di chuyển canvas, cuộn để zoom. Có nút vừa màn hình và xếp lại. Xếp lại luôn về bố cục không chồng.
- AC3: Thả hai thẻ sát nhau thì chữ không đè nhau, cách tối thiểu 8 px, theo EXPERIENCE Y1. Kiểm bằng ảnh chụp.
- AC4: Trên 30 bảng: gom bớt theo một cách có giải thích, không treo. Ghi số đo vào bàn giao.
- AC5: Ở 390 px: cụm nút không che thẻ, đây là lỗi của mẫu HTML phải tránh. Trang không cuộn ngang. Dưới 560 px xếp một cột.
- AC6: Nhớ vị trí sau khi tải lại. `localStorage` bị chặn vẫn chạy.
- AC7: Bàn phím đi được tới các nút. Trình đọc màn hình có bản tóm tắt văn bản các bảng và quan hệ. Đủ `vi` và `en`. Tên bảng có HTML hiện dạng chữ.
- AC8: Chụp ảnh 390 px và 1440 px ở hai ngôn ngữ. `npm run check`, `npm run build`, `npx playwright test --workers=1` đều đạt.

Ca biên: 0 bảng hiện trạng thái rỗng; bảng không có cột; FK tự trỏ; FK trỏ bảng không có trong danh sách.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test --workers=1`
Góc review thêm: giao diện, chạy thử thật.
Đọc thêm: `DESIGN.md`; `EXPERIENCE.md` mục 6 và Y1, Y2; `CLAUDE.md` dòng "Sơ đồ bảng và cây plan"; `BAN_DO_STORY.md` dòng STR030.
