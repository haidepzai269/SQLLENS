# Task048: Cây plan

Thuộc: SP007 / STR031
Mục tiêu: Component hiện tổng quan các bước của plan, kéo được thẻ và di chuyển canvas như sơ đồ bảng, bấm một bước thì mở chi tiết bằng số thật.
Phạm vi: `web/src/modules/plan-runner/plan-tree/**`, `web/src/app/[locale]/e2e-plan/**`, `web/messages/*/plan-tree.json`, `web/e2e/plan-tree.spec.ts`.
Không làm: gắn vào màn hình chính, gọi engine (Task046), sửa `web/src/contracts/plan.ts`.

Hợp đồng:
- `PlanTree({ plan, label }: { plan: Plan; label: EvidenceLabel })`, dùng fixture tự dựng theo kiểu `Plan`.
- Dùng `@xyflow/react`, thẻ shadcn/ui, `@dagrejs/dagre`. Không thêm thư viện. Tải riêng bằng `next/dynamic`. Lưu vị trí ở `sqllens.plan.*`.
- Câu giải thích từng loại bước viết cho người mới, ví dụ Seq Scan là đọc cả bảng từ đầu đến cuối.

Tiêu chí xong:
- AC1: Plan 5 bước: cây đúng cấu trúc, mỗi thẻ hiện `label`, bảng, index, số dòng, số trang. Số nào `undefined` thì hiện "không có", không hiện 0.
- AC2: Bấm một bước mở chi tiết: điều kiện, số dòng ước tính và thật, số trang, câu giải thích. Đóng bằng Esc được, focus quay lại thẻ.
- AC3: `analyzed: false` thì nói rõ đây là ước tính của engine, chưa chạy thật. Nhãn hiện đúng nhãn truyền vào.
- AC4: Không hiện thời gian ở bất kỳ đâu. Không có câu nào hàm ý "thiết kế ổn".
- AC5: Chênh lệch lớn giữa ước tính và thật được đánh dấu bằng chữ, không chỉ màu.
- AC6: Kéo thẻ, di chuyển canvas, zoom, vừa màn hình, xếp lại như Task047. Dưới 560 px cạnh đi theo đường rail bên trái, theo `EXPERIENCE.md`.
- AC7: Bàn phím đi được giữa các bước. Có bản tóm tắt văn bản. Đủ `vi` và `en`. Ở 390 px không cuộn ngang, cụm nút không che thẻ.
- AC8: Chụp ảnh 390 px và 1440 px ở hai ngôn ngữ. `npm run check`, `npm run build`, `npx playwright test --workers=1` đều đạt.

Ca biên: plan một bước; plan sâu 20 tầng; `kind: "other"`; `condition` chứa HTML hiện dạng chữ.
Kiểm tra: `cd web && npm run check && npm run build && npx playwright test --workers=1`
Góc review thêm: giao diện, chạy thử thật, nhãn kết luận.
Đọc thêm: `DESIGN.md`; `EXPERIENCE.md` mục 6; `CLAUDE.md` nguyên tắc 1, 2, 3; bàn giao Task047 nếu đã có.
