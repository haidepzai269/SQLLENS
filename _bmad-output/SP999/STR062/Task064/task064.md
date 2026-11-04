# Task064: Đánh bóng khung ứng dụng

Thuộc: SP999 / STR062, yêu cầu của chủ dự án ngày 2026-11-04
Mục tiêu: Thanh cuộn, header, tooltip, đóng mở cột và viền ô SQL đạt chuẩn shadcn/ui, mượt và không khựng.
Phạm vi: `web/src/app/globals.css` (hoặc file CSS gốc đang dùng), `web/src/components/shell/**`, `web/src/components/sql-editor/sql-editor-impl.tsx`, `web/src/components/ui/{tooltip,dropdown-menu}.tsx`, `web/src/modules/lab/lab-workspace.tsx` và `web/src/modules/lab/stage/stage.tsx` (chỉ bọc tooltip cho nút), `web/messages/{vi,en}/shell.json`, `web/e2e/shell.spec.ts`, `web/e2e/shell-polish.spec.ts`.
Không làm: đổi bố cục ba cột, trang login, trang about, logic đăng nhập, đổi màu chủ đạo.

Tiêu chí xong:
- AC1: Thanh cuộn toàn ứng dụng mảnh và mờ, chỉ đậm lên khi hover, theo kiểu `ScrollArea` của shadcn/ui, cả chế độ Firefox (`scrollbar-width`, `scrollbar-color`) và WebKit. Áp cho cột, terminal, lưới kết quả, CodeMirror, panel `stage`. Không làm mất khả năng kéo thanh cuộn, không làm nhảy bố cục khi hover.
- AC2: Bốn icon đóng mở cột trên header gom vào một nút bánh răng. Bấm thì bánh răng quay và dropdown shadcn/ui mở mượt, bấm lại thì quay về và đóng mượt. Mỗi mục có icon, tên, trạng thái bật tắt, bấm không đóng menu. Vẫn dùng được bằng bàn phím và có `aria-label`. Nút ngôn ngữ và đăng nhập giữ ngoài menu.
- AC3: Hover hoặc focus vào nút trên header, nút trong cột SQL và các nút điều khiển trong `stage` thì hiện tooltip shadcn/ui chỉ dẫn việc nút đó làm, đủ hai ngôn ngữ. Nút có chữ rõ nghĩa vẫn có tooltip nói thêm tác dụng, không lặp nguyên chữ trên nút. Trên thiết bị cảm ứng tooltip không che thao tác.
- AC4: Đóng mở cột và panel terminal có chuyển động mượt, cột co giãn dần chứ không nhảy. Test lấy mẫu độ rộng cột qua nhiều khung hình và thấy có giá trị trung gian tăng hoặc giảm đều. Khi kéo tay thanh chia thì không có độ trễ do transition. Sau khi mở lại, độ rộng về đúng giá trị cũ. React Flow và cây B-Tree không giật hay vẽ sai sau khi cột đổi cỡ. Có giảm chuyển động thì đổi ngay, không animation.
- AC5: Focus vào ô nhập SQL hiện một viền đều cả bốn cạnh theo kiểu ring của shadcn/ui, không bị cắt, không chồng lên ô `Input` khác. Tái hiện lỗi hiện tại bằng ảnh trước khi sửa, lưu cả ảnh trước và sau.
- AC6: `npm run check`, `npm run build` thoát 0. `web/e2e/shell.spec.ts`, `web/e2e/shell-polish.spec.ts`, `web/e2e/sql-editor.spec.ts` đạt với `--workers=1`. Spec cũ nào dùng nút bật tắt cột phải sửa theo menu mới: tìm hết bằng grep và chạy lại những spec đó.

Giao diện: Đủ tiếng Việt và tiếng Anh. Trên điện thoại vẫn theo tab hiện có, không để menu bánh răng tràn màn hình. Tự mở ảnh 1440 và 390 px ở cả hai ngôn ngữ, gồm menu đang mở, tooltip đang hiện, ô SQL đang focus. Animation phải chụp nhiều khung hình để xem.
Ca biên: tắt hết cột, mở menu rồi đổi ngôn ngữ, đổi cỡ cửa sổ qua mốc 900 px, bấm liên tục khi cột đang chuyển động.
Góc review thêm: giao diện, accessibility.
Đọc thêm: `DESIGN.md`, `EXPERIENCE.md`; bàn giao Task044, Task029; skill `design-taste-frontend` phần màn hình app; skill `gsap-react` nếu dùng GSAP cho đóng mở.
