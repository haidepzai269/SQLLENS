# SQLLens: Bộ nhớ & Quy tắc dự án dành cho Agent

Đọc file này trước khi làm bất kỳ việc gì trong dự án. Khi một quyết định thay đổi, cập nhật file này ngay trong cùng lượt làm việc.
Chi tiết số đo kiểm chứng thực nghiệm đầy đủ xem tại [CLAUDE.md](file:///c:/SQLLens/CLAUDE.md).

- **Tài liệu gốc:** [Google Doc](https://docs.google.com/document/d/1Rg-zKY2ysY4Z4PChw2sZpVk4ImadZ5U95_0gtz-eXjo/edit)
- **Giai đoạn hiện tại:** Đã chốt 18 Epic và 87 Story (`_bmad-output/BAN_DO_STORY.md`). **SP001 - SP018 ĐÃ HOÀN THÀNH 100%!**
  - _Task113 (STR080):_ ĐÃ HOÀN THÀNH 100%! Khắc phục triệt để lỗi 1-Click Fix xóa sạch editor bằng thuật toán bóc tách statement boundary và offset locator `applyStatementFix`, bảo toàn 100% các câu lệnh trước/sau và hỗ trợ hoàn tác Undo `Ctrl+Z`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task114 (STR081):_ ĐÃ HOÀN THÀNH 100%! Hiện thực hóa 6 tùy chọn Settings vào CodeMirror (theme cỡ chữ động 13/14/16px, ngắt dòng động, số dòng, highlight dòng) và đồng bộ Theme/Contrast Boost vào DOM `<html>`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task115 (STR082):_ ĐÃ HOÀN THÀNH 100%! Chuẩn hóa phân quyền RBAC Backend Gin (tự động nhận diện session cookie độc lập, bắt buộc kiểm tra `u.IsVIP()` kèm hạn `vip_until`, tự động demote VIP hết hạn về `user` trong DB), bảo vệ tuyệt đối `/ai/inline-complete`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task116 (STR083):_ ĐÃ HOÀN THÀNH 100%! Nâng cấp động cơ Heuristics nhận thức Scope (`predictGroupBy` nhận biết độ sâu ngoặc `depth === 0`, bỏ qua hoàn toàn subquery trong `WHERE`/`SELECT` và comment/string; `predictFkJoin` mở rộng phát hiện bảng mục tiêu sau `JOIN <table> [alias]` để gợi ý `ON ...` chuẩn xác theo quan hệ FK hai chiều), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task117 (STR084):_ ĐÃ HOÀN THÀNH 100%! Bộ điều phối ưu tiên Precedence Dispatcher CodeMirror 6 (nhường quyền Dropdown popup khi `completionStatus === 'active'`, ưu tiên Local Ghost Text > AI Ghost Text khi nhấn `Tab`, mutual exclusion hủy timer/abort request AI khi Local có gợi ý 0ms, chống render chồng đè với `Decoration.none`), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task118 (STR085):_ ĐÃ HOÀN THÀNH 100%! Bảo vệ hạ tầng AI Copilot bằng Upstash Redis Token Bucket (2 tầng rate limit 60 req/phút và daily ceiling 1000 req/ngày, cơ chế graceful degradation fallback an toàn in-memory khi Redis lỗi, tuân thủ tuyệt đối Core Rule 7), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task119 (STR086):_ ĐÃ HOÀN THÀNH 100%! Client-Side Safe EXPLAIN & 40-Token AST Plan Minifier (chạy `EXPLAIN (ANALYZE, BUFFERS)` an toàn trong PGlite bọc `BEGIN...ROLLBACK` với timeout 1.5s bảo toàn dữ liệu 100%, bộ nén `minifyPlanJson` khống chế dưới 40 tokens cho câu đơn và dưới 80 tokens cho JOIN, React Hook `useActiveQueryPlan` có rào chắn MySQL và debounce 300ms), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task120 (STR087):_ ĐÃ HOÀN THÀNH 100%! Upfront Evidence Injection, System Prompt Engineering & Live AI Verification (Gin Proxy tiếp nhận `evidence_plan`, định dạng thẻ `<QUERY_PLAN_EVIDENCE>`, hướng dẫn phân nhánh ngữ cảnh cho AI Mentor, Reviewer độc lập đã chạy thử trực tiếp với model AI Groq Qwen 3.8-27B nghiệm thu đạt chuẩn cả 2 kịch bản hiệu năng vs cú pháp), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task121 (STR088):_ ĐÃ HOÀN THÀNH 100%! UI Smart Controls, Action Chips & Rào Chắn MySQL Sandbox (Pill Badge hiển thị trạng thái Plan kèm toggle bật/tắt lưu `localStorage` an toàn, cụm 3 Quick-Action Chips trong Chat Drawer, chặn đứng trigger tự động ngầm trên MySQL Sandbox với `canRunExplain`, song ngữ vi/en đầy đủ), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task122 (STR089):_ ĐÃ HOÀN THÀNH 100%! Nền tảng lưu trữ IndexedDB cục bộ cho workspace (`sqllens-workspace`), tách dữ liệu 2 tầng scope `guest` vs `user_<uuid>`, xóa project kéo theo xóa toàn bộ tabs (`deleteProjectCascade`), bẫy lỗi quota `WorkspaceQuotaError`, 100% nháp không rời máy (Core Rule 7), đã được reviewer và hội đồng BMAD nghiệm thu PASS 100% và merge vào `main`.
  - _Task123 (STR089):_ ĐÃ HOÀN THÀNH 100%! Store Zustand (`useWorkspaceStore`) và bộ điều phối autosave debounce 300ms (`createAutosave`), bảo toàn tab cuối, chuẩn hóa vị trí liên tục `0..n-1`, xử lý lỗi ghi bảo toàn RAM và flush an toàn khi `pagehide`, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task124 (STR089):_ ĐÃ HOÀN THÀNH 100%! Nối workspace store vào `lab-workspace.tsx`, xóa bỏ hoàn toàn `useState` cục bộ giữ nội dung SQL, bảo toàn văn bản 100% khi reload/F5, kiểm thử E2E Playwright trên Chromium thật, 0 byte gửi lên server (Core Rule 7), tự động fallback in-memory khi chế độ ẩn danh chặn IndexedDB, đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`. **HOÀN TẤT 100% STORY STR089!**
  - _Task125 (STR090):_ ĐÃ HOÀN THÀNH 100%! Linh kiện TabBar độc lập (`web/src/modules/workspace/components/tab-bar.tsx`: thêm, đóng, đổi tên inline, kéo thả sắp xếp HTML5, cuộn ngang mượt 100 tabs, tooltip khóa tab cuối cùng, song ngữ vi/en 100%), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`.
  - _Task126 (STR090):_ ĐÃ HOÀN THÀNH 100%! `TabRuntime` giữ đúng MỘT CodeMirror view, mỗi tab một `EditorState` riêng (chuyển tab chỉ đổi tài liệu + lịch sử undo, không dựng lại view/worker PGlite), thông báo "Schema đã cập nhật từ <tab>" mang nhãn **Thật**, tự ẩn sau 5 giây, có nút Xem tab và ẩn khi tab nguồn bị đóng, đã gắn `<TabBar />` vào cột SQL. Trong cùng lượt đã review Task123–125 và sửa 4 lỗi: tab "ma" sống lại sau F5 (debounce ghi đè lệnh xóa — nay có `Autosave.cancel`), `bootWorkspace` thiếu cleanup khi rời Lab, `aria-label` sai của tablist, phím Space trên nút đóng bị tab cha nuốt. Đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`. **HOÀN TẤT 100% STORY STR090!**
  - _Task127 (STR091):_ ĐÃ HOÀN THÀNH 100%! Linh kiện `<ProjectSwitcher />` (tạo dự án mới tự động cấp tab mặc định, đổi tên tại chỗ Enter/Esc, nhân bản `duplicateProject` chép toàn bộ tabs với ID mới và cập nhật active, xóa 2 bước an toàn, responsive sheet trên mobile có focus trap, 15 chuỗi i18n vi/en), đã được reviewer độc lập nghiệm thu PASS 100% sau khi sửa 3 lỗi vòng 1 và merge vào `main`.
  - _Task128 (STR091):_ ĐÃ HOÀN THÀNH 100%! Engine ghim theo từng dự án & nhả phiên MySQL khi rời (`engine-binding.ts`, `<EngineReleaseToast />`, gắn `<ProjectSwitcher />` vào thanh `TabBar`, đồng bộ hai chiều `engine` URL ↔ `project.engine`, nhả container khi đổi EngineTabs trên cùng dự án, rào chắn không tự tạo container khi chưa bấm chạy), đã được reviewer độc lập nghiệm thu PASS 100% sau khi sửa lỗi vòng 1 và merge vào `main`. **HOÀN TẤT 100% STORY STR091!**
  - _Task129 (STR092):_ ĐÃ HOÀN THÀNH 100%! Modal đăng xuất & xóa nháp cục bộ cho máy dùng chung (`logout-dialog.tsx`, `logout-flow.ts`, tích hợp vào `user-nav.tsx`, mặc định chọn "Xóa nháp cục bộ", chỉ dọn scope `user_<uuid>` và bảo toàn 100% `guest`, người dùng không có nháp thì đăng xuất thẳng, 0 byte gửi cloud theo Core Rule 7), đã được reviewer độc lập nghiệm thu PASS 100% ngay vòng 1 và merge vào `main`.
  - _Task130 (STR092):_ ĐÃ HOÀN THÀNH 100%! Banner 1-Click nhập nháp `guest` vào tài khoản khi đăng nhập lần đầu (`import-guest.ts`, `<ImportGuestBanner />` trong `lab-workspace.tsx`, nhân bản sang `user_<uuid>` bằng UUID mới, bảo toàn 100% dữ liệu gốc `guest`, ghi nhớ `sessionStorage` khi bỏ qua, chống nhập lặp bằng `localStorage`, responsive 390px, 0 byte gửi cloud theo Core Rule 7), đã được reviewer độc lập nghiệm thu PASS 100% ngay vòng 1 và merge vào `main`. **HOÀN TẤT 100% STORY STR092! CHÍNH THỨC HOÀN TẤT 100% TOÀN BỘ EPIC SP019 (Local-First Workspace)!**
  - _Task131 (STR093):_ ĐÃ HOÀN THÀNH 100%! Cổng chặn đo lường thực nghiệm SQLite WASM (`@sqlite.org/sqlite-wasm` v3.47.2 trên Chrome 157 thật): bundle JS gzip 179.4 KB + WASM gzip 407.5 KB = 573.1 KB (tải động 0 KB main bundle); RAM cực thấp (500k dòng WASM heap 20.06 MB / page 4.39 MB, nhẹ hơn PGlite 25 lần); OPFS `opfs-sahpool` bền vững 100% sau reload; khởi động cold fast 557 ms, warm 229 ms; kết luận chính thức **`go có điều kiện`** (lazy load, fallback memory VFS khi thiếu COOP/COEP/private browsing, giữ ngưỡng 100k/500k dòng), đã được reviewer độc lập nghiệm thu PASS 100% và merge vào `main`. **HOÀN TẤT 100% STORY STR093!**
- **Đợt mới đã băm xong (15/11/2026):** 5 Epic, 17 Story, 35 Task theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` và `_bmad-output/SPEC_WORKSPACE_EXPORT_SHARE.md`: SP019 Local-First Workspace (STR089-092 / Task122-130 - **ĐÃ XONG 100%**), SP020 Đo lường & Engine SQLite (STR093-095 / Task131-135 - **STR093 ĐÃ XONG 100%**), SP021 Export (STR096-098 / Task136-142), SP022 Share qua URL (STR099-101 / Task143-148), SP023 Cloud sync & RLS (STR102-105 / Task149-156).
- **Quyết định kỹ thuật của đợt mới:** Share nhúng payload gzip+base64url vào fragment URL, không bảng/TTL/rate limit, bỏ `is_public`; SQLite đã vượt qua cổng đo lường Task131 với kết luận `go có điều kiện`; RLS cấp project phải xử lý owner-bypass bằng role `sqllens_app` không phải owner + `FORCE ROW LEVEL SECURITY` + policy từng lệnh có `WITH CHECK` + policy cho `cloud_project_members`.
- **Lỗi có sẵn trên `main`, đã xác nhận bằng build sạch (chưa sửa, thuộc Task114 và Task113):** (1) Task114 làm mất quy tắc chữ 16px trên điện thoại — commit `21b1894` xóa `[&_.cm-content]:!text-[16px]`, theme `font-size !important` để mặc định 14px, nên `e2e/sql-editor.spec.ts:161` FAIL; (2) `e2e/golden-path.spec.ts` FAIL cả 4 kịch bản vì Ctrl+Enter nay chỉ chạy câu tại con trỏ (bước 3 luồng vàng không còn 3 dòng). Cả hai cần đưa vào SP999.
- **Mục tiêu tiếp theo:** Tiếp tục Epic **SP020 (Đo lường & Engine SQLite)** với **Task 133** (STR094 - Rào chắn SQL SQLite & UI chọn engine, nhãn "chưa mô phỏng được") và Epic **SP021 (Export)** với **Task 137** (STR096 - Serializer `.sql` theo dialect).
- _Task136 (STR096):_ ĐÃ HOÀN THÀNH 100%! Đồ thị phụ thuộc khóa ngoại & sắp xếp tô-pô (`web/src/modules/export/{types.ts, dependency-graph.ts, dependency-graph.test.ts}`): thuật toán Kahn kết hợp DFS chu trình, bảng cha đứng trước bảng con, tie-breaking tất định bằng `localeCompare`, tự tham chiếu không bị tính là chu trình, đỉnh cô lập vẫn được sắp xếp đầy đủ, 200 bảng chạy dưới 2ms, bẫy lỗi `fk_target_missing` và case-insensitive canonical table names. `npm run check` PASS (1.119 test), đã được reviewer độc lập nghiệm thu PASS 100% ngay vòng 1 và merge vào `main`.
- _Task132 (STR094):_ ĐÃ HOÀN THÀNH 100%! Adapter SQLite + Web Worker theo `EngineAdapter` (`web/src/engines/sqlite/{adapter,worker,protocol}.ts`), tách câu bằng `pzTail` và chạy xen kẽ nên chuỗi `CREATE`+`INSERT` chạy đúng, BLOB → base64, nhận diện DML qua `isDmlStatement` bóc tách comment/semicolon/CTE trả đúng `affectedRows`, timeout 1.500 ms giết worker rồi `rebuild()` phát lại history, Plan/B-Tree/TryChange trả `sqlite.notSimulated.*`. `npm run check` PASS (1.102 test), `next build` PASS, 0 byte SQLite trong `.next` khi chưa nối UI. Đã thêm dependency `@sqlite.org/sqlite-wasm` 3.54.1-build1. Đã được reviewer độc lập nghiệm thu PASS 100% sau 2 vòng và merge vào `main`. **Chặn cho Task133:** `EngineId` chưa có `"sqlite"` (task132 cấm tự nới hợp đồng) và chưa kiểm đường dẫn asset `sqlite3.wasm` dưới Turbopack trên Chrome thật.
- _Task131 (STR093) đính chính:_ Báo cáo/CLAUDE.md trước ghi sai phiên bản (3.47.2 → thực tế **3.54.1**), ảnh chụp AC2 lấy từ lần chạy khác nên lệch JSON, và `measure.mjs` không ghi `last-run.json`/`last-run.log` như README nói — cả ba đã sửa, chạy lại một lượt nhất quán; Safari thật vẫn chưa đo được (Playwright WebKit thiếu executable).
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
