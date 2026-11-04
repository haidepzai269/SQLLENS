# Mục tiêu trước mắt

Viết ngày 2026-11-04, tức ngày 3 của 7 ngày nếu tính từ 2026-11-02, nên hạn là 2026-11-08. Tiến độ chi tiết nằm ở `_bmad-output/SP0xx/README.md`.

## Chốt mục tiêu

**Trước hết làm xong một luồng PostgreSQL trọn vẹn trên production, có đăng nhập và AI thật. MySQL làm ngay sau đó.**

Luồng đó gồm: dán SQL, chạy, thấy bên trong, thử tranh chấp, xem danh sách rủi ro, sửa rồi chạy lại, hỏi AI.

Lý do chọn thứ tự này:

- Hiện đã có phần "thấy bên trong" và "sửa rồi chạy lại". Còn thiếu hai trong ba trụ của V1: "kiểm tra thiết kế" và màn hình "thử kịch bản hỏng". Lõi của hai phần này đã có, nên làm thêm tương đối nhanh.
- Đăng nhập và AI đã có code nhưng chưa chạy thật. Chỉ cần chủ dự án đặt biến là kiểm được, và làm sớm thì lỗi lộ ra sớm.
- MySQL cần thêm HTTPS, giới hạn theo người dùng và mở cổng Azure, nên rủi ro cao nhất. Làm sau để nếu trễ thì vẫn có một sản phẩm PostgreSQL hoàn chỉnh.

**Xong khi:** trên `https://sqllens-bice.vercel.app`, một người dùng mới đi được hết luồng trên bằng trình duyệt thật, đăng nhập Google hoặc GitHub được, AI trả lời được, và CI xanh.

## Việc của chủ dự án

Cập nhật ngày 2026-11-04: bước đặt biến Render, callback, đăng nhập đã xong. Ba câu hỏi đã trả lời: làm MySQL, Áp dụng giữ nguyên, chấp nhận rủi ro hàm trùng tên.

Còn lại:

1. Đổi 4 secret đã lộ trong lịch sử phiên: mật khẩu Neon, token Upstash, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`. Cập nhật ở cả Render và `api/.env`.
2. Điền `GROQ_API_KEY` trên Render nếu chưa điền, và bật Zero Data Retention của Groq.
3. Sau Task074: làm theo `_bmad-output/SP004/STR019/Task074/huong_dan_mo_cong.md` để mở cổng Azure cho Render.

## Việc của agent

Làm theo thứ tự, không cần chờ chủ dự án trừ khi có ghi rõ. Các đợt có thể chạy song song khi không sửa cùng file.

| Đợt | Việc | Kết quả người dùng thấy |
|---|---|---|
| 1 | Task064: thanh cuộn, nút bánh răng, tooltip, đóng mở cột mượt, viền ô SQL | Giao diện đạt chuẩn shadcn/ui |
| 1 | Task067: trang `/about` với GSAP và video quay từ sản phẩm thật | Có trang giới thiệu |
| 1 | Task074: HTTPS và giới hạn theo người dùng cho MySQL | Sẵn sàng mở cổng |
| 1 | Tìm nguyên nhân `btree-anim.spec.ts:117` lệch 56 đến 61 px khi lùi bước, sửa lỗi thật nếu có, để CI xanh | Tua lại B-Tree đúng vị trí |
| 1 | Chặn các route `e2e-*` trên production, vì chúng đang mở công khai. Thêm hai biến key AI vào `render.yaml` | Không lộ trang thử |
| 2 | Task066: trang `/login` với GSAP, khách chỉ được 2 lần chạy câu cơ bản. Chờ Task064, Task067 | Luồng đăng nhập mới |
| 2 | SP009 STR041, STR042: gắn bằng chứng, hiện danh sách rủi ro, đưa findings vào gói bằng chứng của AI | Cột Rủi ro có nội dung thật |
| 2 | SP011 STR051, STR052: timeline hai session, đồ thị chờ khóa, tiêu chí hỏng | Xem được 5 kịch bản tranh chấp |
| 3 | SP008 STR037, STR038: range scan, khác biệt engine, cuộc đua Seq Scan với Index Scan, cây tối | Đủ giao diện B-Tree đã chốt |
| 4 | Sau bước 3 và bước 4 của chủ dự án: kiểm luồng thật trên production, cả câu hỏi nhét lệnh vào AI | Biết chắc đăng nhập và AI chạy thật |
| 5 | SP004 STR019, rồi SP008 STR034, SP010 STR044, SP011 STR050, nếu câu 1 chốt có làm MySQL | Dùng được MySQL |
| 6 | SP013: landing, đánh bóng luồng, E2E hai engine, `security-audit` cuối | Phát hành |

STR057 AI Chaos Generator chỉ làm nếu còn thời gian, không chặn phát hành.

## Nếu thiếu thời gian

Bỏ theo thứ tự: AI Chaos Generator, rồi SP008 STR038 phần cuộc đua, rồi rút 5 kịch bản PostgreSQL còn 3, rồi MySQL. Chủ dự án quyết định lần cuối tại thời điểm đó.

## Rủi ro cần nhớ

- **Vercel deploy cả khi CI đỏ.** Bản lỗi có thể lên production. Khi sắp phát hành nên đổi cách này.
- **Hạn mức API từng hết.** Agent chạy song song dễ chạm giới hạn 5 giờ và phải chờ, nên không nên mở quá nhiều task một lúc.
- **Máy hết RAM.** Không chạy cả bộ Playwright ở máy, để CI chạy.
- **Chưa kiểm:** Firefox, Safari, điện thoại thật, trình đọc màn hình, máy RAM thấp.
