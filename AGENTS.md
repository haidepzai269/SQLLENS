# SQLLens: Bộ nhớ & Quy tắc dự án dành cho Agent

Đọc file này trước khi làm bất kỳ việc gì trong dự án. Khi một quyết định thay đổi, cập nhật file này ngay trong cùng lượt làm việc.
Chi tiết số đo kiểm chứng thực nghiệm đầy đủ xem tại [CLAUDE.md](file:///c:/SQLLens/CLAUDE.md).

- **Tài liệu gốc:** [Google Doc](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)
- **Giai đoạn hiện tại:** Đã chốt 18 Epic và 84 Story (`_bmad-output/BAN_DO_STORY.md`). **SP001 - SP017 ĐÃ HOÀN THÀNH 100%!**
  + *Task113 (STR080):* ĐÃ HOÀN THÀNH 100%! Khắc phục triệt để lỗi 1-Click Fix xóa sạch editor bằng thuật toán bóc tách statement boundary và offset locator `applyStatementFix`, bảo toàn 100% các câu lệnh trước/sau và hỗ trợ hoàn tác Undo `Ctrl+Z`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task114 (STR081):* ĐÃ HOÀN THÀNH 100%! Hiện thực hóa 6 tùy chọn Settings vào CodeMirror (theme cỡ chữ động 13/14/16px, ngắt dòng động, số dòng, highlight dòng) và đồng bộ Theme/Contrast Boost vào DOM `<html>`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task115 (STR082):* ĐÃ HOÀN THÀNH 100%! Chuẩn hóa phân quyền RBAC Backend Gin (tự động nhận diện session cookie độc lập, bắt buộc kiểm tra `u.IsVIP()` kèm hạn `vip_until`, tự động demote VIP hết hạn về `user` trong DB), bảo vệ tuyệt đối `/ai/inline-complete`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task116 (STR083):* ĐÃ HOÀN THÀNH 100%! Nâng cấp động cơ Heuristics nhận thức Scope (`predictGroupBy` nhận biết độ sâu ngoặc `depth === 0`, bỏ qua hoàn toàn subquery trong `WHERE`/`SELECT` và comment/string; `predictFkJoin` mở rộng phát hiện bảng mục tiêu sau `JOIN <table> [alias]` để gợi ý `ON ...` chuẩn xác theo quan hệ FK hai chiều), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task117 (STR084):* ĐÃ HOÀN THÀNH 100%! Bộ điều phối ưu tiên Precedence Dispatcher CodeMirror 6 (nhường quyền Dropdown popup khi `completionStatus === 'active'`, ưu tiên Local Ghost Text > AI Ghost Text khi nhấn `Tab`, mutual exclusion hủy timer/abort request AI khi Local có gợi ý 0ms, chống render chồng đè với `Decoration.none`), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task118 (STR085):* ĐÃ HOÀN THÀNH 100%! Bảo vệ hạ tầng AI Copilot bằng Upstash Redis Token Bucket (2 tầng rate limit 60 req/phút và daily ceiling 1000 req/ngày, cơ chế graceful degradation fallback an toàn in-memory khi Redis lỗi, tuân thủ tuyệt đối Core Rule 7), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task119 (STR086):* ĐÃ HOÀN THÀNH 100%! Client-Side Safe EXPLAIN & 40-Token AST Plan Minifier (chạy `EXPLAIN (ANALYZE, BUFFERS)` an toàn trong PGlite bọc `BEGIN...ROLLBACK` với timeout 1.5s bảo toàn dữ liệu 100%, bộ nén `minifyPlanJson` khống chế dưới 40 tokens cho câu đơn và dưới 80 tokens cho JOIN, React Hook `useActiveQueryPlan` có rào chắn MySQL và debounce 300ms), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  + *Task120 (STR087):* ĐÃ HOÀN THÀNH 100%! Upfront Evidence Injection, System Prompt Engineering & Live AI Verification (Gin Proxy tiếp nhận `evidence_plan`, định dạng thẻ `<QUERY_PLAN_EVIDENCE>`, hướng dẫn phân nhánh ngữ cảnh cho AI Mentor, Reviewer độc lập đã chạy thử trực tiếp với model AI Groq Qwen 3.8-27B nghiệm thu đạt chuẩn cả 2 kịch bản hiệu năng vs cú pháp), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
- **Mục tiêu tiếp theo:** Triển khai **Task121 (STR088)**: UI Smart Controls, Action Chips & Rào Chắn MySQL Sandbox (Pill Badge hiển thị trạng thái Plan kèm toggle bật/tắt, cụm 3 Quick-Action Chips trong Chat Drawer, chặn đứng trigger tự động ngầm trên MySQL Sandbox, tích hợp mượt mà với `lab-workspace.tsx`).
- **Key bên thứ 3:** Danh sách ở `KEY_CAN_LAY.md` (gitignored). Không bao giờ commit secret lên git.

---

## Quy trình làm việc của Agent

Đọc `_bmad-output/QUY_TRINH.md` trước khi làm bất kỳ task nào:

1. Mỗi task nằm ở `_bmad-output/SP0xx/STR0xx/Task0xx/` và làm việc trong một **git worktree riêng**.
2. Dev làm việc theo `task0xx.md`, chạy kiểm tra bằng máy (`npm run check`, tests), commit theo mẫu quy trình.
3. Mỗi task có một `task-reviewer` độc lập kiểm tra trước khi bàn giao.
4. Review xong thì viết `ban_giao_task0xx.md` theo mẫu, commit và merge.
5. Việc phát sinh đưa vào `SP999`.

---

## Sản phẩm & Phạm vi V1

Nền tảng web giúp lập trình viên nhìn thấy thiết kế database của mình hỏng ở đâu trước khi code, đồng thời giúp người mới hiểu database chạy bên trong như thế nào.

**3 Trụ cột cốt lõi V1:**

- **A. Thấy bên trong:** B-Tree, luồng thực thi (Plan runner), sơ đồ schema.
- **B. Thử kịch bản hỏng:** Tranh chấp giữa 2 session (Conflict sim), tác động quy mô dữ liệu (Capacity advisor), sửa rồi chạy lại (What-if).
- **C. Kiểm tra thiết kế:** Danh sách rủi ro của schema và query kèm bằng chứng (Findings).

---

## Nguyên tắc cốt lõi KHÔNG ĐƯỢC PHÁ

1. **Mỗi kết luận mang đúng một nhãn:**
   - **Thật:** Database vừa chạy ra kết quả này.
   - **Mô phỏng:** Engine của dự án tính, đã đối chiếu với database thật.
   - **Ước lượng:** Ngoại suy khi vượt quy mô chạy được, số dòng do optimizer tự ước tính, hoặc rủi ro suy ra từ cấu trúc chưa chạy kịch bản hỏng.
2. **Không bao giờ nói "thiết kế này ổn".** Chỉ nói: với giả định này, kịch bản này hỏng hoặc không hỏng ở bước nào.
3. **Không trình bày thời gian chạy trong sandbox như dự đoán cho production.** So sánh bằng số dòng và số trang đã đọc.
4. **Không đoán khi chưa mô phỏng được.** Báo rõ `chưa mô phỏng được`.
5. **Giao diện cho người mới không chỉ có con số.** B-Tree phải có animation từ root qua internal xuống leaf, kèm câu giải thích hai ngôn ngữ (vi/en).
6. **SQL do AI đề xuất phải chạy thử trước khi hiển thị.** AI chỉ nhận dữ liệu làm bằng chứng và không có quyền gọi công cụ.
7. **Không ghi log SQL của người dùng.**
8. **SQL người dùng là không đáng tin:** Chạy bằng role quyền thấp, chặn `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`.

---

## Kiến trúc hệ thống

```text
Vercel: Next.js + PGlite (PostgreSQL chạy tại trình duyệt Web Worker)
  │
  └── Cần MySQL hoặc AI ──► Render free: Gin (auth, quota, AI proxy)
                               ├─► Neon: Postgres của app (users, sessions)
                               ├─► Upstash Redis: quota
                               ├─► Các model AI (Groq ZDR, OpenRouter deny data collection)
                               └─► Azure VM: sandbox agent ──► MySQL theo từng phiên (Docker)
```

- **Frontend:** Next.js 16 + TypeScript + shadcn/ui + Tailwind CSS + CodeMirror 6 + React Flow + GSAP.
- **Backend:** Gin (Go) trên Render free (Singapore), giữ thức 7:00 - 24:00 VN.
- **PostgreSQL:** PGlite 0.5.14 chạy hoàn toàn trong trình duyệt (Web Worker), nạp theo nhu cầu. Mặc định 100k dòng, tối đa 500k dòng có cảnh báo RAM.
- **MySQL:** Mỗi phiên 1 container Docker trên Azure VM B2ats v2, kết nối an toàn qua sandbox agent HTTPS ghim cert.
- **i18n:** Song ngữ Tiếng Việt & Tiếng Anh từ dòng code đầu tiên. Không hardcode chuỗi giao diện.
