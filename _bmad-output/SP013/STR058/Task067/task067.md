# Task067: Trang giới thiệu `/about`

Thuộc: SP013 / STR058
Mục tiêu: Một trang quảng bá có hiệu ứng thật đẹp, giải thích SQLLens bằng hình ảnh của chính database, dẫn người xem vào sản phẩm.
Phạm vi: `web/src/app/[locale]/about/**`, `web/src/modules/landing/**`, `web/public/about/**`, `web/messages/{vi,en}/landing.json`, `web/e2e/about.spec.ts`, `web/e2e/record-demo.ts` (script quay video). Sửa layout chỉ khi cần để trang này không có khung ứng dụng.
Không làm: đổi màn hình `/lab`, trang login, dùng ảnh hay video lấy từ nơi khác, thêm dịch vụ trả phí.

Công cụ bắt buộc: GSAP (ScrollTrigger, timeline) theo skill `gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-react`, `gsap-performance`. Hướng thiết kế theo skill `design-taste-frontend`: phải đọc và chạy vòng nhìn rồi sửa của skill. Giữ nền tối kiểu phòng lab và token màu trong `DESIGN.md`.

Tiêu chí xong:
- AC1: Hero: câu nói rõ sản phẩm làm gì, một hình động lớn liên quan đến database chạy tự động, hai nút vào sản phẩm và đăng nhập. Hiểu được sản phẩm là gì trong 5 giây mà không cần cuộn.
- AC2: Có ít nhất 4 cảnh cuộn dùng GSAP ScrollTrigger, vẽ bằng SVG hoặc canvas, nội dung đúng kỹ thuật: key rơi từ root qua internal xuống leaf; Seq Scan đua với Index Scan bằng số trang; hai session tranh khóa thành deadlock; kéo quy mô dữ liệu làm cây mọc thêm tầng.
- AC3: Có ít nhất một video quay từ sản phẩm thật, do `web/e2e/record-demo.ts` quay bằng Playwright rồi lưu ở `web/public/about/`, có poster, tải lười, tự phát không tiếng, có nút dừng. Mỗi file không quá 8 MB. Chạy lại script là quay lại được. Không có ffmpeg thì dùng WebM của Playwright và ghi rõ.
- AC4: Mọi con số trên trang lấy từ mục "Đã kiểm chứng" của `CLAUDE.md`, kèm nhãn và ngữ cảnh, ví dụ 500k dòng đọc 16 trang qua index so với 4.167 trang khi quét toàn bảng. Không có tên khách hàng, cảm nhận, số người dùng hay so sánh hiệu năng tự nghĩ ra. Không có câu hàm ý "thiết kế của bạn ổn", không dự đoán production. Giải thích ba nhãn Thật, Mô phỏng, Ước lượng.
- AC5: `prefers-reduced-motion`: không có chuyển động tự chạy, video không tự phát, mọi nội dung vẫn đọc được.
- AC6: Mở `/vi/about` không tải WASM của PGlite. Tự kiểm thời lượng tải và ghi số đo kích thước JS của trang vào bàn giao. Cuộn không giật khi CPU chậm 4 lần: đo số khung hình và ghi lại.
- AC7: `npm run check`, `npm run build` thoát 0. `web/e2e/about.spec.ts` đạt với `--workers=1`, kiểm cả hai ngôn ngữ, 1440 và 390 px không cuộn ngang, nút dẫn đúng đường, giảm chuyển động. `web/e2e/lab.spec.ts` vẫn đạt nếu có sửa layout.

Giao diện: Đủ tiếng Việt và tiếng Anh, có metadata tiêu đề và mô tả cho mỗi ngôn ngữ. Có bàn phím, focus thấy rõ. Tự mở ảnh chụp từng cảnh ở 1440 và 390 px cả hai ngôn ngữ, chụp nhiều mốc cuộn vì animation không thấy được qua snapshot. Ghi rõ đã xem ảnh nào.
Ca biên: JavaScript tải chậm, cửa sổ rất rộng, cuộn nhanh hết trang rồi quay lại, đổi ngôn ngữ giữa trang, video lỗi thì vẫn thấy poster.
Góc review thêm: giao diện, nội dung có đúng kỹ thuật và đúng sự thật không.
Đọc thêm: `CLAUDE.md` các mục "Sản phẩm là gì", "Giao diện B-Tree", "Nguyên tắc không được phá", "Đã kiểm chứng"; `_bmad-output/SP001/STR002/Task004/ghi_chu_thiet_ke.md`.
