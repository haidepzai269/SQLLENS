# SP012: AI Mentor

Kết quả: Người dùng đã đăng nhập hỏi AI về SQL của mình. AI chỉ nhận bằng chứng, không gọi được công cụ, không tự đưa ra số. SQL AI đề xuất phải chạy thử trước khi hiển thị.

Hợp đồng chung: `web/src/contracts/mentor.ts` (`EvidencePack`, `MentorRequest`, `MentorStreamEvent`), chốt trước khi chia task để Task058, Task059 và Task060 chạy song song.

Đợt 1 không cần key thật: test dùng máy chủ giả. Trước khi phát hành, chủ dự án phải điền key rồi kiểm với model thật, kèm câu hỏi nhét lệnh.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR053 AI proxy, STR054 phần máy chủ | Task058 | Route Gin, xoay model, stream, quota, prompt hệ thống và đóng gói bằng chứng | Task042, Task043 | 1 |
| STR054 Gói bằng chứng | Task059 | Dựng `EvidencePack`, kiểm số và câu cấm trong câu trả lời | Hợp đồng | 1 |
| STR055 Chạy thử SQL của AI | Task060 | Tách SQL, danh sách câu cho phép, chạy thử, lỗi thì không hiện | Task025, Task028, Task046 | 1 |
| STR056 Màn hình Mentor | Task061 | Hỏi đáp, stream, áp dụng đề xuất rồi so sánh | Task044, Task056, Task058, Task059, Task060 | 2 |
| STR057 AI Chaos Generator | chưa chia | Linh hoạt, không chặn phát hành | Task050, Task061 | sau |

## Các file bị đụng

| Task | File |
|---|---|
| Task058 | `api/internal/ai/**`, `api/cmd/server/main.go`, `api/.env.example` |
| Task059 | `web/src/modules/mentor/evidence/**` |
| Task060 | `web/src/modules/mentor/verify/**`, `web/messages/*/mentorVerify.json` |
| Task061 | `web/src/modules/mentor/ui/**`, `web/src/app/[locale]/e2e-mentor/**`, `web/messages/*/mentor.json`, `web/e2e/mentor.spec.ts` |
