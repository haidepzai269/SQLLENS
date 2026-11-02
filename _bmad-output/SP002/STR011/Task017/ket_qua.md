# Task017: Kết quả nghiên cứu điều khoản và giới hạn

Ngày tra: 2026-11-02. Người làm: Mary. Chỉ đọc trang công khai, không đăng ký tài khoản, không gọi API có key.

Quy ước: "Chính thức" là trang do chính nhà cung cấp phát hành. "Không chính thức" là blog, diễn đàn, trang tổng hợp. "Chưa xác minh" nghĩa là chưa đọc được nguồn trả lời trực tiếp. Số liệu trong các trang này có thể đổi, cần tra lại trước khi dựng.

## Bảng tóm tắt

| AC | Câu hỏi | Kết luận | Mức chắc chắn |
|---|---|---|---|
| AC1 | Render free: ping giữ thức | 750 giờ mỗi tháng cho cả workspace, ngủ sau 15 phút không có request, thức lại mất khoảng 1 phút. Lịch 7:00-24:00 dùng khoảng 510 đến 527 giờ. Điều khoản không nói gì về ping, chưa xác minh được Điều khoản sử dụng và Chính sách sử dụng chấp nhận được | Một phần |
| AC2 | Neon free | 100 CU-giờ mỗi project mỗi tháng (không phải 50), 1 GB mỗi project, tự tắt sau 5 phút và không tắt được. Giới hạn kết nối riêng cho gói free chưa xác minh | Cao |
| AC3 | Upstash Redis free | 500K lệnh mỗi tháng, 250 MB (bảng so sánh ghi 256 MB), 10.000 lệnh mỗi giây, 10 GB băng thông mỗi tháng, 1 database | Cao |
| AC4 | Gemini, Groq, OpenRouter free | Gemini free: dữ liệu bị dùng để cải thiện sản phẩm và người có thể đọc. Không được nhận SQL người dùng. Groq: mặc định không giữ dữ liệu, có ZDR, nhưng chưa có câu chữ rõ về huấn luyện. OpenRouter: tùy provider phía sau, chỉ an toàn khi bật `data_collection: deny` hoặc `zdr: true` | Xem mục AC4 |
| AC5 | Oracle Always Free | ARM A1: tổng 2 OCPU và 12 GB. Máy bị coi là nhàn rỗi khi cả CPU (p95), mạng và bộ nhớ (chỉ với A1) dưới 20% trong 7 ngày. Thiếu máy ở Tokyo có báo cáo không chính thức. Singapore chưa xác minh | Cấu hình và thu hồi: cao. Thiếu máy: thấp |
| AC6 | agent-browser trên Windows | README có mô tả hành vi riêng cho Windows, nhiều bản vá lỗi Windows. Chưa tìm thấy dòng "hỗ trợ Windows" tường minh. Playwright hỗ trợ Windows 11+ | Trung bình |

## AC1: Render free

**Hạn mức giờ chạy.** Render cấp 750 giờ instance miễn phí mỗi workspace mỗi tháng lịch, giờ không dùng không cộng dồn. Hết giờ thì mọi web service free bị tạm dừng đến tháng sau. Nguồn: [Render, Free](https://render.com/docs/free), chính thức, ngày tra 2026-11-02. Một câu trả lời của nhân viên Render trên diễn đàn nói hạn mức tính theo tài khoản, không theo service: [Render Community](https://community.render.com/t/do-web-services-on-a-free-tier-go-to-sleep-after-some-time-inactive/3303), nguồn do nhân viên đăng nhưng trong diễn đàn, ngày tra 2026-11-02, được trích lại qua kết quả tìm kiếm.

**Thời gian ngủ.** Service ngủ sau 15 phút không nhận request nào từ bên ngoài. Request HTTP và tin nhắn WebSocket trên kết nối đang mở đều tính là lưu lượng. Service đang ngủ không tiêu giờ. Thức lại mất khoảng 1 phút. Nguồn: [Render, Free](https://render.com/docs/free), chính thức, 2026-11-02.

**Ping giữ thức có được phép không.** Trang Free không nhắc gì đến ping hay keep-alive, và không nói lưu lượng tự tạo có tính hay không. Trang này chỉ nêu Render có thể tạm ngưng service free tạo lưu lượng internet công cộng "uncommonly high" (rất lớn bất thường), và có thể khởi động lại service free bất cứ lúc nào. Tôi mở [Điều khoản sử dụng](https://render.com/terms) và [Chính sách sử dụng chấp nhận được](https://render.com/acceptable-use) nhưng công cụ chỉ lấy được phần điều hướng, không lấy được nội dung. Kết luận: **chưa xác minh** Điều khoản có cấm ping hay không. Việc ping theo lịch, lưu lượng nhỏ, không bị trang Free cấm rõ ràng. Một bình luận Reddit cho rằng Render có thể coi là vi phạm, nhưng đó là nguồn không chính thức, chưa kiểm chứng.

**Tính giờ cho lịch 7:00-24:00 (giờ Việt Nam).** Đây là phép tính của tôi, không phải số của Render.

- Mỗi ngày: 17 giờ, cộng tối đa 15 phút trước khi ngủ ban đêm, tức khoảng 17,25 giờ.
- Tháng 30 ngày: 510 giờ. Tháng 31 ngày: 527 giờ. Tính cả 15 phút: 517,5 và 534,75 giờ.
- So với 750 giờ: còn dư khoảng 215 đến 240 giờ. Mức này chỉ đúng khi workspace chỉ có một web service free chạy. Mỗi service free thứ hai chạy cùng khung giờ tốn thêm khoảng 510 đến 527 giờ và sẽ làm vượt hạn mức, vì hạn mức dùng chung cho cả workspace.
- Chạy 24/7 cần 720 đến 744 giờ, vẫn lọt dưới 750 nếu chỉ có một service.

Hệ quả: lịch 7:00-24:00 không cần thiết để tiết kiệm giờ khi chỉ có một service. Nó chỉ có ích nếu workspace có service free khác.

## AC2: Neon free

Nguồn: [Neon, Pricing](https://neon.com/pricing) và [Neon, Plans](https://neon.com/docs/introduction/plans), chính thức, ngày tra 2026-11-02. Hai trang khớp nhau.

- **CU-giờ:** 100 CU-giờ mỗi project mỗi tháng. Các nguồn "50" trước đây không còn đúng theo trang giá hiện tại. Con số 100 tính theo project, không tính theo tài khoản. Đủ chạy compute 0,25 CU trong 400 giờ.
- **Dung lượng:** 1 GB lưu trữ mỗi project, tối đa 20 GB trên toàn tài khoản. Tối đa 100 project, 10 branch mỗi project, 5 GB truyền mạng công cộng mỗi project mỗi tháng.
- **Tự tắt:** sau 5 phút không hoạt động, luôn bật ở gói Free và không tắt được.
- **Compute tối đa:** tự co giãn đến 2 CU (khoảng 8 GB RAM).
- **Số kết nối:** trang giá và trang gói không nêu giới hạn riêng cho Free. Tài liệu [Neon, Connection pooling](https://neon.com/docs/connect/connection-pooling) cho `max_connections` theo cỡ compute: 104 ở 0,25 CU, 209 ở 0,5 CU, 419 ở 1 CU, 839 ở 2 CU, trong đó 7 kết nối dành cho superuser. PgBouncer nhận tối đa 10.000 kết nối client. Compute của gói Free chạy ở cỡ nào thì **chưa xác minh** ở đây nên chưa suy ra được con số chắc cho gói Free. Nên dùng chuỗi kết nối qua pooler.

## AC3: Upstash Redis free

Nguồn: [Upstash, Redis pricing](https://upstash.com/pricing/redis), chính thức, ngày tra 2026-11-02.

- **Lệnh:** 500K lệnh mỗi tháng.
- **Dung lượng:** FAQ ghi 250 MB, bảng so sánh ghi 256 MB. Hai con số trên cùng trang lệch nhau, ghi cả hai.
- **Giới hạn mỗi giây:** bảng so sánh ghi 10.000 lệnh tối đa mỗi giây cho gói Free.
- **Khác:** 10 GB băng thông mỗi tháng, 1 database cho tài khoản free.

## AC4: Gói free của Gemini API, Groq, OpenRouter

Lưu ý nguyên tắc 7 của `CLAUDE.md` là "không ghi log SQL của người dùng". Điều kiện dưới đây xét việc nhà cung cấp lưu, cho người xem, hoặc huấn luyện trên SQL gửi lên.

### Gemini API

Nguồn: [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) và [Gemini API Billing](https://ai.google.dev/gemini-api/docs/billing), chính thức, ngày tra 2026-11-02.

- **Gói free (Unpaid Services):** Google dùng nội dung gửi lên và câu trả lời để "provide, improve, and develop" sản phẩm và dịch vụ của Google, kể cả công nghệ học máy. Điều khoản ghi người duyệt ("human reviewers") có thể đọc, chú thích và xử lý đầu vào và đầu ra. Google nói dữ liệu được tách khỏi tài khoản, API key và dự án Cloud trước khi người duyệt thấy.
- **Thời gian giữ:** điều khoản không nêu số ngày cho dịch vụ free. Chưa xác minh.
- **Gói trả phí (Paid Services):** Google không dùng prompt và câu trả lời để cải thiện sản phẩm. Google vẫn ghi log prompt và câu trả lời trong một khoảng thời gian có giới hạn để phát hiện vi phạm và đáp ứng pháp luật. Trang thanh toán nói điều khoản trả phí áp dụng khi ít nhất một dự án API đã bật thanh toán.
- **Tùy chọn tắt trên gói free:** không tìm thấy. Cách duy nhất là chuyển sang trả phí (trả trước tối thiểu 5 USD). Ngoại lệ: người dùng ở EEA, Thụy Sĩ, Anh được áp dụng điều khoản trả phí cho cả gói free.
- **Giới hạn tần suất:** trang [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) không công bố số cho gói free, chỉ nói xem trong Google AI Studio. Chưa xác minh.

### Groq

Nguồn: [Groq, Your Data](https://console.groq.com/docs/your-data), [Groq, Rate limits](https://console.groq.com/docs/rate-limits), [Groq DPA](https://console.groq.com/docs/legal/customer-data-processing-addendum), [Groq Privacy Policy](https://groq.com/privacy-policy), chính thức, ngày tra 2026-11-02.

- **Giữ dữ liệu:** mặc định Groq không giữ dữ liệu của các request suy luận. Đầu vào và đầu ra có thể được ghi tạm tối đa 30 ngày chỉ để xử lý lỗi độ tin cậy hoặc nghi ngờ lạm dụng. Metadata sử dụng luôn được thu thập nhưng không gồm đầu vào, đầu ra. Trang không tách gói free và trả phí.
- **Tùy chọn tắt:** "All customers may enable Zero Data Retention" trong Data Controls. Mọi khách hàng đều bật được, không nói riêng gói trả phí.
- **Huấn luyện:** các trang tôi đọc không có câu nói rõ "không huấn luyện" hay "có huấn luyện". DPA giới hạn xử lý ở mục đích "provide, maintain, and support the Cloud Services" và nói dữ liệu khách chỉ dùng theo hợp đồng. Chính sách quyền riêng tư loại dữ liệu API khỏi phạm vi và chuyển sang Services Agreement, tôi chưa đọc được văn bản này. Một trang tổng hợp không chính thức ([meetily.ai](https://meetily.ai/llm-privacy/groq)) khẳng định DPA cấm huấn luyện, nhưng DPA chính thức tôi đọc không ghi như vậy. Kết luận về huấn luyện: **chưa xác minh**.
- **Người xem:** DPA ghi truy cập của nhân viên theo nguyên tắc quyền tối thiểu, có kiểm toán hàng quý. Không có cam kết "không ai đọc".
- **Mâu thuẫn:** một phân tích không chính thức nói phần mô tả meta của trang ghi "30 ngày" trong khi thân trang nói không giữ mặc định. Tôi đọc thân trang: mặc định không giữ, 30 ngày là ngoại lệ cho xử lý lỗi và lạm dụng.
- **Giới hạn tần suất:** trang công khai chỉ cho bảng giới hạn gói Developer, giá trị gói Free nằm trong trang cài đặt tài khoản nên chưa xác minh. Để tham khảo gói Developer: `openai/gpt-oss-120b` 30 RPM, 1K RPD, 8K TPM, 200K TPD.

### OpenRouter

Nguồn: [OpenRouter, Logging](https://openrouter.ai/docs/guides/privacy/logging), [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [ZDR](https://openrouter.ai/docs/guides/features/zdr), [Privacy Policy](https://openrouter.ai/privacy), [Limits](https://openrouter.ai/docs/api-reference/limits), chính thức, ngày tra 2026-11-02.

- **OpenRouter tự huấn luyện:** chính sách nói OpenRouter không dùng đầu vào, đầu ra để huấn luyện.
- **Provider phía sau:** một số provider có thể dùng đầu vào, đầu ra để huấn luyện hoặc cải thiện, theo điều khoản riêng của họ. Mặc định `data_collection` là `allow`, tức cho phép provider lưu dữ liệu lâu dài và có thể huấn luyện. Tài liệu ghi có cài đặt tài khoản riêng cho model free và model trả phí.
- **Tùy chọn tắt:** đặt `data_collection: "deny"` để chỉ chọn provider không thu thập dữ liệu, hoặc `zdr: true` để chỉ chọn endpoint không giữ dữ liệu (đặt trong yêu cầu hoặc cài đặt tài khoản). Tài liệu ZDR nói provider không giữ dữ liệu thì không huấn luyện được, và endpoint chưa rõ chính sách được coi là vừa giữ vừa huấn luyện.
- **Thời gian giữ, người xem:** thời gian giữ do từng provider quy định. OpenRouter có thể gắn lại đầu vào đã lưu với user ID để gỡ lỗi, chính sách không nói đó có phải người xem hay không. Thông báo cập nhật 2026-10-27 (ghi trong tài liệu ZDR): mọi request, kể cả ZDR, sẽ được quét CSAM và nội dung bị gắn cờ có thể được giữ để người duyệt. Chưa xác minh có áp dụng riêng cho model free hay không.
- **Giới hạn tần suất model `:free`:** 20 request mỗi phút. Dưới 10 credit đã mua: 50 request mỗi ngày. Từ 10 credit: 1.000 request mỗi ngày. Trang có một chỗ chưa hiển thị đúng ngưỡng.

### Kết luận về nguyên tắc 7

| Bên | Được nhận SQL người dùng? | Lý do |
|---|---|---|
| Gemini free | Không | Dữ liệu dùng để cải thiện sản phẩm, có người đọc, không có cách tắt trên gói free |
| Gemini trả phí | Chấp nhận được về huấn luyện, nhưng vi phạm ngân sách 0 đồng | Google không dùng để huấn luyện, nhưng vẫn ghi log tạm thời |
| Groq | Có điều kiện: chỉ khi bật ZDR | Mặc định không giữ, ZDR bật được cho mọi khách. Câu chữ về huấn luyện chưa xác minh, cần đọc Services Agreement trước |
| OpenRouter | Có điều kiện: chỉ khi ép `data_collection: "deny"` và nên thêm `zdr: true` | Mặc định cho phép provider huấn luyện. Model `:free` có thể bị loại khi ép chính sách, chưa xác minh |

Đây là kết luận của người nghiên cứu, không phải tư vấn pháp lý. Quyết định cuối thuộc chủ dự án. Lưu ý thêm: ZDR hay `deny` chỉ nói về lưu và huấn luyện ở phía họ, không thay thế việc Gin không ghi log SQL ở phía mình.

## AC5: Oracle Always Free

Nguồn chính: [Oracle, Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), chính thức, ngày tra 2026-11-02.

- **Cấu hình ARM hiện tại:** VM.Standard.A1.Flex. Tổng 2 OCPU và 12 GB bộ nhớ (tương đương 1.500 giờ OCPU và 9.000 giờ GB mỗi tháng), phân bổ linh hoạt. Có thể dùng hết cho một instance, hoặc tối đa hai instance 1 OCPU. Tổng 200 GB block volume, gồm cả boot volume. Boot volume tối thiểu 47 GB ở phần Compute, còn phần Block Volume ghi 50 GB, trang tự mâu thuẫn, cần kiểm trong Console khi tạo.
- **Quan trọng cho kế hoạch:** 2 OCPU và 12 GB là ít hơn mức 4 OCPU và 24 GB nhiều bài cũ nhắc. Một blog không chính thức cũng ghi mức giảm này. Trang chính thức tôi đọc chỉ ghi 2 OCPU và 12 GB.
- **Thu hồi máy nhàn rỗi:** máy ảo bị coi là nhàn rỗi nếu trong 7 ngày cả ba điều kiện cùng đúng: CPU phân vị 95 dưới 20%, mạng dưới 20%, bộ nhớ dưới 20% (điều kiện bộ nhớ chỉ áp dụng cho A1). Máy Always Free nhàn rỗi "may be reclaimed" (có thể bị thu hồi). Ngưỡng này đo phân vị 95, nên chỉ cần CPU cao hơn 20% trong 5% thời gian là không bị coi là nhàn rỗi, nhưng chưa xác minh nếu agent sandbox sẽ đạt ngưỡng đó.
- **Thiếu máy ARM gần Việt Nam:** Oracle không công bố tình trạng sẵn có. Chỉ có nguồn không chính thức: một chủ đề cộng đồng Oracle ([community.oracle.com](https://community.oracle.com/customerconnect/resources/3de6cdb42f)) và một bài [Zenn](https://zenn.dev/ossmxun/articles/17675b49fe8e92) báo lỗi "Out of host capacity" thường xuyên ở Tokyo. Một số blog nói Singapore còn nhiều máy hơn nhưng đây là khẳng định gián tiếp, chưa xác minh. Region của tenancy phải chọn lúc đăng ký và region nhà không đổi được, nên không thể thử tùy ý. Việc xin được máy phải thử thật.

## AC6: agent-browser và Windows

- **README chính thức** ([vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser), chính thức, ngày tra 2026-11-02) có phần "Windows": trên Windows, agent-browser chạy Chrome headless trong một desktop riêng, tiến trình Chrome thuộc một Windows Job Object và bị đóng khi daemon thoát, cần đóng Chrome trước khi dùng `--profile`, ảnh chụp canvas WebGPU bị đen trên Windows và Linux. Phần cài đặt liệt kê npm, Homebrew, Cargo, build từ nguồn, không ghi riêng cách cài cho Windows.
- **Bản phát hành:** [Releases](https://github.com/vercel-labs/agent-browser/releases) có các bản vá lỗi Windows (v0.39.3 sửa việc thu output, v0.40.0 sửa phiên Windows). Gói npm [`agent-browser`](https://registry.npmjs.org/agent-browser/latest) bản 0.41.1 không có trường `os` hay `cpu` giới hạn nền tảng.
- **Nguồn không chính thức:** ghi chú bản v0.7.2 trên [newreleases.io](https://newreleases.io/project/github/vercel-labs/agent-browser/release/v0.7.2) nói binary Windows x64 đã nằm trong gói npm. Một trang tổng hợp cũng ghi macOS, Linux, Windows (x64).
- **Kết luận:** nhiều bằng chứng cho thấy Windows được hỗ trợ, nhưng không có câu "hỗ trợ Windows" ở trang yêu cầu hệ thống, và tôi chưa chạy thử. Mức chắc chắn trung bình. Cần một lần chạy thử trên máy Windows của dự án để chốt.
- **Phương án thay thế:** Playwright, đang dùng ở Task011. Tài liệu [Playwright, Intro](https://playwright.dev/docs/intro) ghi hỗ trợ "Windows 11+, Windows Server 2019+ hoặc WSL", Node 22, 24 hoặc 26.

## Việc còn "chưa xác minh"

1. Điều khoản Render về ping giữ thức (AC1): không đọc được nội dung Terms và Acceptable Use.
2. Số kết nối của Neon gói Free và cỡ compute thực tế (AC2).
3. Gemini: thời gian giữ dữ liệu ở gói free và giới hạn tần suất gói free (AC4).
4. Groq: câu chữ về huấn luyện trong Services Agreement và giới hạn gói Free (AC4).
5. OpenRouter: dữ liệu và người xem riêng cho model `:free` (AC4).
6. Tình trạng thiếu máy ARM ở Singapore và các region gần Việt Nam, chỉ có nguồn không chính thức (AC5).
7. agent-browser chạy được trên Windows của dự án hay không, chưa chạy thử (AC6).

## Gợi ý cập nhật `CLAUDE.md`

Phiên chính quyết định có đưa vào hay không: Neon free là 100 CU-giờ mỗi project; Oracle A1 là 2 OCPU, 12 GB (có thể chưa đủ cho kế hoạch nhiều container); Gemini free không được nhận SQL; Groq và OpenRouter cần cấu hình dữ liệu trước.
