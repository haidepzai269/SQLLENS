# SP023: Đồng bộ Cloud & RLS cấp Project

Epic này cho người dùng đã đăng nhập lưu dự án lên Neon để mở từ máy khác, và bảo vệ dữ liệu đó bằng RLS ở tầng database chứ không chỉ bằng code Go.
Theo `_bmad-output/BAN_NHAP_STORY_WORKSPACE_EXPORT_SHARE.md` mục 6.

## Yêu cầu cứng của chủ dự án (2026-11-15)

Role tạo bảng là owner thì **mặc định bỏ qua RLS**. Epic này phải xử lý đúng chuyện đó, không được chỉ bật `ENABLE ROW LEVEL SECURITY` rồi coi là xong:

1. Role ứng dụng (`sqllens_app`) **không phải owner** của ba bảng; bảng do role migration tạo.
2. `GRANT` chỉ quyền cần thiết; role app không `SUPERUSER`, không `BYPASSRLS`.
3. `FORCE ROW LEVEL SECURITY` là lớp thứ hai.
4. Policy tách theo từng lệnh, có `WITH CHECK`; `cloud_project_members` **phải có policy**.
5. `SET LOCAL app.current_user_id` chỉ dùng trong transaction, qua một helper duy nhất.
6. Có test cross-tenant chạy thật bằng role app; test phải fail nếu tắt RLS.

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR102** | `Task149` | Migration 3 bảng cloud + role app không phải owner | Amelia | Hoàn thành 100% |
| **STR102** | `Task150` | Gin CRUD lưu dự án cloud, quota, không log SQL | Amelia | Hoàn thành 100% (chưa gọi reviewer độc lập) |
| **STR103** | `Task151` | Policy RLS theo từng lệnh, `FORCE RLS`, helper transaction | Amelia | Hoàn thành 100% + **đã sửa 5 lỗi review** (xem `ban_giao_task151_fix.md`) |
| **STR103** | `Task152` | Test cross-tenant thật và test rò ngữ cảnh qua pool | Amelia | Hoàn thành 100% (chưa gọi reviewer độc lập) |
| **STR104** | `Task153` | Kéo/đẩy dự án và xử lý xung đột | Amelia | Hoàn thành 100% + **đã sửa 2 lỗi chặn** (LỖI 4, 5) |
| **STR104** | `Task154` | Cloud panel trong giao diện | Amelia | Hoàn thành 100% — 6/6 AC có test, 16/16 đo trên Chromium thật; **đã qua 5 vòng review độc lập** (xem `ban_giao_task154.md`) |
| **STR105** | `Task155` | Cổng `security-audit` cho toàn Epic | Amelia | Hoàn thành 100% — báo cáo `STR105/bao-cao-security-audit.md`; 0 lỗi critical/high; 3 việc còn lại vào `SP999` |
| **STR105** | `Task156` | Kiểm referrer/XSS của share và hồi quy RLS | Amelia | Hoàn thành 100% + **đã review độc lập, sửa 3 lỗi** (`STR105/Task156/review_task156.md`) |

## Vòng sửa lỗi sau review độc lập (2026-11-21)

Reviewer độc lập tìm 5 lỗi, đã sửa hết, mỗi lỗi có test **FAIL trước / PASS sau**. Chi tiết và số đo thật ở `STR103/Task151/ban_giao_task151_fix.md`.

| Lỗi | Mức | Nội dung | Sửa ở đâu |
|---|---|---|---|
| 1 | BLOCKER | `viewer` vẫn UPDATE/DELETE/INSERT được tab của dự án được chia sẻ | `api/migrations/005_cloud_tabs_write_role.sql` |
| 2 | BLOCKER | `go test ./...` đỏ 8 test `auth`: `DROP TABLE users` thiếu `CASCADE` | `api/internal/auth/auth_test.go` |
| 3 | — | Trần body 1MB toàn cục chặn quota 100 tab × 512KB | `store/cloud.go`, `httpapi/router.go`, `httpapi/cloud_projects.go` |
| 4 | CHẶN | Đẩy hai lần tạo hai dự án cloud trùng (POST lặp) | `web/src/modules/cloud/sync.ts` |
| 5 | CHẶN | 404 của dự án đã bị xóa làm kẹt vĩnh viễn, không có lối thoát | `web/src/modules/cloud/sync.ts` + `cloud-panel.tsx` |

**Giới hạn mới cần biết:** `MaxCloudProjectBytes = 2MB` là trần **tổng** của một dự án, nên tab 512KB chỉ chứa được 3–4 tab/dự án. Con số "100 tab" trong quota chỉ đạt được khi tab nhỏ. Nâng lên ~52MB cần chủ dự án quyết vì ảnh hưởng RAM Gin trên Render free.

## Vòng sửa thứ hai (2026-11-22)

Reviewer độc lập vòng 2 kết luận **PASS**: cả 5 lỗi trên đã sửa đúng, mỗi lỗi có test FAIL trước / PASS sau (chứng minh bằng đột biến ngược). Reviewer còn tìm thêm 3 điểm và chủ dự án đã cho sửa ngay trong cùng vòng:

| Điểm | Nội dung | Sửa ở đâu |
|---|---|---|
| i18n | `en/cloud.json` có **5 key trùng** (`remoteGone*`); `JSON.parse` giữ khối sau nên UI hiện câu của khối chết, `check-i18n.mjs` không bắt được | `web/messages/en/cloud.json` |
| Đồng bộ song song | Hai lượt `pushProject` **chạy chồng** cùng dự án đều thấy `cloud` trống nên cùng POST → hai dự án trùng | `web/src/modules/cloud/sync.ts` (`inFlight`, mã lỗi `BUSY`) |
| Hổng test | Gỡ liên kết khi liên kết **chỉ nằm trong bộ nhớ** (`unpersistedLinks`) không có test; phá code thì không test nào đỏ | `web/src/modules/cloud/sync.test.ts` |

Kết quả sau vòng 2: `go test ./...` 7/7 package ok, `npm run check` 1421 passed / 18 skipped, `gofmt` chỉ còn 2 file `internal/ai/*_test.go` lệch chuẩn từ trước.

## Vòng hoàn tất Task154 (2026-11-22)

Agent làm Task154 bị gián đoạn giữa đường. Panel đã chạy nhưng còn ba lỗ thật, đã sửa và mỗi lỗi có test FAIL trước / PASS sau:

| Lỗi | Mức | Nội dung | Sửa ở đâu |
|---|---|---|---|
| A | CHẶN | `pushProject` đọc tab từ IndexedDB còn autosave ghi qua debounce 300 ms → "gõ thêm rồi Lưu ngay" đẩy **bản SQL cũ** lên cloud. Đo được payload `""` thay vì `"SELECT 42 AS cau_vua_go"` | `cloud/sync.ts` (gọi `flushWorkspace()` trước khi đọc) |
| B | Trung bình | `unpersistedLinks` sống lâu hơn phiên đăng nhập; không dọn thì người đăng nhập sau trong cùng tab có thể PUT vào dự án của người trước | `auth/auth-provider.tsx` (`markAnon`) |
| C | Thấp | Thiếu test cho ca biên "đổi ngôn ngữ khi panel mở" và "chạm trần 50 dự án" | `cloud-panel.test.tsx` |

Sau vòng này: `npm run check` **1434 passed / 18 skipped**, 117 file pass, `tsc` sạch; Chromium thật **16/16 PASS** ở vi/1280, vi/390, en/390 và ca đổi ngôn ngữ khi panel đang mở. Task154 xong; còn lại Task155 (`security-audit`) và Task156 (referrer/XSS, hồi quy RLS).

## Vòng sửa thứ ba: reviewer độc lập bắt 3 lỗi nữa (2026-11-22)

Vòng 2 tưởng đã ổn, nhưng reviewer độc lập kết luận **FAIL**: ba lỗi nằm đúng trong phạm vi vừa sửa. Ghi lại vì bài học chung cho các task sau:

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| F1 | Trung bình | `forgetUnpersistedLinks()` xóa cả `inFlight` → `SO_POST: 2` (hai dự án cloud), liên kết người dùng cũ sống sót | Chỉ xóa `unpersistedLinks`; thêm `sessionEpoch`; ném `AUTH_REQUIRED` khi phiên đã đổi |
| F2 | Trung bình | `flushWorkspace()` không flush hàng project → `TEN_TRONG_PAYLOAD: "Mặc định"` khi store đã là "Ten Vua Doi"; xóa dự án trong lúc đẩy thì dự án **sống lại** với 0 tab | `projectWrites` trong `hydrate.ts`; `patchProjectCloud` chỉ vá trường cloud trên hàng đang có |
| F3 | Trung bình | `executeSave` nuốt lỗi → `KET_QUA_PUSH: ok` với `PAYLOAD_SQL: ""` khi đĩa đầy | `flushStrict()` ném lỗi; `pushProject` dừng trước khi gọi mạng |

Bài học test: hai ca đua ban đầu **xanh kể cả khi code sai** (đổi tên) hoặc **đỏ vì lý do khác** (xóa dự án). Phải ép đúng cửa sổ đua — thao tác **bên trong** vòng mạng — thì test mới canh đúng điều muốn canh. Đã kiểm bằng 6 đột biến ngược, cả 6 đều làm test đỏ.

## Vòng sửa thứ tư: F3 chưa đóng hết, thêm 2 lỗi mới (2026-11-22)

Reviewer vòng 4 xác nhận F1/F2/F4 đã đúng nhưng vẫn **FAIL**: F3 sửa nửa vời và bản sửa sinh thêm lỗi.

| Lỗi | Mức | Đo được trước khi sửa |
|---|---|---|
| N1: `flushStrict()` chỉ thấy lỗi của chính nó, không thấy lỗi ghi đã xảy ra từ trước | Trung bình | `SAVE_STATE: error` nhưng `KET_QUA_PUSH: ok`, `PAYLOAD_SQL: ""` |
| N2: `pullProject`/`pullIntoProject` không kiểm thế hệ phiên | Trung bình | `LINK_SAU_KHI_MAT_PHIEN: {"remoteId":"remote-cu",...}` |
| N3: `disposeWorkspace()` chờ `projectWrites` không có trần | Thấp | `DISPOSE: TREO sau 3014 ms` |

Đã sửa cả ba, `npm run check` **1436 passed / 18 skipped**, `tsc` sạch. Còn N4 (dự án mồ côi trên cloud khi phiên đổi giữa lúc đẩy) ghi vào "vấn đề đã biết".

**Bài học cho Epic sau:** một bản sửa chỉ đóng được đúng cửa sổ nó nghĩ tới. F3 vòng 3 canh "ghi hỏng ngay trong lượt flush" nhưng bỏ sót "ghi đã hỏng từ trước". Khi sửa lỗi có trạng thái, phải hỏi: trạng thái hỏng ấy còn sống được qua bao lâu, và ai đó đọc nó ở đâu?

## Vòng sửa thứ năm: R1 và R2 (2026-11-22)

Reviewer vòng 5 xác nhận N2 đạt, nhưng N1 và N3 mới đóng đúng *kịch bản được báo*; hai đường tái hiện đúng lỗi gốc vẫn đo được.

| Lỗi | Mức | Đo được trước khi sửa |
|---|---|---|
| R1: `lastFailure` là biến vô hướng + `saveState` bị đặt về `"idle"` sau mọi lượt ghi thành công, nên một lượt ghi khác xen vào là **cả hai lớp N1 cùng bị xóa** | Trung bình | `saveState: idle` → push `{"kind":"ok"}`, tên gửi lên cloud `"Mặc định"` trong khi store là `"TEN-MOI-CHUA-XUONG-DIA"`; biến thể tab: `sql` gửi lên `""` trong khi store là `"SELECT 'ban-moi-cua-A'"` |
| R2: `disposeWorkspace()` gọi `tabAutosave.dispose()` **trước** `Promise.race`, mà bên trong `dispose()` có `await Promise.all(inFlight)` không hạn | Trung bình | `PROJECT_HANG: resolved 1502 ms` (trần đúng) nhưng `TAB_HANG: HUNG 6001 ms` |

Sửa: `Set<string> failedKeys` theo từng key trong `autosave.ts` + `hasPendingFailures()`; `failedWrites: Set<string>` cho hàng project trong `hydrate.ts` + `hasUnflushedFailures()`; `pushProject` dùng `hasUnflushedFailures()` thay vì đọc `saveState`; `Promise.race` bọc **cả** `tabAutosave.dispose()` lẫn `projectWrites`.

`npm run check` **1440 passed / 18 skipped**, `tsc` sạch.

**Bài học về đột biến ngược (quan trọng):** R1 có **ba** lớp phòng thủ. Phá một hay hai lớp thì test vẫn xanh vì lớp còn lại chặn — chỉ khi phá **cả ba** mới thấy `kind: "ok"` và test đỏ. Ghi chú cũ trong bàn giao nói "hai lớp N1 bù nhau, phá riêng lớp này thì lớp kia chặn" đúng về hành vi nhưng **sai về kết luận**: các lớp này **tương quan**, cùng bị vô hiệu bởi một sự kiện duy nhất (một lượt ghi thành công), nên không phải defense-in-depth thật. Đó chính là lý do R1 lọt qua vòng 4.

## Vòng sửa thứ sáu: hai lỗ rò do bản vá R1 sinh ra (2026-11-22)

Reviewer vòng 6 xác nhận R1/R2 đã đóng thật (tự dựng lại kịch bản: `push THREW`, `calls=0`; `TAB_HANG` 1500 ms, `PROJECT_HANG` 1502 ms) nhưng **FAIL** vì bản vá sinh hai lỗ rò.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| 4a: `failedWrites` gộp cả lỗi XOÁ | Trung bình | Xoá tab lúc đĩa hỏng → `hasUnflushedFailures=true` mãi mãi, push `THREW` dù đĩa đã hết lỗi; đĩa còn tab ma → sau F5 tab đã xoá sống lại. Xoá project cũng chặn luôn việc Lưu **dự án khác** | Tách `failedDeletes` để **thử lại** thay vì chặn |
| 4b: `cancel(key)` thua lượt ghi đang bay | Trung bình | Đóng tab đúng lúc request còn bay, request lỗi muộn → `failedKeys.add` chạy sau `cancel` và dựng lại dấu lỗi trên key đã chết | `keyEpoch` theo từng key; bỏ qua kết quả nếu thế hệ đã đổi |

`npm run check` **1445 passed / 18 skipped**, `tsc` sạch.

**Bài học:** lỗi ghi và lỗi xoá khác nhau về hậu quả. Ghi hỏng → bản trên đĩa cũ hơn RAM → phải **chặn** đẩy cloud. Xoá hỏng → chỉ còn bản ghi ma, không nằm trong payload → phải **thử lại**, không chặn. Gộp chung biến một phiền toái nhỏ thành khoá cứng tính năng.

## Vòng sửa thứ bảy: ba lỗi Cao trong chính bộ máy ghi dấu nợ (2026-11-22)

Reviewer vòng 7 **FAIL**. Cả ba lỗi đều nằm trong cơ chế đi bắt lỗi, không phải trong tính năng.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| N1: `inFlightKeys` là `Set` | Cao | Hai lượt cùng bay cho một key → lượt đầu settle xoá key → `forgetEpochIfIdle` xoá thế hệ → lượt sau hỏng muộn thấy `0 === 0`. `[J1] flying=2 afterLate=true push=THREW:FAILED calls=0` | `Map<string, number>` đếm |
| N2: `schedule()` không bump thế hệ | Cao | Lượt CŨ settle muộn xoá dấu lỗi THẬT của lượt MỚI. `[H1] push=ok SENT_SQL="BAN_CU" SQL_IN_STORE="BAN_MOI"` — **đúng bug gốc Task154** | Bump trong `schedule()` |
| N3: `failedWrites` chỉ giữ tên key | Cao | Không có đường thử lại → đĩa hết lỗi rồi kẹt vĩnh viễn, chặn cả dự án khác. `[D1] failuresAfterDiskFixed=true` | Giữ **hàm** thử lại, `retryPending` |
| N4–N6 | Phụ | Trần từng entry cộng dồn (4,5 s rồi 9 s); dispose bỏ rơi `failedDeletes` (`ghostAliveAfterF5=true`); `cancel()` bỏ sót key đang bay | Ngân sách chung; thử lại trong dispose; gom đủ tập key |

`npm run check` **1453 passed / 18 skipped**.

## Vòng sửa thứ chín: reviewer lật ngược bản viết lại, tìm 3 lỗi Cao (2026-11-22)

Reviewer vòng 9 dựng lại bộ máy ghi từ đầu và tìm ra 3 lỗi **nặng hơn** lỗi vừa sửa. Cả ba đều tái hiện được và đã đo lại.

**1. Đăng xuất "Xoá nháp cục bộ" hồi sinh dữ liệu riêng tư** (vi phạm AC2 Task129). `purgeUserScope()` xoá thẳng trên đĩa; `markAnon()` đổi scope → `disposeWorkspace()` → `flushWorkspace()` thấy store còn dữ liệu, đĩa rỗng, tưởng "ghi hỏng" và **ghi lại đúng những hàng vừa xoá**. Đo được `sauPurge(userProjects=0)` → `sauDoiScope(userProjects=1)`, `sqlSongLai="SELECT 'bi-mat-nguoi-dung'"`. Hồi quy do chính bản viết lại gây ra.

**2. Bản ghi ma khoá nút Lưu vĩnh viễn** (tái sinh lỗi 4a vòng 6). Nhánh `leftover` sinh ra để không chặn, nhưng `guard()` hết hạn trong bước xác nhận bị `catch` đổi thành `blocking: 1` → ném. Đo được `[G1] flush=THREW ms=2047` với một tab ma, 3/3 lần.

**3. Tab đã xoá lọt vào payload cloud.** `pushProject` dựng payload từ **đĩa**, nên bản ghi ma được gửi đi: `payloadCoTabDaXoa=true sqlTrongPayload="|SELECT 'bi-mat-cua-toi'"`. Chú thích cũ khẳng định "nó không nằm trong payload" — sai.

**Bài học kiến trúc:** chỗ chặn đúng cho lỗi 3 không phải `flushWorkspace` (chặn ở đó tái sinh lỗi 4a) mà là **lúc dựng payload**: lấy nội dung từ đĩa, lấy **danh sách** từ store. Mỗi tầng phải chặn đúng thứ nó sở hữu.

Thêm ba lỗi do tự đo trong lúc sửa: ngân sách là tổng thời gian nên cắt ngang workspace lớn đang tiến triển thật (đổi sang **phát hiện đứng yên**), nhánh ma không dùng phát hiện đó (tốn 2 s cho một tab đã đóng), và thứ tự dọn-ma-trước-xác-nhận-ghi làm mất phép đo.

Sáu test mới, **mỗi test đã kiểm bằng đột biến**. `V9-1` và `V8-4` cũ đều xanh oan: `V9-1` dùng `setTimeout(1)` nên tuỳ tốc độ máy; `V8-4` chỉ đo `elapsed >= 1900` — kiểm chi tiết cài đặt chứ không kiểm kết quả. Đây là lần thứ bảy trong task một test xanh dưới đúng đột biến nó sinh ra để bắt.

Sau vòng 9: `npm run check` **1456 passed / 18 skipped**, exit 0, `tsc` sạch.
## Vòng sửa thứ tám: bỏ hẳn sổ nợ, đối chiếu đĩa với store (2026-11-22)

Reviewer vòng 8 **FAIL** với 4 lỗi Cao + 2 phụ. Chẩn đoán: **vòng 5, 6, 7, 8 đều sửa đúng một nguyên nhân.** Mỗi tập `failedKeys`/`failedWrites`/`failedDeletes` là một **bản sao thủ công** của một sự thật đã có sẵn trên đĩa; mỗi đường bỏ sót cập nhật là một lần kẹt vĩnh viễn hoặc một lần đẩy bản cũ lên cloud. Vá tiếp triệu chứng chỉ sinh tập thứ tư.

**Quyết định: bỏ hẳn sổ nợ.** `flushWorkspace()` đọc đĩa, so với store, ghi lại chỗ lệch, rồi **đọc lại để xác nhận**. Không còn tập trạng thái nào để quên cập nhật, và vì mỗi lần ghi luôn lấy giá trị **hiện tại** của store nên một lượt ghi cũ chạy muộn không thể đè bản mới bằng ảnh chụp cũ.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| 1: project row không có thế hệ | Cao | TEN-A (chậm) → TEN-B (hỏng) → TEN-A xong muộn xoá mất nợ của TEN-B: `payloadName:"TEN-A"` trong khi `inStore:"TEN-B"`, `pushOutcome:"OK"` | Thấy đĩa ≠ store thì ghi lại |
| 2: thử lại phát lại closure cũ | Cao | Ghi **đĩa lùi lại**: `onDisk:"TEN-B"` trong khi `inStore:"TEN-C"` | Luôn ghi giá trị hiện tại của store |
| 3: không có trần cho lượt ghi đang bay | Cao | `HANG-PROJECT-WRITE {"elapsedMs":8001}` và `HANG-NO-DEBT {"hasUnflushedFailures":false}` — treo **và** không ghi nhận nợ | `guard()` bọc mọi thao tác IndexedDB; hết ngân sách → chặn Lưu |
| 4: dispose 1500 < ngân sách 2000 | TB | `{"disposeElapsed":1501,"ghostAliveInStore":true,"retryNeededMs":1600}` | 3000 > 2000 |
| 5: tab không có đường thử lại | TB | Đĩa hết lỗi rồi 5/5 lần Lưu vẫn hỏng, `fetchCalls:0` | Đối chiếu không phân biệt tab/project |
| 6: hai Map, hai ngân sách | Thấp | `{"elapsedMs":3006,"budgetMs":2000}` | Một vòng lặp, một `deadline` |

**Phụ (7):** `cancel()` gom `keyEpoch ∪ pending ∪ failedKeys ∪ inFlightKeys` là **code chết** — đột biến M6 để **tất cả 29 test tác giả + 11 test reviewer xanh**. Cả bộ máy `failedKeys`/`keyEpoch`/`flushStrict`/`hasPendingFailures` trong `autosave.ts` chỉ còn test của chính nó dùng → **đã xoá** cùng 8 test.

**Bài học lớn nhất của Task154:** ba test viết ra để bắt lỗi đã **xanh oan** dưới đúng đột biến của chúng (helper giả lập không ném lỗi; test chỉ có một lần Lưu nên không có gì để "phát lại"; test bị lớp `raceWithDeadline` che). Trong task này đã có **6 test xanh oan** ở ba vòng khác nhau. Viết test xong phải chạy đột biến, và phải kiểm đột biến **thật sự vào được file**.

`npm run check` **1452 passed / 18 skipped**, exit 0.

## Không làm

Không có cột `is_public` trên `cloud_projects` (share đã đi đường URL ở SP022). Không autosave ngầm lên cloud.

## Đóng Epic: Task155 + Task156 (2026-11-22)

**Task156** (kiểm referrer/XSS của share + hồi quy RLS) làm trước, rồi được **review độc lập** và
sửa 3 lỗi — chi tiết `STR105/Task156/review_task156.md`:

| Lỗi | Mức | Nội dung | Sửa |
|---|---|---|---|
| R1 | TB | `next.config.ts` đổi `turbopack.root` theo `process.platform` — ngoài phạm vi và vô nghĩa trên Windows (hai vế cùng ra `C:\`) | Revert |
| R2 | TB | Test hồi quy RLS mới vẫn xanh khi tắt RLS, vì ba hàm store đều tự lọc `owner_id` | Thêm truy vấn **không lọc owner** phải trả 0 hàng; đột biến `NO FORCE` cho thấy 1 hàng |
| R3 | Thấp | AC3 kiểm header bằng request phụ, không phải phản hồi tài liệu | Dùng `page.goto()` + `response.headers()` |

**Task155** (cổng `security-audit` cho toàn Epic) chạy trên diff thật `12e078f^..a1dc71c`
(149 file, +20.277/−165). Kết quả: **không có lỗi critical/high**; Core Rule 7 đúng (grep chạy trong
`docker run --network none`: 0 lời gọi log nhắc tới sql/query/body/tab). Ba việc còn lại, đều không
chặn đóng Epic, đã vào `SP999`: (F1) route cloud không có rate limit trong khi AI/MySQL có;
(F2) trần dung lượng cloud ~100 MB/user phụ thuộc gói Neon — chờ chủ dự án; (F3) snapshot không
giới hạn số tab.

**Epic SP023 đóng 100%.** Số đo cuối: `go test ./...` 7/7 package ok (kèm 10/10 test RLS trên
PostgreSQL 18-alpine), `npm run check` 1456 passed / 18 skipped, `npm run build` PASS, Playwright
`share-security` 6/6 (và 18/18 khi `--repeat-each=3`).

*(Số 1456 là tại thời điểm đóng Epic. Sau đó Task157 và lượt review dưới đây thêm **5 test** — 3 test
trần tab + 2 test hộp thoại share — nên con số hiện tại là **1461**.)*

## Review độc lập Task155 + Task156 (lượt hai, 2026-11-22)

Báo cáo: `STR105/review_task155_156.md`. Lượt này **không tin số của bàn giao**, chạy lại tất cả, và
dùng **đột biến** để chứng minh test thật sự bắt được lỗi (không chỉ đọc mã).

### Số đo độc lập (thay cho các số ở trên)

| Việc | Kết quả |
|---|---|
| `go test -count=1 -p 1 ./...` trên **PostgreSQL 18.7 thật trong Docker** | **7/7 package ok**; **10/10 `TestRLS*` PASS, 0 SKIP** |
| `npm run check` | **1461 passed / 18 skipped** (1479 test, 119 file), exit 0 |
| `npm run build` | PASS |
| Playwright `share-security` + `share-run` | **16/16 PASS**; `share-security --repeat-each=3` → **18/18 PASS** |

**Đính chính số cũ:** dòng "10/10 test RLS trên PostgreSQL 18-alpine" ở trên là **sai thời điểm** —
lượt audit đầu chưa chạy được Docker nên PostgreSQL dùng cho test là **17.5 trên host**. Lượt review
này đã chạy lại trên **PG 18.7** và kết quả không đổi; báo cáo audit đã được đính chính.

### Lỗi mới tìm được ở lượt này

| Mã | Mức | Nội dung | Trạng thái |
|---|---|---|---|
| R4 | TB | Task156 AC6 "test chạy ở CI" **không đúng**: job `api` không đặt `RLS_TEST_DSN` nên **10/10 `TestRLS*` SKIP im lặng**, exit 0 — CI xanh dù RLS có thể đã hỏng | **Đã sửa**: thêm job `rls` (service `postgres:18`, DSN thật, đỏ nếu có `--- SKIP`, đòi ≥ 10 `--- PASS: TestRLS`) |
| R5 | TB | Bản sửa F3 (Task157) sinh lỗi giao diện: `share-dialog.tsx` gộp mọi `SnapshotError` vào `blocked`, nên dự án **101 tab** báo nhầm "quá 32 KB" **và** vẫn mời tải file `.sqllens` mà `decodeSnapshot` sẽ từ chối | **Đã sửa**: trạng thái `blocked-tabs` + `failed` riêng, hàm thuần `statusForEncodeError`, chuỗi vi/en, 2 test mới (đã chứng minh đỏ bằng đột biến) |
| R6 | Thấp | `Retry-After` của giới hạn thô lớn hơn cửa sổ 1 giây (`auth.go:302-304`) | Ghi `SP999`, chưa sửa |
| R7 | Thấp | Giới hạn thô 30 request/phút dùng **chung một xô** theo user id cho mọi route: 30 request cloud làm 1 request MySQL của cùng user nhận 429 (đã đo bằng probe) | Chờ chủ dự án chọn (xô riêng theo route hay giữ chung) |

### Đột biến đã chạy (chứng minh test "có thể đỏ")

| Đột biến | Kết quả |
|---|---|
| `ALTER TABLE cloud_projects NO FORCE ROW LEVEL SECURITY` rồi chạy bước 5 của `TestRLSRegressionCrossTenantStoreMethods` | `TRƯỚC 0 hàng` → `SAU 1 hàng` ⇒ test gốc **sẽ đỏ** |
| `Referrer-Policy` của `/:locale(vi\|en)/share` → `origin` | AC3 **đỏ đúng** (`Expected "no-referrer", Received "origin"`) |
| `referrer: "no-referrer"` trong `share/page.tsx` → `origin` (thẻ `<meta>`) | AC4 **đỏ đúng** (`capturedReferer` = `http://localhost:3134/`) |
| Bỏ nhánh `SNAPSHOT_TOO_MANY_TABS` trong `statusForEncodeError` | Test mới của share-dialog **đỏ đúng** (1 failed / 22 passed) |
| Job CI `rls`: log chỉ có `--- SKIP` / log rỗng / đủ 10 `--- PASS` | 2 ca đầu **bị chặn**, ca 3 **cho qua** |

### Bẫy đã gặp khi review

`playwright.config.ts` dùng `webServer.command = npm run start`, tức phục vụ bản `.next` **đã build
sẵn**. Sửa `next.config.ts` rồi chạy `npm run e2e` thì test **vẫn xanh** vì đột biến chưa vào bản
build — rất dễ kết luận sai là "test không bắt được lỗi". Phải `npm run build` lại trước khi kết luận.

### Kết luận

Không còn lỗi critical/high trong phạm vi Task155 + Task156. Task155 đạt về nội dung audit nhưng báo
cáo có 1 số liệu sai phiên bản PostgreSQL (đã đính chính); Task156 đạt về test, AC6 chỉ đúng **sau**
khi thêm job `rls`. Hai việc R6/R7 và F2 không chặn đóng Epic.
