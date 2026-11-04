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

Làm theo thứ tự. Khi xong, chỉ cần báo "xong bước N". Đừng dán giá trị key vào cuộc trò chuyện hay vào repo.

### Bước 1. Đặt biến trên Render (khoảng 10 phút, chặn đăng nhập và AI)

Vào dịch vụ Gin trên Render, mục Environment, đặt các biến sau:

| Biến | Giá trị |
|---|---|
| `PUBLIC_ORIGIN` | `https://sqllens-bice.vercel.app`, không có dấu `/` ở cuối |
| `DATABASE_URL` | Chuỗi kết nối Neon |
| `UPSTASH_REDIS_REST_URL` | Từ trang Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Từ trang Upstash |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Từ Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Từ GitHub |

Sau khi lưu, nếu Render không tự deploy lại thì chọn Manual Deploy với commit mới nhất, để chắc chắn bản đang chạy có route AI.

Trước đây hai biến Upstash đang trống ở file `.env` trên máy, nên có thể chủ dự án cần tạo database Upstash trước.

### Bước 2. Thêm địa chỉ callback của production (khoảng 5 phút)

- **Google, mục Authorized redirect URIs:** `https://sqllens-bice.vercel.app/api/auth/google/callback`
- **GitHub, mục Authorization callback URL:** `https://sqllens-bice.vercel.app/api/auth/github/callback`

GitHub OAuth App chỉ nhận một callback URL. Nếu đang để địa chỉ `localhost` thì khi đổi sang production, đăng nhập GitHub ở máy sẽ không chạy. Cách đơn giản là tạo thêm một OAuth App riêng cho production.

### Bước 3. Thử đăng nhập trên production (2 phút)

Mở `https://sqllens-bice.vercel.app/vi`, đăng nhập bằng Google, đăng xuất, rồi đăng nhập bằng GitHub. Báo lại kết quả, kèm dòng lỗi nếu có.

### Bước 4. Lấy key AI (khoảng 10 phút)

Chỉ cần một trong hai để bắt đầu, nên chọn Groq:

- **Groq:** đặt `GROQ_API_KEY` trên Render, và bật Zero Data Retention trong phần cài đặt của Groq.
- **OpenRouter, nếu muốn có model dự phòng:** đặt `OPENROUTER_API_KEY` trên Render.

Gemini gói free không dùng cho phần này, vì yêu cầu có chứa SQL của người dùng.

### Bước 5. Trả lời 3 câu hỏi

Có thể trả lời ngắn theo số. Nếu không trả lời, agent làm theo khuyến nghị trừ câu 1, vì câu 1 cần chủ dự án tự làm ở Azure.

1. **Có làm MySQL trong V1 không?** Khuyến nghị: có, làm sau luồng PostgreSQL. Lúc đó agent làm HTTPS và giới hạn ở Gin trước, rồi nhờ chủ dự án mở một cổng trên Azure. Nếu đến hết 2026-11-06 vẫn chưa xong luồng PostgreSQL thì V1 ghi MySQL là "sắp có".
2. **Bấm Áp dụng với đề xuất `SELECT` của AI thì làm gì?** Hiện tại: dùng câu đó làm truy vấn đo và để trống ô thay đổi. Khuyến nghị: giữ nguyên.
3. **AI đề xuất SQL gọi hàm trùng tên hàm an toàn mà người dùng đã tự tạo thì vẫn lọt qua lớp chặn (Task060).** Ảnh hưởng chỉ trong tab của chính người dùng. Khuyến nghị: chấp nhận cho V1 và ghi lại, giống quyết định về `DO` trong `CLAUDE.md`.

### Việc không gấp

Xem chi phí thật của máy Azure trên Cost Management khi rảnh, vì việc này chưa được kiểm chứng.

## Việc của agent

Làm theo thứ tự, không cần chờ chủ dự án trừ khi có ghi rõ. Các đợt có thể chạy song song khi không sửa cùng file.

| Đợt | Việc | Kết quả người dùng thấy |
|---|---|---|
| 1 | Tìm nguyên nhân `btree-anim.spec.ts:117` lệch 56 đến 61 px khi lùi bước, sửa lỗi thật nếu có, để CI xanh | Tua lại B-Tree đúng vị trí |
| 1 | Chặn các route `e2e-*` trên production, vì chúng đang mở công khai. Thêm hai biến key AI vào `render.yaml` | Không lộ trang thử |
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
