# Task059: Dựng gói bằng chứng và kiểm câu trả lời

Thuộc: SP012 / STR054
Mục tiêu: Dựng `EvidencePack` đủ nhỏ và không chứa dữ liệu kết quả, rồi kiểm câu trả lời của AI để phát hiện số không có trong bằng chứng và câu hàm ý thiết kế ổn.
Phạm vi: `web/src/modules/mentor/evidence/**`.
Không làm: gọi mạng, giao diện, câu dịch (Task061 làm), sửa `web/src/contracts/mentor.ts` (cần đổi thì báo trong bàn giao).

Hợp đồng:
- `buildEvidencePack(input: { engine: EngineId; sql: string; plan?: Plan; findings?: RuleHit[]; whatIf?: WhatIfData; capacity?: CapacityPoint[] }): EvidencePack`. Kết quả sau `JSON.stringify` không quá 48 KiB, cộng với câu hỏi vẫn dưới giới hạn 64 KiB của Task058.
- `checkAnswer(answer: string, pack: EvidencePack): { unknownNumbers: string[]; bannedClaims: string[] }`.

Tiêu chí xong:
- AC1: Đầu vào có thêm trường lạ, ví dụ `rows` kết quả, không lọt vào gói. Gói chỉ có các trường trong kiểu `EvidencePack`, kể cả khi gọi từ JS với object thừa trường.
- AC2: Gói quá cỡ thì cắt theo thứ tự có quy định: cắt `capacity` và cây plan sâu trước, SQL sau, đặt `sqlTruncated` khi cắt SQL. Không cắt giữa một ký tự UTF-16 đôi. Kích thước đo theo byte UTF-8, thử với SQL tiếng Việt và emoji.
- AC3: Số trong câu trả lời có trong bằng chứng không bị báo, kể cả viết `1.000`, `1,000`, `1000`, `4.640 KB`. Số `73` không có trong bằng chứng bị báo.
- AC4: Số trong khối ```sql và số thứ tự đầu dòng như `1.` không bị báo. `unknownNumbers` không trùng lặp.
- AC5: `bannedClaims` bắt được các câu kiểu "thiết kế này ổn", "thiết kế tốt rồi", "this design is fine", "looks good", cả viết hoa. Không báo nhầm "chưa thể nói thiết kế này ổn" hay câu trích nguyên tắc có phủ định, nếu không phân biệt được thì ghi rõ giới hạn và chọn báo thừa thay vì bỏ sót.
- AC6: `npm run check` thoát 0.

Ca biên: bằng chứng rỗng, câu trả lời rỗng, số âm, phần trăm, số trong tên bảng như `orders2`, số rất lớn, ký tự số không phải ASCII.
Kiểm tra: `cd web && npm run check`. Không cần chạy Playwright.
Góc review thêm: nhãn kết luận, nguyên tắc 2 và 7 trong `CLAUDE.md`, test có kiểm thật hay không.
Đọc thêm: `web/src/contracts/mentor.ts`; `CLAUDE.md` nguyên tắc 6 và mục "Capacity Advisor".
