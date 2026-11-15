# Bản nháp phân rã Story: SPEC-workspace-export-share

- **Nguồn:** `_bmad-output/SPEC_WORKSPACE_EXPORT_SHARE.md`
- **Trạng thái:** Đã băm Task (2026-11-15). 17 Story, 35 Task, số hiệu `Task122` – `Task156`.
- **Ngày:** 2026-11-15 (bản 3, băm Task theo mẫu `QUY_TRINH.md` mục 4)
- **Story kế tiếp:** `STR089` (story cuối hiện tại là `STR088`)

## 0. Quyết định đã chốt (2026-11-15)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Cloud sync & RLS | **CÓ làm.** RLS ở cấp project. Bắt buộc xử lý việc role tạo bảng là owner nên mặc định bỏ qua RLS — đây là yêu cầu cứng, không phải ghi chú |
| 2 | Share công khai | **Nhúng vào URL**, ưu tiên nhẹ và đơn giản trước. Không bảng share, không TTL, không rate limit, không endpoint tạo link |
| 3 | SQLite | **Đo bundle và RAM trước**, có số thật rồi mới duyệt engine |

Hệ quả của (2): Story share đổi hoàn toàn. Không còn `POST /api/v1/shares`, không còn `shared_snapshots`, không còn job dọn TTL, không còn `is_public` trên `cloud_projects` (vì bỏ nó thì chỉ còn một đường công khai duy nhất là URL). Đổi lại: giới hạn độ dài URL và mất OG card cá nhân hóa — hai cái này phải nói rõ với người dùng, không giấu.

Hệ quả của (3): thêm một Story đo lường (STR093) đứng trước Story engine SQLite.

## 1. Phân rã Epic

| Epic | Tên | Story | Phụ thuộc cứng |
|---|---|---|---|
| **SP019** | Local-First Workspace (Nháp, Tabs, Đa dự án) | STR089 – STR092 | Không |
| **SP020** | Đo lường & Engine SQLite thứ ba | STR093 – STR095 | SP019 |
| **SP021** | Xuất báo cáo & sơ đồ (Export) | STR096 – STR098 | đã có schema từ SP003 |
| **SP022** | Chia sẻ Snapshot qua URL | STR099 – STR101 | SP019 |
| **SP023** | Đồng bộ Cloud & RLS cấp Project | STR102 – STR105 | SP019 |

Tổng: **17 Story, STR089 – STR105.**

## 2. SP019 — Local-First Workspace

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| **STR089** Workspace Store & nháp IndexedDB | Tạo tab/dự án khi chưa đăng nhập, F5 không mất nội dung, dữ liệu tách namespace `guest` và `user_<uuid>`, không request nào mang nội dung nháp | Có | |
| **STR090** Tab Bar đa tab & phiên sandbox dùng chung | Thêm/đóng/đổi tên/kéo sắp xếp tab; chuyển tab đổi nội dung CodeMirror nhưng schema và dữ liệu giữ nguyên; DDL ở tab khác hiện "Schema đã cập nhật từ Tab X" | Có | Thật |
| **STR091** Đa dự án & engine ghim theo dự án | Switcher tạo/đổi tên/nhân bản/xóa dự án; mỗi dự án ghim 1 engine và giữ sandbox riêng; rời dự án MySQL nhả phiên container | Có | Thật |
| **STR092** Chính sách máy dùng chung | Modal khi đăng xuất hỏi xóa hay giữ nháp cục bộ; đăng nhập lần đầu có nháp `guest` thì có banner 1-Click nhập vào tài khoản | Có | |

**STR089 — Workspace Store & nháp IndexedDB**
- Phạm vi: store Zustand + lớp IndexedDB (`sqllens_workspaces`), schema version và migration, autosave debounce 300ms + flush khi `pagehide`.
- AC1: Tạo 3 tab, gõ nội dung, F5 → cả 3 tab và nội dung còn nguyên, đúng tab đang mở.
- AC2: Đăng xuất user A, đăng nhập user B trên cùng máy → B không thấy nháp của A; quay lại A vẫn thấy.
- AC3: Network: không request nào chứa nội dung SQL nháp (Core Rule 7).
- AC4: IndexedDB đầy (`QuotaExceededError`) → lỗi rõ ràng, dữ liệu đã lưu trước đó vẫn còn, không âm thầm mất.
- Ca biên: 2 tab trình duyệt cùng mở (ghi đè chéo), SQL 2MB một tab, xóa cache giữa phiên.
- Không làm: cloud sync, share, lịch sử phiên bản.

**STR090 — Tab Bar đa tab & phiên sandbox dùng chung**
- AC1: Thêm, đóng, đổi tên, kéo sắp xếp; đóng tab đang mở chọn tab kế bên; luôn còn ít nhất 1 tab.
- AC2: Chuyển tab không khởi tạo lại PGlite (không có log khởi tạo worker, chuyển < 50ms).
- AC3: Tab 1 `CREATE TABLE`, tab 2 `SELECT` bảng đó → chạy được; tab 2 nhận thông báo "Schema đã cập nhật từ Tab 1".
- AC4: 100 tab vẫn cuộn mượt (không mount toàn bộ CodeMirror cùng lúc).
- Ca biên: tên tab trùng/rỗng, tab 0 ký tự, kéo thả cùng vị trí.

**STR091 — Đa dự án & engine ghim theo dự án**
- AC1: Tạo dự án mới chọn engine; danh sách hiện engine và thời gian sửa cuối.
- AC2: Đổi dự án nạp đúng tabs và đúng engine; Postgres và SQLite mở song song không lẫn dữ liệu.
- AC3: Xóa dự án → xác nhận 2 bước, xóa luôn tabs trong IndexedDB.
- AC4: Rời dự án MySQL → nhả phiên container (kiểm trạng thái phiên ở sandbox agent).
- Ca biên: 10 dự án Postgres cùng lúc (RAM), nhân bản dự án đang có dữ liệu.

**STR092 — Chính sách máy dùng chung**
- AC1: Đăng xuất → modal 2 lựa chọn (Xóa nháp cục bộ / Giữ lại), mặc định Xóa, có câu giải thích.
- AC2: Xóa chỉ xóa scope `user_<uuid>`, không đụng `guest`, không đụng dự án cloud.
- AC3: Đăng nhập lần đầu khi máy có nháp `guest` → banner nhập 1-Click; nhân bản sang scope user, bản guest giữ nguyên.
- AC4: Song ngữ vi/en, đọc được trên 390px.

## 3. SP020 — Đo lường & Engine SQLite

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| **STR093** Đo bundle & RAM SQLite WASM | Có số thật về bundle, RAM, thời gian khởi động của SQLite WASM trên Chrome thật; có quyết định go/no-go ghi vào `CLAUDE.md` | | Thật |
| **STR094** SQLite chạy trong trình duyệt | Chọn engine SQLite, chạy DDL/DML/SELECT trong máy, 0 request server, tab Plan/B-Tree nói rõ "chưa mô phỏng được" | Có | Thật |
| **STR095** Nhập/xuất file `.sqlite` / `.db` | Nạp file từ máy vào sandbox SQLite, chạy query, xuất lại file; file hỏng hoặc quá lớn báo lỗi rõ | Có | Thật |

**STR093 — Đo bundle & RAM SQLite WASM (cổng chặn)**
- Đây là Story đo lường, không ra tính năng (giống tinh thần SP002).
- AC1: Đo kích thước gzip của JS + WASM, riêng và tổng, ở trạng thái chỉ tải khi chọn SQLite.
- AC2: Đo RAM ở 10k / 100k / 500k dòng bằng `performance.measureUserAgentSpecificMemory()` hoặc `page.memory` trên Chrome thật; ghi số, không ghi "nhẹ".
- AC3: Đo thời gian khởi động lần đầu và lần sau (cache), trên mạng throttled 3G nếu được.
- AC4: Kiểm `OPFS` / persistence có dùng được trên Vercel và trên Safari thật.
- AC5: Ghi bảng số vào `CLAUDE.md` + kết luận go / no-go / go-có-điều-kiện. Nếu no-go thì STR094 và STR095 dừng, không được tự đổi sang engine khác.

**STR094 — SQLite chạy trong trình duyệt**
- Phạm vi: adapter SQLite cùng hợp đồng `EngineAdapter` hiện có, WASM chỉ tải khi chọn SQLite.
- AC1: `CREATE TABLE` + `INSERT` + `SELECT` ra lưới đúng nội dung, đúng số dòng.
- AC2: Trang editor không nặng thêm byte nào khi chưa chọn SQLite (so kích thước chunk).
- AC3: Rào chắn: chặn `ATTACH`, `VACUUM INTO`, `load_extension`; không có đường ghi ra ngoài vùng nhớ WASM.
- AC4: Tab Plan / B-Tree với SQLite hiện `chưa mô phỏng được` kèm lý do (không có `EXPLAIN (ANALYZE, BUFFERS)`, không có `pageinspect`), **không** vẽ dữ liệu giả (Core Rule 4).
- Ca biên: lỗi cú pháp, query treo (timeout + nút hủy), 100k dòng kết quả, tên bảng Unicode.

**STR095 — Nhập/xuất file `.sqlite` / `.db`**
- AC1: Chọn file `.sqlite`/`.db` → nạp vào FS của WASM, liệt kê bảng đúng.
- AC2: Sửa rồi xuất file, mở lại bằng client khác đọc được.
- AC3: File > 50MB hoặc không phải SQLite → lỗi rõ, không treo tab.
- AC4: File không rời khỏi máy (0 request upload).

## 4. SP021 — Xuất báo cáo & sơ đồ

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| **STR096** Xuất `.sql` chuẩn hóa | File `.sql` tải về chạy được ngay, bảng cha trước bảng con, vòng khóa ngoại tách `ALTER` xuống cuối | Có | Thật |
| **STR097** Xuất ảnh ERD PNG & B-Tree SVG | Tải PNG sơ đồ bảng đúng vùng có tiến trình; tải SVG cây B-Tree vector | Có | Thật |
| **STR098** Báo cáo Audit PDF A4 | In ra PDF 3 trang, giữ đủ 3 nhãn, có disclaimer, không cắt đôi card | Có | Theo nguồn |

**STR096 — Xuất `.sql` chuẩn hóa**
- AC1: Schema 5 bảng khai báo lộn xộn → file tải về chạy trong PGlite **không lỗi FK** (test chạy file thật, không so chuỗi).
- AC2: Vòng A↔B → `FOREIGN KEY` tách thành `ALTER TABLE ... ADD CONSTRAINT` ở khối cuối.
- AC3: Header metadata: engine, thời điểm, tên dự án, thứ tự phụ thuộc.
- AC4: Cùng schema → cùng file (deterministic).
- Ca biên: bảng tự tham chiếu, bảng không FK, tên có nháy kép/backtick theo engine, schema rỗng, MySQL và SQLite.

**STR097 — Xuất ảnh ERD PNG & B-Tree SVG**
- AC1: PNG chụp đúng `.react-flow__viewport`, không dính minimap/zoom control, scale 2x.
- AC2: Có tiến trình khi xuất 50 bảng; UI vẫn phản hồi trong lúc chờ.
- AC3: SVG mở lại bằng trình duyệt và trình xem vector, nét đúng, không mất node.
- Thư viện: `modern-screenshot` (phiên chính thêm). SVG dùng `XMLSerializer` có sẵn.
- Ca biên: tab đang ẩn (`display: none`), theme sáng/tối, sơ đồ 1 bảng.

**STR098 — Báo cáo Audit PDF A4**
- AC1: 3 trang đúng bố cục (bìa + điểm sức khỏe, findings kèm bằng chứng, kế hoạch thực thi).
- AC2: Mọi kết luận giữ đúng nhãn Thật / Mô phỏng / Ước lượng; không câu nào hàm ý "thiết kế ổn" (Core Rule 2).
- AC3: Tiếng Việt không lỗi font; `break-inside: avoid` giữ card không bị cắt.
- AC4: In bằng Playwright ra PDF và kiểm tra thật.
- AC5: Disclaimer sandbox ở chân trang.

## 5. SP022 — Chia sẻ Snapshot qua URL

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| **STR099** Mã hóa snapshot vào URL | Bấm Share là có link chứa toàn bộ snapshot, không gửi byte nào lên server; quá lớn thì báo và cho tải file thay thế | Có | Thật |
| **STR100** Trang `/share` chỉ đọc | Mở link là thấy snapshot đúng thiết kế prototype, không sửa được, không có dữ liệu nào rời máy | Có | Thật |
| **STR101** Fork vào workspace & chạy thử | Người nhận fork 1-Click thành dự án riêng và chạy thử cục bộ | Có | Thật |

**STR099 — Mã hóa snapshot vào URL**
- Phạm vi: `JSON.stringify` payload có version → `CompressionStream('gzip')` (native, không thêm thư viện) → base64url → `/share#d=<payload>`. Fragment (`#`) không bao giờ được gửi lên server.
- AC1: Bấm Share → sinh URL, **0 request** chứa nội dung (kiểm bằng network log).
- AC2: Cùng snapshot → cùng URL (khóa được sắp xếp, không có timestamp trong payload). Chống trùng miễn phí.
- AC3: Ngưỡng kích thước: encoded ≤ 8KB bình thường; 8–32KB cảnh báo "dán vào ứng dụng chat có thể bị cắt"; > 32KB chặn, đề xuất tải file `.sqllens`.
- AC4: Nút Sao chép link + nút Tải file snapshot; cảnh báo rõ "ai có link đều đọc được toàn bộ SQL trong đó".
- AC5: Payload có `v: 1` để sau này đọc được link cũ; có test giải mã ngược.
- AC6: Kiểm `CompressionStream` trên Safari thật; nếu thiếu thì fallback không nén, không vỡ link.
- AC7: Không log nội dung (Core Rule 7).
- Góc review: bảo mật + UX.

**STR100 — Trang `/share` chỉ đọc**
- AC1: Đọc payload từ `location.hash`, giải nén client-side, render read-only; snapshot 50KB hiện xong < 300ms.
- AC2: Hash hỏng / không giải nén được / sai version → màn hình lỗi tử tế, không trắng trang, có nút "Về trang chủ".
- AC3: Bám đúng `share_preview_prototype.html`: Public Sans, JetBrains Mono, `--stage #0e0e10`, `--lamp #f2b84b`, `--radius 4px`.
- AC4: CodeMirror `readOnly: true`, vẫn highlight, số dòng, Ctrl+F, nút Sao chép; tab bar chỉ đọc, không nút thêm/đóng tab.
- AC5: Route `/share` đặt `Referrer-Policy: no-referrer` để link không rò sang site khác.
- AC6: 0 request chứa nội dung snapshot (mọi thứ chạy trong máy người xem).
- AC7: OG card: **chỉ card tĩnh chung cho route**, không cá nhân hóa được vì crawler không đọc fragment — ghi rõ trong bàn giao, không hứa preview đẹp.
- AC8: vi/en đầy đủ; mở được trên 390px.

**STR101 — Fork vào workspace & chạy thử**
- AC1: Fork clone 100% tabs vào IndexedDB theo scope hiện tại, chuyển về editor, có toast xác nhận.
- AC2: Fork 2 lần không tạo 2 bản trùng, hoặc cảnh báo rõ.
- AC3: Chạy thử chạy trong PGlite/SQLite của máy người xem, 0 request, snapshot trong URL không đổi.
- AC4: Snapshot engine MySQL → nút chạy thử nói rõ cần sandbox, không tự tạo container (theo rào chắn STR088).

## 6. SP023 — Đồng bộ Cloud & RLS cấp Project

| Story | Hành vi khi xong | GD | Nhãn |
|---|---|---|---|
| **STR102** Bảng cloud & API lưu dự án | Đăng nhập thì "Lưu vào Cloud" được, dữ liệu ở Neon, không autosave ngầm, có xóa vĩnh viễn | Có | Thật |
| **STR103** RLS cấp project & role không phải owner | User A không đọc/ghi được dự án của B kể cả gọi thẳng API sai; có test cross-tenant chạy thật bằng role app | | Thật |
| **STR104** Đồng bộ local ↔ cloud | Kéo dự án từ cloud về máy và đẩy ngược lên; xung đột được cảnh báo, không ghi đè im lặng | Có | Thật |
| **STR105** Cổng `security-audit` | Chạy `security-audit` đầy đủ trong Docker tắt mạng, không còn lỗi nghiêm trọng trước khi đóng Epic | | |

**STR102 — Bảng cloud & API lưu dự án**
- Phạm vi: migration `cloud_projects`, `cloud_tabs`, `cloud_project_members`; Gin CRUD; **không** có cột `is_public` (đã bỏ vì share đi đường URL).
- AC1: Lưu chỉ xảy ra khi bấm nút, không có timer đẩy ngầm.
- AC2: Xóa dự án cloud → xóa thật, có xác nhận, không soft-delete mập mờ.
- AC3: Giới hạn: N dự án / user và M KB / tab, vượt thì 400 rõ ràng.
- AC4: Log Gin không chứa SQL (Core Rule 7).

**STR103 — RLS cấp project & role không phải owner** *(yêu cầu cứng của chủ dự án)*
- AC1: Role ứng dụng **không phải owner** của bảng: migration tạo role riêng (`sqllens_app`), chủ bảng là role migration; `GRANT` chỉ quyền cần thiết; role app **không** có `SUPERUSER`, **không** có `BYPASSRLS`.
- AC2: Bật `FORCE ROW LEVEL SECURITY` trên cả 3 bảng làm lớp thứ hai, phòng trường hợp role app trùng owner ở môi trường nào đó.
- AC3: Policy tường minh theo từng lệnh (SELECT / INSERT / UPDATE / DELETE), **có `WITH CHECK`** cho INSERT và UPDATE, không dựa vào `FOR ALL`.
- AC4: `cloud_project_members` **phải có policy** (thiếu policy = bảng khóa sạch, collaborator không thấy gì — lỗi này có trong spec gốc).
- AC5: `SET LOCAL app.current_user_id` bọc trong transaction bắt buộc; helper duy nhất được phép mở kết nối; có test chứng minh không rò ngữ cảnh user giữa 2 request liên tiếp trên cùng connection pool.
- AC6: Test cross-tenant chạy thật: user A dùng đúng role app, cố `SELECT`/`INSERT`/`UPDATE` dự án của B → 0 dòng hoặc lỗi; test này phải fail nếu tắt RLS.
- Góc review: bảo mật bắt buộc (`ATTACK-CLASSES.md`).

**STR104 — Đồng bộ local ↔ cloud**
- AC1: Kéo dự án từ cloud về máy tạo bản local đúng tabs, đúng engine.
- AC2: Đẩy bản local lên khi bản cloud đã đổi → cảnh báo xung đột, cho chọn, không ghi đè im lặng.
- AC3: Mất mạng giữa lúc đẩy → không để lại bản ghi nửa vời.
- AC4: Đăng xuất không xóa bản cloud; xóa tài khoản thì xóa theo (nếu có luồng xóa tài khoản).

**STR105 — Cổng `security-audit`**
- AC1: Chạy `security-audit` đầy đủ trong Docker tắt mạng trên toàn bộ diff của SP022 + SP023.
- AC2: Không còn lỗi nghiêm trọng; lỗi còn lại ghi vào `SP999` kèm lý do.
- AC3: Kiểm riêng: URL share không rò referrer, payload không bị render thành HTML sống (XSS), RLS test vẫn xanh.

## 7. Ba điểm phải nói rõ với người dùng (không được giấu)

1. **Link share chứa toàn bộ SQL.** Nhẹ và riêng tư theo nghĩa không lưu trên máy chủ, nhưng link nằm trong lịch sử trình duyệt và ai có link đều đọc được. Phải có câu cảnh báo ngay chỗ nút Sao chép.
2. **Không có OG card cá nhân hóa.** Crawler không đọc phần sau dấu `#`, nên preview khi dán link là card tĩnh chung. Đây là giá của phương án nhúng URL.
3. **URL có trần.** Link quá dài bị ứng dụng chat cắt. Có ngưỡng cảnh báo và đường lui là tải file `.sql` / `.sqllens`.

## 8. Thứ tự và nhóm chạy song song

- **Đợt 1 (song song được):** STR089, STR096, STR098, STR093 (đo SQLite — độc lập, chỉ cần máy chạy Chrome).
- **Đợt 2:** STR090, STR091 (cần STR089), STR097 (dùng chung nút Export với STR096), STR099 (cần STR089 để đóng gói payload).
- **Đợt 3:** STR092, STR100 (cần STR099), STR101 (cần STR100), STR094 (nếu STR093 go).
- **Đợt 4:** STR095 (cần STR094), STR102 → STR103 → STR104.
- **Cổng chặn:** STR105 trước khi đóng SP022 + SP023.

## 9. Thư viện cần phiên chính thêm trước khi giao

| Thư viện | Dùng cho | Ghi chú |
|---|---|---|
| `modern-screenshot` | STR097 | Cần đo bundle trước khi chốt |
| `react-to-print` | STR098 | Rất nhẹ; nếu không cần thì `window.print()` thuần |
| SQLite WASM (`@sqlite.org/sqlite-wasm` hoặc tương đương) | STR093/STR094 | Chỉ thêm sau khi có số đo |
| Không thêm gì cho share | STR099–STR101 | Dùng `CompressionStream` + `base64url` native, `nanoid` không cần nữa |

## 10. Task đã băm (35 Task)

| Epic | Story | Task | Tên Task |
|---|---|---|---|
| SP019 | STR089 | Task122 | Nền IndexedDB & repository workspace 2 tầng scope |
| SP019 | STR089 | Task123 | Store workspace & autosave debounce |
| SP019 | STR089 | Task124 | Nối workspace vào Lab, bỏ state cục bộ |
| SP019 | STR090 | Task125 | Tab Bar: thêm, đóng, đổi tên, kéo sắp xếp |
| SP019 | STR090 | Task126 | Chuyển tab không dựng lại sandbox & thông báo schema đổi |
| SP019 | STR091 | Task127 | Project switcher: tạo, đổi tên, nhân bản, xóa |
| SP019 | STR091 | Task128 | Engine ghim theo dự án & nhả phiên MySQL khi rời |
| SP019 | STR092 | Task129 | Modal đăng xuất & xóa nháp cục bộ |
| SP019 | STR092 | Task130 | Nhập nháp khách vào tài khoản khi đăng nhập |
| SP020 | STR093 | Task131 | Đo bundle, RAM, thời gian khởi động SQLite WASM (cổng go/no-go) |
| SP020 | STR094 | Task132 | Adapter SQLite trong worker theo hợp đồng `EngineAdapter` |
| SP020 | STR094 | Task133 | Rào chắn SQL SQLite & UI chọn engine, nhãn "chưa mô phỏng được" |
| SP020 | STR095 | Task134 | Nhập file `.sqlite` / `.db` vào vùng nhớ WASM |
| SP020 | STR095 | Task135 | Xuất file `.sqlite` từ sandbox |
| SP021 | STR096 | Task136 | Đồ thị phụ thuộc khóa ngoại & sắp xếp tô-pô |
| SP021 | STR096 | Task137 | Serializer `.sql` theo dialect, tách `ALTER` cho vòng FK |
| SP021 | STR096 | Task138 | Menu Export & tải file `.sql` |
| SP021 | STR097 | Task139 | Xuất ERD thành PNG |
| SP021 | STR097 | Task140 | Xuất cây B-Tree thành SVG vector |
| SP021 | STR098 | Task141 | Bố cục báo cáo Audit A4 3 trang |
| SP021 | STR098 | Task142 | In PDF bằng Playwright và kiểm nội dung |
| SP022 | STR099 | Task143 | Codec snapshot: JSON → gzip → base64url, version và trần kích thước |
| SP022 | STR099 | Task144 | Share dialog: sao chép link, cảnh báo, đường lui khi link quá dài |
| SP022 | STR100 | Task145 | Route `/share` đọc fragment, trạng thái lỗi, chặn referrer |
| SP022 | STR100 | Task146 | Renderer chỉ đọc bám prototype |
| SP022 | STR101 | Task147 | Fork snapshot vào workspace |
| SP022 | STR101 | Task148 | Chạy thử snapshot ngay trên trang share |
| SP023 | STR102 | Task149 | Migration 3 bảng cloud + role app không phải owner |
| SP023 | STR102 | Task150 | Gin CRUD lưu dự án cloud, quota, không log SQL |
| SP023 | STR103 | Task151 | Policy RLS theo từng lệnh, `FORCE RLS`, helper transaction |
| SP023 | STR103 | Task152 | Test cross-tenant thật và test rò ngữ cảnh qua pool |
| SP023 | STR104 | Task153 | Kéo/đẩy dự án và xử lý xung đột |
| SP023 | STR104 | Task154 | Cloud panel trong giao diện |
| SP023 | STR105 | Task155 | Cổng `security-audit` cho toàn Epic |
| SP023 | STR105 | Task156 | Kiểm referrer/XSS của share và hồi quy RLS |

## 11. Không làm trong đợt này

- Cộng tác thời gian thực, comment, con trỏ nhiều người.
- Lịch sử phiên bản / versioning dự án.
- Render PDF bằng headless browser trên server.
- Chia sẻ qua email, mời thành viên bằng link, phân quyền editor/viewer trên snapshot.
- Autosave ngầm lên cloud.
- Link share ngắn (`/share/abc123`) — chỉ làm nếu sau này chủ dự án đổi ý, và khi đó mới cần bảng + TTL.
