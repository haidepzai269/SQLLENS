# Bàn giao Task005

Đã làm: Chuyển mẫu giao diện đã duyệt thành `DESIGN.md`, `EXPERIENCE.md` và token trong `globals.css`. Giao diện chính là tối. `.dark` trùng `:root`, nên các component shadcn/ui đã cài dùng được. Thêm `tokens.test.ts` để kiểm tương phản và khớp màu giữa `DESIGN.md` với `globals.css`.
File chính: `DESIGN.md`, `EXPERIENCE.md` (thư mục gốc repo), `web/src/app/globals.css`, `web/src/app/tokens.test.ts`.
Kết quả kiểm tra: `cd web && npm run check` thoát 0 (37 test qua, gồm 4 file test). `npm run build` thoát 0. Chưa chạy `npm run e2e`. Không mở server nào.
Kết quả AC: AC1 đạt, test so từng màu trong phần đầu `DESIGN.md` với token cùng tên. AC2 đạt, bảng đo nằm ở `DESIGN.md` mục "Đo tương phản", mọi cặp chữ đạt từ 5,35:1 trở lên. AC3 đạt. AC4 xem mục dưới.
Kết quả review: Một reviewer, 4 lỗi mức thấp (L1 đến L4), đã sửa hết. L1: test AC1 kiểm theo tên token. L2: tắt thêm `animation` khi giảm chuyển động. L3: mọi bậc bo lớn dùng 4 px, giữ vòng focus của shadcn/ui vì cùng màu đèn. L4: bỏ `--label-foreground`, thêm `--color-text/dim/line/canvas-dot`. Cùng reviewer kiểm lại ở eb24a4f: L1 đến L4 đã sửa, không lỗi mới, không còn needs_validation.
Chưa làm được: Bảng đo tương phản trong `DESIGN.md` là số ghi tay, test chỉ chặn cặp dưới 4,5:1 chứ không so lại từng số. Chưa nhìn trên màn hình thật vì task không có màn hình. Cặp `control` trên `stage` (1,70) và `line` trên `ground` (1,25) dưới 3:1 cho phần tử giao diện, giữ như mẫu và đã ghi trong `DESIGN.md`.

Quyết định khác mẫu đã duyệt (AC4):
- Sản phẩm chỉ chạy animation khi bấm Chạy, mẫu tự chạy một lần. Theo `CLAUDE.md`. Landing page là ngoại lệ.
- Giảm chuyển động: mẫu ẩn nút chạy, sản phẩm giữ nút Chạy để phát từng bước đổi ngay. Lý do: người dùng cần chạy được mà không có chuyển động.
- Đổi tên `--muted` của mẫu thành `--dim`, `--border` thành `--line`. Lý do: trùng tên token shadcn/ui có nghĩa khác.
- Thêm `--label-*` và `--severity-*` theo hợp đồng task, thêm `--canvas-dot`, `--sans`, `--mono`.
- `--radius-sm` là 2 px và `--radius-xl` đến `--radius-4xl` bằng 4 px, để Badge và Card không thành viên thuốc. Mẫu chỉ có 4 px và 2 px.
- Body 13 px trên máy tính và 14 px từ 900 px trở xuống, đặt ở `globals.css`.
- Thêm Y1 (node không chồng chữ sau khi thả) và Y2 (cụm nút canvas không che thẻ ở 390 px) thành yêu cầu bắt buộc trong `EXPERIENCE.md`. Mẫu chưa đạt hai điểm này.
- Kéo thả dùng React Flow, không chép bộ JS thuần của mẫu. Cây B-Tree dùng SVG và GSAP.

Phát sinh: Mỗi phần ghi ở trên là việc cho task sau, không phải lỗi.
- `web/src/app/[locale]/layout.tsx` vẫn nạp Geist qua `next/font`. Phải thay bằng Public Sans và JetBrains Mono (có dấu tiếng Việt) và thêm `className="dark"` cho `<html>`. Đó là việc của khung ứng dụng, ngoài phạm vi Task005.
- Phải có test ảnh chụp cho Y1 và Y2 khi làm canvas.
- Test tương phản cho cặp mới khi thêm token.
Việc tiếp theo cần biết: Trong component dùng token và utility (`bg-surface`, `text-dim`, `border-line`, `text-lamp`), không viết hex. Màu đèn không dùng cho mức độ. Mỗi kết luận một nhãn, mỗi thẻ rủi ro một mức độ riêng.
