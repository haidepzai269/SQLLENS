# Task057: Màn hình Capacity Advisor

Thuộc: SP010 / STR047
Điều kiện bắt đầu: Task055 đã merge.
Mục tiêu: Kéo thanh quy mô thì thấy số tầng, dung lượng index và số trang đọc, nhãn đổi từ Thật sang Ước lượng đúng lúc vượt 500k.
Phạm vi: `web/src/modules/what-if/capacity-ui/**`, `web/src/app/[locale]/e2e-capacity/**`, `web/messages/{vi,en}/capacityUi.json`, `web/e2e/capacity.spec.ts`.
Không làm: gắn vào vùng `stage` của màn hình chính (task riêng), AI giải thích (SP012), QPS, độ trễ.

Hợp đồng: `<CapacityPanel adapter={...} index={string} table={string} probe?={string} />`. Dùng `measureCapacity`, `samplePoint`, `estimateCapacity`, component cây của Task040, thẻ shadcn/ui.

Tiêu chí xong:
- AC1: Các mốc 10k, 100k, 500k dùng số đo thật, nhãn Thật. Đo mốc nào thì nạp dữ liệu mốc đó bằng đường sinh dữ liệu có sẵn, có tiến trình và nút hủy, 500k có cảnh báo RAM theo quyết định trong `CLAUDE.md`. Dữ liệu người dùng không bị xóa: nếu đường có sẵn không làm được thì dừng và báo trong bàn giao.
- AC2: Kéo qua 500k, nhãn đổi thành Ước lượng ngay, số lấy từ `estimateCapacity`, không chạy thật. Kéo về thì nhãn và số trở lại đúng.
- AC3: Khi số tầng tăng, cây hiện thêm tầng, có animation, tôn trọng giảm chuyển động. Cây ước lượng được thể hiện khác cây thật và không vẽ node giả như thể đã đọc.
- AC4: `NotSimulated` hiện lý do, không hiện số 0.
- AC5: Không có QPS, độ trễ, thời gian trên màn hình.
- AC6: `npm run check`, `npm run build` thoát 0, `web/e2e/capacity.spec.ts` đạt với `--workers=1`. Test đọc số trên màn hình đối chiếu với kết quả gọi trực tiếp, không chỉ kiểm có phần tử.

Giao diện: trạng thái đang đo, chưa đo, lỗi, hủy. Đủ tiếng Việt và tiếng Anh. Thanh kéo dùng được bằng bàn phím và trên 390 px. Tự mở ảnh chụp 1440 và 390 ở cả hai ngôn ngữ để nhìn.
Ca biên: kéo nhanh liên tục, hủy giữa lúc nạp, cây quá nhỏ chưa có tầng internal, chưa có index.
Kiểm tra: `cd web && npm run check`; `E2E_PORT=3157 npx playwright test e2e/capacity.spec.ts --workers=1`.
Góc review thêm: giao diện, nhãn kết luận.
Đọc thêm: `_bmad-output/SP010/STR046/Task055/ban_giao_task055.md`; `_bmad-output/SP008/STR035/Task040/ban_giao_task040.md`; `CLAUDE.md` mục "Capacity Advisor".
