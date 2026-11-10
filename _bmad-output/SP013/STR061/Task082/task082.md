# Task082: Security Audit toàn diện, rà soát 100% nhãn kết luận, quét secret & Chốt Release Checklist V1

## 1. Mục tiêu & Bối cảnh
- **Story:** SP013 / STR061 (Kiểm tra cuối & Security Audit & Release Checklist V1).
- **Mục tiêu:** Thực hiện cuộc tổng kiểm tra và rà soát an ninh - bảo mật toàn diện trên cả 3 tầng hệ thống (Next.js frontend, Gin backend, Sandbox Agent Docker trên Azure VM); quét sạch secret và rà soát lịch sử commit; rà soát 100% nhãn kết luận và câu chữ trên toàn bộ giao diện và các file bản dịch nhằm bảo đảm tuyệt đối tuân thủ Nguyên tắc cốt lõi 1 & 2; chạy bộ kiểm thử hàng rào (Regression Suite) và lập Release Checklist V1 sẵn sàng bấm nút phát hành chính thức SQLLens.
- **Nguyên tắc cốt lõi KHÔNG ĐƯỢC PHÁ:**
  - **Nguyên tắc 1:** Mỗi kết luận mang đúng một nhãn (`Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được`). Mọi nhãn đều có Tooltip shadcn/ui giải thích ngữ nghĩa trung thực.
  - **Nguyên tắc 2:** Tuyệt đối không bao giờ nói "thiết kế này ổn" (hay tốt/xấu/hoàn hảo). Chỉ nói: với giả định này, kịch bản này hỏng hoặc không hỏng ở bước nào.
  - **Nguyên tắc 7:** Tuyệt đối không ghi log SQL của người dùng ở bất kỳ tầng nào (Gin logger, panic recovery, sandbox agent).
  - **Nguyên tắc 8:** SQL người dùng là không đáng tin (untrusted): Chạy bằng role quyền thấp, chặn triệt để `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`, chặn lệnh leo quyền và truy cập file hệ thống.
  - **Song ngữ:** 100% Tiếng Việt và Tiếng Anh đồng bộ, không hardcode chuỗi giao diện.

---

## 2. Tiêu chí nghiệm thu (Acceptance Criteria)

- **AC1 (Security Audit — 3 Tầng Hệ Thống):**
  1. *Frontend (Next.js):*
     - Không có lỗ hổng XSS (kiểm tra `dangerouslySetInnerHTML`, sanitize các chuỗi HTML/SVG).
     - Cookie xác thực an toàn (`SameSite=Lax`, `HttpOnly`, `Secure`). Kiểm tra Origin header chống CSRF.
     - Không để lộ secret trong bundle client (chỉ cho phép các biến `NEXT_PUBLIC_*` không mang tính bí mật).
  2. *Backend (Gin - Go):*
     - **Nguyên tắc 7:** Rà soát 100% middleware và handler trong `api/`, bảo đảm không có `log.Printf`, `fmt.Println` hay logger nào in câu lệnh SQL của người dùng.
     - Rate limit & Quota: Kiểm tra logic Upstash Redis quota, chống bypass bằng fake headers hoặc injection.
     - Error handling: Lỗi trả về client không làm lộ đường dẫn nội bộ máy chủ, database connection string hay stack trace.
  3. *Sandbox Agent (Azure VM & Docker):*
     - **Nguyên tắc 8:** Container chạy cách ly tuyệt đối (`--network none`, cgroups giới hạn CPU và RAM, non-root user).
     - Rà soát parser/filter chặn lệnh nguy hiểm: chặn `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`, `GRANT`, `REVOKE`, `INTO OUTFILE`, `LOAD DATA LOCAL INFILE`, `SHUTDOWN`.
     - Dọn sạch tài nguyên: Cơ chế dọn shadow tables `__whatif_*` và container hết hạn/bị hủy không để lại rác disk hoặc process zombie.

- **AC2 (Quét Secret & Vệ sinh Kho mã nguồn):**
  - Quét toàn bộ codebase và git commit history tìm kiếm các token, mật khẩu, private key (Neon, Upstash, Google/GitHub OAuth, Render API key, Azure SSH key).
  - Xác nhận file `.gitignore` đã chặn các file nhạy cảm (`.env`, `KEY_CAN_LAY.md`, `*.pem`, `*.key`).
  - Đảm bảo trong mã nguồn chỉ tồn tại các biến môi trường mẫu (`.env.example`).

- **AC3 (Rà soát 100% Nhãn Kết luận & Anti-Bias Audit):**
  - Viết script kiểm tra tự động quét 12 file bản dịch (`web/src/locales/vi/*.json` và `en/*.json`) và các component TSX:
    - Tìm và triệt tiêu tất cả các từ ngữ vi phạm Nguyên tắc 2: *"ổn"*, *"tốt"*, *"xấu"*, *"tối ưu"*, *"good"*, *"fine"*, *"perfect"*, *"optimal"*.
    - Mọi kết luận ở cả 7 tab (Sơ đồ, Plan, B-Tree, Thử sửa, Capacity, Mentor, Tranh chấp) và thanh Rủi ro Findings đều mang đúng 1 nhãn chuẩn và bọc `ConclusionBadge` kèm Tooltip.

- **AC4 (Kiểm thử Hàng rào Toàn diện - Regression Test Suite):**
  - `npm run check` (i18n check + ESLint + TypeScript + Vitest 571+ unit tests) đạt 100% PASS.
  - Go tests trong `api/...` và `sandbox/agent/...` đạt 100% PASS.
  - Playwright E2E tests:
    - `web/e2e/golden-path.spec.ts` (10 bước Golden Path PostgreSQL) PASS 100% (cả Desktop 1440px và Mobile 390px, cả `/vi` và `/en`).
    - `web/e2e/mysql-conflict.spec.ts` (Tranh chấp MySQL SSE) PASS 100%.

- **AC5 (Release Checklist V1 & Tài liệu Bàn giao):**
  - Lập file `RELEASE_CHECKLIST_V1.md` tại gốc repo tổng kết 13 Epics, 61 Stories và các tiêu chuẩn sẵn sàng phát hành.
  - Soạn thảo tài liệu bàn giao [`ban_giao_task082.md`](file:///c:/SQLLens/_bmad-output/SP013/STR061/Task082/ban_giao_task082.md) theo chuẩn quy trình dự án.

---

## 3. File tác động & Tạo mới
- Tạo mới:
  - `_bmad-output/SP013/STR061/Task082/task082.md`
  - `_bmad-output/SP013/STR061/Task082/ban_giao_task082.md`
  - `RELEASE_CHECKLIST_V1.md`
  - `web/scripts/audit-labels.ts` (hoặc script audit nhãn/từ ngữ vi phạm)
- Tác động (nếu phát hiện điểm cần vá):
  - `web/src/locales/vi/*.json`, `web/src/locales/en/*.json` (nếu có câu chữ vi phạm)
  - `api/internal/...` (nếu phát hiện log SQL hoặc leak error)
  - `sandbox/agent/...` (nếu phát hiện lỗ hổng sandbox filter)

---

## 4. Kiểm tra chất lượng (Verification)
1. Chạy script audit nhãn và bảo mật: 0 lỗi vi phạm.
2. `npm run check` -> PASS 100%.
3. `go test ./...` -> PASS 100%.
4. `npx playwright test web/e2e/golden-path.spec.ts` -> PASS 100%.
5. Review độc lập bởi `task-reviewer` đạt PASS trước khi merge.
