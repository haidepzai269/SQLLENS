# Bàn giao Task120

Đã làm: Mở rộng Gin Backend API tiếp nhận trường `evidence_plan` có kiểm tra UTF-8 và độ dài tối đa 300 runes; cấu hình System Prompt và User Prompt phân nhánh ngữ cảnh thông minh (hỏi hiệu năng bắt buộc dùng số liệu thẻ `<QUERY_PLAN_EVIDENCE>` làm bằng chứng nhãn Thật, hỏi cú pháp/lý thuyết bỏ qua hoàn toàn thẻ này); mở rộng `MentorRequest` và `MentorPanel` truyền `evidence_plan` qua module `web/src/modules/mentor/api/chat.ts`; xây dựng bộ kiểm thử `live-plan-evidence.test.ts` chạy thực tế với model Groq Qwen 3.8-27B đạt chuẩn cả 2 kịch bản của AC5.
File chính:
- `api/internal/ai/ai.go`
- `api/internal/ai/ai_test.go`
- `web/src/contracts/mentor.ts`
- `web/src/modules/mentor/api/chat.ts`
- `web/src/modules/mentor/ui/mentor-panel.tsx`
- `web/src/modules/mentor/ui/mentor-panel.test.tsx`
- `web/src/modules/mentor/verify/live-plan-evidence.test.ts`
Kết quả kiểm tra:
- `cd api; go test -count=1 ./...`: PASS 100% tất cả các package backend.
- `cd web; npm run check`: PASS 100% (i18n check, ESLint 0 error, TypeScript 0 error, Vitest 80 test files / 915 tests PASS).
- `live-plan-evidence.test.ts` (Live Model Call): PASS 100% cả 2 kịch bản AC5 (Kịch bản 1: chỉ rõ Seq Scan và 3 buffers do bảng nhỏ 5 dòng; Kịch bản 2: giải thích cú pháp, hoàn toàn không nhắc Seq Scan hay Buffers).
Kết quả review: Reviewer độc lập đã thẩm định mã nguồn và kiểm chứng chạy thật với model AI, kết luận PASS 100%, 0 lỗi, 0 mục needs_validation.
Chưa làm được: Không có.
Phát sinh: Không có.
Việc tiếp theo cần biết: Task121 (STR088) sẽ xây dựng giao diện hiển thị badge `PlanEvidencePill`, cụm 3 nút Smart Action Chips trong Chat Drawer, và rào chắn Engine Guard bảo vệ phiên MySQL sandbox.
