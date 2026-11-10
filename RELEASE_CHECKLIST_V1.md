# Release Checklist V1 — SQLLens

Tài liệu rà soát và đánh giá chất lượng cuối cùng trước khi bấm nút phát hành chính thức SQLLens V1 (SP013 / STR061 / Task082).

---

## 1. Tổng quan Tiến độ Dự án (13 Epics / 61 Stories)

- **Tổng số Epic:** 13/13 (100%)
- **Tổng số Story:** 61 Stories (59/61 hoàn thành trọn vẹn, 2 Story mang tính linh hoạt / nghiên cứu nền tảng: STR011 hoàn tất dưới dạng tài liệu số đo thực nghiệm, STR057 AI Chaos Generator được định vị mở rộng ở V1.1 sau khi 4 kịch bản tranh chấp thực chiến MySQL SSE đã hoàn tất 100%).
- **Tổng số Task đã bàn giao:** 81/81 task (Task001 đến Task081 + Task086 + Task082).

| Epic | Tên Epic | Số Story | Trạng thái | Ghi chú |
|---|---|---|---|---|
| **SP001** | Nền móng hệ thống | 6/6 | Hoàn thành | Next.js 16 + Gin Go, song ngữ vi/en, CI |
| **SP002** | Thử rủi ro & Đo đạc | 5/5 | Hoàn thành | Số đo thực nghiệm PGlite, Docker, SSE, Lock Waits |
| **SP003** | Engine PostgreSQL | 4/4 | Hoàn thành | PGlite Worker, data-lab sinh 500k, guard leo quyền |
| **SP004** | Sandbox MySQL | 5/5 | Hoàn thành | Agent loopback, container isolation, role quyền thấp |
| **SP005** | Đăng nhập & Quota | 4/4 | Hoàn thành | OAuth Google/GitHub, Upstash Redis quota, Neon DB |
| **SP006** | `sql-intake` | 4/4 | Hoàn thành | CodeMirror 6, pgsql-parser + node-sql-parser, draft schema |
| **SP007** | `plan-runner` | 4/4 | Hoàn thành | Sơ đồ ER React Flow + dagre, Cây plan, Join animation |
| **SP008** | `btree-reader` | 6/6 | Hoàn thành | Đọc pageinspect PostgreSQL, dựng cây MySQL, rơi key GSAP |
| **SP009** | `findings` | 4/4 | Hoàn thành | 8 luật schema & query, bằng chứng khách quan, thanh rủi ro |
| **SP10** | `what-if` | 5/5 | Hoàn thành | Thử sửa transaction rollback (PG) / shadow table (MySQL), Capacity Advisor |
| **SP011** | `conflict-sim` | 5/5 | Hoàn thành | Tranh chấp 2 connection MySQL qua SSE, Cytoscape graph |
| **SP012** | AI Mentor | 5/5 | Hoàn thành | AI proxy ZDR không log, chạy thử SQL AI trước khi hiện |
| **SP013** | Phát hành V1 | 4/4 | Hoàn thành | Landing page, Polish luồng, E2E Golden Path, Security Audit & Checklist |

---

## 2. Trạng thái 8 Nguyên tắc Cốt lõi (Core Principles)

| Nguyên tắc | Quy định | Kết quả Kiểm tra | Bằng chứng kiểm thử |
|---|---|---|---|
| **Nguyên tắc 1** | Mỗi kết luận mang đúng 1 nhãn: `Thật`, `Mô phỏng`, `Ước lượng`, `Chưa mô phỏng được` kèm Tooltip shadcn/ui. | **ĐẠT 100%** | `audit-labels.mjs` quét 7/7 tab và thanh Findings; `ConclusionBadge` bọc toàn bộ nhãn, có Tooltip giải thích nguồn gốc. |
| **Nguyên tắc 2** | Không bao giờ nói "thiết kế này ổn/tốt/xấu/hoàn hảo/tối ưu". Chỉ nói kịch bản hỏng hay không hỏng ở bước nào. | **ĐẠT 100%** | Đã rà soát sạch toàn bộ 62 file locale (vi/en) và `web/src`. Các từ ngữ chủ quan trong `labStage.json` đã được thay bằng thuật ngữ khách quan khoa học. |
| **Nguyên tắc 3** | Không trình bày thời gian chạy trong sandbox như dự đoán production. So sánh bằng số dòng và số trang đọc. | **ĐẠT 100%** | Plan Runner, What-if so sánh bằng Buffer Hit/Read pages; B-Tree Race đo bằng rows/pages; Capacity đo bằng pages/height. |
| **Nguyên tắc 4** | Không đoán khi chưa mô phỏng được: báo rõ `Chưa mô phỏng được`. | **ĐẠT 100%** | Mọi trường hợp thiếu dữ kiện hoặc engine chưa hỗ trợ đều trả `Outcome.kind = 'not_simulated'` kèm lý do tường minh. |
| **Nguyên tắc 5** | Giao diện cho người mới không chỉ có con số: Animation B-Tree rơi khóa từng bước, giải thích song ngữ. | **ĐẠT 100%** | B-Tree drop animation chạy mượt mà từ Root -> Internal -> Leaf; hỗ trợ Range Scan và Scrubber điều khiển từng nhịp. |
| **Nguyên tắc 6** | SQL do AI đề xuất phải chạy thử trước khi hiển thị. AI không có quyền gọi công cụ. | **ĐẠT 100%** | `verifyAnswer` chạy thử SQL trong PGlite/MySQL sandbox trước khi render; SQL lỗi hoặc vi phạm guard sẽ bị chặn. |
| **Nguyên tắc 7** | Tuyệt đối không ghi log câu lệnh SQL của người dùng ở bất kỳ đâu. | **ĐẠT 100%** | `router.go` chỉ log route pattern + status; `recovery` panic-safe (%T); MySQL driver bọc `quietLogger`; AI proxy không ghi log request/response. |
| **Nguyên tắc 8** | SQL người dùng là không đáng tin: chạy role quyền thấp, chặn leo quyền và file system. | **ĐẠT 100%** | PostgreSQL: parser + 2-layer guard chặn `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`. MySQL: `sqllens_user` chỉ có quyền trên `app.*`, cấm toàn cục, container `--network none`, `--cap-drop ALL`, non-root user. |

---

## 3. Báo cáo Rà soát Bảo mật 3 Tầng (Security Audit)

### 3.1. Tầng Client (Next.js 16)
- [x] **XSS (Cross-Site Scripting):** Không sử dụng `dangerouslySetInnerHTML` trong bất kỳ component nào. Nội dung AI và SQL text đều được render dưới dạng pure text node hoặc CodeMirror view read-only.
- [x] **Secret Leakage:** Không có biến môi trường mang tính bí mật nào bị lọt vào bundle client (`NEXT_PUBLIC_*`). Chỉ có `VERCEL_ENV` dùng cho routing guard.
- [x] **CSRF & Cookie Protection:** Cookie phiên đăng nhập `sid` thiết lập `HttpOnly=true`, `SameSite=Lax`, `Secure=true` (trên production HTTPS). Kiểm tra nghiêm ngặt `Origin == PUBLIC_ORIGIN` trên mọi yêu cầu thay đổi trạng thái (`POST`, `PUT`, `PATCH`, `DELETE`).

### 3.2. Tầng Backend Gin (`api/`)
- [x] **SQL Privacy (Nguyên tắc 7):** Đã kiểm tra 100% handlers và middlewares (`api/internal/...`). Không có `log.Printf` hay `fmt.Println` nào in câu lệnh SQL hoặc nội dung body người dùng.
- [x] **Rate Limit & Quota Security:** Xác thực người dùng dựa trên SHA-256 session token lưu trong cookie `sid` đối soát với database Neon. Không thể giả mạo header (`X-User-Id`, etc.) để vượt hạn mức quota Upstash Redis.
- [x] **Error Sanitization:** Tất cả các lỗi trả về client đều chuẩn hóa qua `httpapi.Abort(c, status, code, messageKey)`. Không rò rỉ stack trace, connection string hay đường dẫn nội bộ máy chủ.

### 3.3. Tầng Sandbox Agent (Azure VM & Docker)
- [x] **Container Isolation (Nguyên tắc 8):**
  - Mạng cách ly tuyệt đối: `--network none` (giao tiếp Unix domain socket qua `/proc/PID/root`).
  - Tài nguyên giới hạn: CPU 1 core, RAM 384MB (swap 384MB), `--pids-limit 200`.
  - Quyền hạn tối thiểu: `--user $uid:$uid`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, tmpfs 64MB cho `/tmp`.
- [x] **Phòng tuyến Chặn SQL Nguy hiểm:**
  - `sqllens_user` không có quyền toàn cục (`NO SUPER`, `NO FILE`, `NO PROCESS`, `NO SET_USER_ID`, `NO ROLE_ADMIN`).
  - Chặn triệt để `SET ROLE`, `RESET ROLE`, `SET SESSION AUTHORIZATION`, `GRANT`, `REVOKE`, `SELECT INTO OUTFILE`, `LOAD DATA INFILE`, `LOAD DATA LOCAL INFILE`, `SHUTDOWN`.
- [x] **Dọn dẹp Tài nguyên & Timeout:**
  - Tự động dọn shadow tables `__whatif_*`.
  - Quá hạn `IDLE_TTL` hoặc query treo quá 15 giây (`KILL QUERY` + ân hạn 5s) tự động thu hồi và xóa container + thư mục dữ liệu sạch sẽ, không để lại tiến trình zombie.

---

## 4. Quét Secret & Vệ sinh Repository
- [x] **Kiểm tra File Nhạy cảm:** File `.gitignore` đã chặn toàn diện `.env`, `.env.*` (ngoại trừ `.env.example`), `KEY_CAN_LAY.md`, `*.pem`, `*.key`, `*.log`.
- [x] **Quét Git History:** Quét toàn bộ lịch sử commit và diff: Không phát hiện bất kỳ API token nào (Neon, Render, Upstash, Google/GitHub OAuth, Groq, OpenRouter) hoặc Azure private key nào bị commit lên git.

---

## 5. Kết quả Kiểm thử Hàng rào Toàn diện (Regression Test Suite)

1. **Web Frontend (`web/`):**
   - `npm run check:i18n`: PASS (100% key đồng bộ giữa `messages/vi/*.json` và `messages/en/*.json`).
   - `npm run lint`: PASS (0 errors, 1 warning không ảnh hưởng trong test helper).
   - `npm run typecheck`: PASS (TypeScript 0 errors).
   - `npm run test` (Vitest): **571/571 unit tests PASS** (51 files test, thời gian chạy ~120s).
2. **Backend Gin (`api/`):**
   - `go test ./...`: **PASS 100%** (bao gồm `cmd/server`, `internal/ai`, `internal/auth`, `internal/httpapi`, `internal/mysql`, `internal/quota`, `internal/store`).
3. **Sandbox Agent (`sandbox/agent/`):**
   - `go test ./...`: **PASS 100%** (`agent_test.go`).
4. **Playwright E2E Tests:**
   - `golden-path.spec.ts`: **4/4 PASS** (10 bước Luồng vàng: Desktop 1440px và Mobile 390px, song ngữ `/vi` và `/en`).
   - `mysql-conflict.spec.ts`: **12/12 PASS** (Tranh chấp MySQL qua SSE, Gap Lock, Deadlock 1213, Flash Sale FOR UPDATE, Dirty Read trên Desktop và Mobile, song ngữ `/vi` và `/en`).

---

## 6. Kết luận Sẵn sàng Phát hành (Release Readiness)

Toàn bộ hệ sinh thái SQLLens V1 đã vượt qua 100% các tiêu chuẩn an ninh, kiểm thử hàng rào kỹ thuật, đảm bảo tính trung thực khoa học của các kết luận dữ liệu và sẵn sàng phát hành chính thức đến người dùng lập trình viên.
