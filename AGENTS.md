# SQLLens: Bộ nhớ & Quy tắc dự án dành cho Agent

Đọc file này trước khi làm bất kỳ việc gì trong dự án. Khi một quyết định thay đổi, cập nhật file này ngay trong cùng lượt làm việc.
Chi tiết số đo kiểm chứng thực nghiệm đầy đủ xem tại [CLAUDE.md](file:///c:/SQLLens/CLAUDE.md).

- **Tài liệu gốc:** [Google Doc](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)
- **Giai đoạn hiện tại:** Đã chốt 13 Epic và 61 Story (`_bmad-output/BAN_DO_STORY.md`). SP001, SP002, SP003, SP004, SP005, SP006, SP007, SP008, SP009, SP010 (hoàn thành 100%), SP012 (PostgreSQL xong), SP013 (Task080, Task081 xong). Đã bàn giao 79 task. Đang tập trung Đợt 5D (Task086: Tranh chấp 2 connection MySQL) và Đợt 4C (Task082: Security Audit & chốt release V1).
- **Mục tiêu trước mắt:** Xem `_bmad-output/MUC_TIEU_TRUOC_MAT.md` (hoàn tất luồng PostgreSQL trọn vẹn trên production có Auth + AI, sau đó đến MySQL).
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
