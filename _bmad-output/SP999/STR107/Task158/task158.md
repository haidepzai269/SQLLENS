# Task158: Đóng nốt SP999 — 4 lỗi e2e hồi quy, định dạng Go, Retry-After, guardLocalOnly

Thuộc: SP999 / STR107
Mục tiêu: Làm sạch `main` bằng cách đưa lên những việc SP999 đã xác nhận là lỗi thật và không cần chủ dự án quyết.

Phạm vi (chỉ những file này):
- `web/src/components/sql-editor/sql-editor-impl.tsx`
- `web/src/modules/lab/lab-workspace.tsx`
- `web/e2e/golden-path.spec.ts`
- `web/e2e/mysql.spec.ts`
- `api/internal/ai/ai_test.go`, `api/internal/ai/inline_complete_test.go` (chỉ định dạng)
- `api/internal/auth/auth.go` (chỉ dòng `Retry-After`) và test của nó
- `api/internal/store/store_cloud_test.go` (chỉ `guardLocalOnly`)
- `_bmad-output/SP999/STR107/Task158/ban_giao_task158.md`

Không làm:
- **Không sửa `web/next.config.ts`.** Nhánh `fix/sp999-e2e-regressions` (commit `7248ffb`) đã đổi `turbopack.root` thành `path.parse(process.cwd()).root`; đó là mẹo chỉ để chạy trong worktree, **không được vào `main`**.
- Không đụng trần dung lượng cloud theo user (F2, chờ chủ dự án), không đổi cách chia xô rate limit (chờ chủ dự án), không đụng `cloud-panel.tsx`/`sync.ts`.
- Không đổi hành vi sản phẩm nào ngoài 4 mục AC dưới đây.

Hợp đồng:
- `Retry-After` phải là số giây nguyên, `>= 1`, và **không vượt quá độ dài cửa sổ** (60 s với `newRateLimiter(30, time.Minute)`).
- `guardLocalOnly(raw string) error` giữ nguyên chữ ký; chỉ siết điều kiện từ chối.

Bối cảnh có sẵn: nhánh `fix/sp999-e2e-regressions` (base `dc12ee0`, commit `7248ffb`) đã có bản sửa cho AC1 và một bàn giao `_bmad-output/SP999/ban_giao_sp999_regressions.md` nói 4 bộ test đều xanh. Nhánh đó **chưa merge** và `SP999/README.md` vẫn ghi 4 lỗi này "Chưa làm". Đọc bàn giao đó để tham khảo nguyên nhân, nhưng phải tự kiểm lại trên `main` hiện tại — đừng tin số cũ.

Tiêu chí xong:
- AC1: Bốn lỗi e2e của `main` hết đỏ. Nguyên nhân đã ghi ở `SP999/README.md` dòng Task113/114 (chữ 16px trên điện thoại), Task113/114 (Ctrl+Enter ở golden-path), Task128 (`?engine=mysql` bị ghi đè), Task133/135 (`.cm-sql-error` không hiện). Chạy thật `npx playwright test e2e/sql-editor.spec.ts e2e/golden-path.spec.ts e2e/lab.spec.ts` và ghi số test đạt/trượt thật. **Bẫy:** `playwright.config.ts` dùng `webServer.command = npm run start`, phục vụ bản `.next` đã build; phải `npm run build` lại sau khi sửa, không thì test xanh giả.
- AC2: `cd api && gofmt -l .` không in ra file nào. Chỉ sửa định dạng, không đổi logic; `go test ./internal/ai` vẫn xanh.
- AC3: `Retry-After` không còn vượt cửa sổ. Ca biên: chờ 59,4 s hiện `60`, không phải `61`; giá trị luôn `>= 1`. Có test chứng minh (đột biến: trả lại `int(wait.Seconds())+1` thì test đỏ).
- AC4: `guardLocalOnly` từ chối cả URL có query ghi đè host. Ca biên: `postgres://u:p@localhost:5432/app?host=db.invalid` bị từ chối; `?hostaddr=`, `?service=` cũng bị; URL localhost không có query vẫn qua. Có test.
- AC5: `e2e/mysql.spec.ts` **không chạy được** nếu không có sandbox MySQL trên Azure. Nếu không có, ghi rõ "chưa chạy" và **không** được nói đã đạt; nêu cách tái hiện.

Ca biên:
- Golden-path: `Ctrl+Enter` nay chỉ chạy câu tại con trỏ. Cách sửa test phải phản ánh hành vi người dùng thật (bôi đen rồi chạy), không được nới assertion cho xanh.
- `lab-workspace.tsx`: khi URL có `?engine=`, phải tôn trọng URL; khi không có, giữ nguyên hành vi cũ. Đổi qua lại `?engine=postgres` ↔ `?engine=mysql` không được tạo vòng lặp `router.replace`.
- `.cm-sql-error`: chỉ gắn lỗi parse khi vị trí tính trên đúng chuỗi trong ô soạn (SQL đã bỏ khối `COPY`/`LOCK` thì không khớp vị trí).

Giao diện (nếu có màn hình): không thêm chuỗi mới. Nếu buộc phải thêm thì đủ `vi` và `en` và `npm run check:i18n` phải xanh.

Kiểm tra:
- `cd api && gofmt -l . && go vet ./... && go test -p 1 ./internal/ai ./internal/auth ./internal/store` (hai package sau cần Postgres local trong Docker: `T042_DATABASE_URL` cho `auth`, `T149_DATABASE_URL` cho `store`; **luôn `-p 1`**, xem dòng Task157 trong `SP999/README.md`).
- `cd web && npm run check && npm run build` rồi Playwright như AC1.
- Tắt mọi server `npm run start`/`npm run dev` trước khi báo cáo (Windows khóa file).

Góc review thêm: bảo mật (AC4), nhãn kết luận (không được đổi nhãn Thật/Mô phỏng/Ước lượng), giao diện (chữ 16px mobile).
Đọc thêm: `_bmad-output/QUY_TRINH.md`, `_bmad-output/SP999/README.md` (dòng Task113/114, Task128, Task133/135, Task149, Task157), `_bmad-output/SP999/ban_giao_sp999_regressions.md`.
