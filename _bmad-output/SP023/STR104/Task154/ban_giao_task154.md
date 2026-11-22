# Bàn giao Task154: Cloud panel trong giao diện

Thuộc: SP023 / STR104. Viết ngày 2026-11-22, cập nhật sau khi hoàn tất phần còn lại.

## Trạng thái: xong

Agent trước bị gián đoạn giữa đường nên để lại panel chạy được nhưng còn ba lỗ thật. Đã sửa hết, mỗi lỗi có test **FAIL trước / PASS sau** (chứng minh bằng đột biến ngược).

## Ba lỗi tìm thấy trong vòng hoàn tất

| Lỗi | Mức | Nội dung | Sửa ở đâu |
|---|---|---|---|
| A | CHẶN | `pushProject` đọc tab từ IndexedDB, còn autosave ghi tab qua **debounce 300 ms**. Gõ thêm một câu rồi bấm "Lưu vào Cloud" ngay là đẩy **bản SQL cũ** lên cloud; panel báo "đã lưu" trong khi phần vừa gõ chỉ còn trên máy. Đo được: payload gửi `""` thay vì `"SELECT 42 AS cau_vua_go"` | `web/src/modules/cloud/sync.ts` (gọi `flushWorkspace()` trước khi đọc) |
| B | Trung bình | `unpersistedLinks` là Map cấp module, sống lâu hơn phiên đăng nhập. Không dọn khi mất phiên thì người đăng nhập sau trong cùng tab có thể PUT vào dự án cloud của người trước | `web/src/modules/auth/auth-provider.tsx` (`markAnon`, và `refreshUser` gọi lại `markAnon`) |
| C | Thấp | Thiếu test cho hai ca biên ghi trong `task154.md`: đổi ngôn ngữ khi panel đang mở, chạm trần 50 dự án | `cloud-panel.test.tsx` |

## Đã làm

| File | Nội dung |
|---|---|
| `web/src/modules/cloud/components/cloud-panel.tsx` (511 dòng) | Panel trạng thái cloud: đăng nhập/đăng xuất theo phiên, nút Lưu lên cloud, Kéo từ cloud, Xóa, đóng panel, khối xung đột (giữ bản này / lấy bản cloud), khối `remote_gone` với hai lối thoát (lưu thành dự án mới, gỡ liên kết) |
| `web/src/modules/cloud/apply.ts` (108 dòng) | Áp kết quả kéo về workspace: thay toàn bộ tab trong **một** transaction, giữ id dự án |
| `web/src/modules/cloud/status.ts` (67 dòng) | Tính trạng thái hiển thị từ dấu vân tay nội dung (không so đồng hồ) |
| `web/src/modules/workspace/components/project-switcher.tsx` | Mục Cloud mở panel ngay trong dropdown dự án |
| `web/src/modules/workspace/{repository,store,types,hydrate,autosave}.ts` | `replaceProjectContent`, `patchProjectCloud`, `setProjectCloud`, `flushStrict`, ghi liên kết cloud xuống đĩa khi đổi |
| `web/messages/{vi,en}/cloud.json` | **54 key lá** mỗi ngôn ngữ, khớp đủ, 0 key trùng (đếm bằng scanner đệ quy; `JSON.parse` nuốt khối trùng nên không dùng nó để kiểm) |

## Vòng sửa thứ ba: ba lỗi reviewer độc lập tìm ra

Vòng 2 sửa xong tưởng đã ổn, nhưng reviewer độc lập kết luận **FAIL** vì ba lỗi nằm đúng trong phạm vi vừa sửa:

| Lỗi | Mức | Nội dung | Sửa ở đâu |
|---|---|---|---|
| F1 | Trung bình | `forgetUnpersistedLinks()` xóa **cả** `inFlight`; lượt đẩy đang chạy vẫn ghi lại liên kết cũ sau đó. Đo được: `SO_POST: 2` (hai dự án cloud) và liên kết người dùng cũ sống sót (`GOI: ["PUT /api/v1/cloud/projects/remote-1"]`) | `sync.ts`: chỉ xóa `unpersistedLinks`, thêm `sessionEpoch`, ném `AUTH_REQUIRED` khi phiên đã đổi |
| F2 | Trung bình | `flushWorkspace()` không flush hàng project (subscriber ghi bắn-và-quên) và `pushProject` ghi đè bằng ảnh chụp đọc trước vòng mạng. Đo được: `TEN_STORE: "Ten Vua Doi"` / `TEN_TRONG_PAYLOAD: "Mặc định"`; xóa dự án trong lúc đẩy thì dự án **sống lại** với 0 tab | `hydrate.ts` (`projectWrites`), `repository.ts` (`patchProjectCloud`), `sync.ts` |
| F3 | Trung bình | `executeSave` nuốt lỗi vào `onError` nên `flush()` resolve dù ghi hỏng. Đo được: `KET_QUA_PUSH: ok`, `PAYLOAD_SQL: ""` khi đĩa đầy | `autosave.ts` (`flushStrict`), `hydrate.ts`, `sync.ts` |

Cả ba đã sửa, mỗi lỗi có test đỏ trước / xanh sau, chứng minh bằng **6 đột biến ngược** (thêm lại `inFlight.clear()`, ép `stillSameSession = true`, đổi `patchProjectCloud` về `upsertProject`, bỏ nhánh `!patched`, đổi `flushStrict` về `flush`, bỏ `inFlight.delete` ở nhánh mở db hỏng) — cả 6 đều làm test đỏ và khôi phục khớp hash.

**Bài học về test:** ca "đổi tên trong lúc chờ mạng" ban đầu **xanh kể cả khi code sai**, vì lượt ghi tên và lượt ghi đè chạy đua và trên máy này lượt ghi tên luôn về sau. Phải đổi tên **bên trong** vòng mạng rồi `await flushWorkspace()` mới tất định. Tương tự, ca "xóa dự án" ban đầu đỏ vì lý do khác (`LOCAL_NOT_FOUND` ở bước đọc trước khi gọi mạng) chứ không phải vì nhánh `!patched` — sửa lại cho đúng cửa sổ đua thì mới canh đúng điều muốn canh.

## Vòng sửa thứ tư: F3 sửa nửa vời + 2 lỗi mới

Reviewer vòng 4 xác nhận F1/F2/F4 đã đúng (8 đột biến đều làm test đỏ) nhưng kết luận **FAIL** vì F3 chưa đóng hết lỗ hổng và hai lỗi mới sinh ra từ chính bản sửa:

| Lỗi | Mức | Nội dung | Đo được trước khi sửa |
|---|---|---|---|
| N1 | Trung bình | `flushStrict()` chỉ thấy lỗi của **chính nó**. Đĩa đầy từ lúc đang gõ thì lượt debounce hỏng, `pending` rỗng, lúc bấm Lưu không có gì để ghi nên "thành công" trong khi IndexedDB vẫn giữ bản cũ | `SAVE_STATE: error`, `KET_QUA_PUSH: ok`, `PAYLOAD_SQL: ""` |
| N2 | Trung bình | Chỉ `pushProject` kiểm thế hệ phiên; `pullProject`/`pullIntoProject` thì không. Mất phiên giữa lúc đang kéo → dự án local bị gắn `cloud` của người dùng cũ | `LINK_SAU_KHI_MAT_PHIEN: {"remoteId":"remote-cu",...}` |
| N3 | Thấp | `disposeWorkspace()` `await Promise.allSettled(projectWrites)` không có trần; một transaction treo làm treo cả `bootWorkspace()` | `DISPOSE: TREO sau 3014 ms` |

Sửa: `autosave.ts` nhớ `lastFailure` tới khi có một lượt ghi thành công; `sync.ts` đọc `saveState` trước khi gọi mạng; `pullProject`/`pullIntoProject` kiểm thế hệ và ném `AUTH_REQUIRED` **trước** khi ghi; `disposeWorkspace` có trần 1500 ms.

Hai lớp N1 bù nhau — đã kiểm: phá riêng lớp này thì lớp kia chặn, phá **cả hai** thì `calls: 1` và test đỏ. Ghi lại vì nếu chỉ phá một lớp mà test vẫn xanh thì rất dễ tưởng test vô dụng.

## Vòng sửa thứ năm: hai lỗi còn lại (R1, R2)

Reviewer vòng 5 xác nhận N2 đạt, nhưng kết luận **FAIL**: N1 và N3 mới đóng đúng *kịch bản được báo*, còn hai đường tái hiện đúng lỗi gốc vẫn đo được.

| Lỗi | Mức | Nội dung | Đo được trước khi sửa |
|---|---|---|---|
| R1 | Trung bình | `lastFailure` là biến **vô hướng**, không theo key; và `saveState` bị đặt về `"idle"` sau **mọi** lượt ghi thành công. Nên một lượt ghi khác thành công xen vào là **cả hai lớp N1 cùng bị xóa** | `saveState: idle` → `KẾT QUẢ PUSH: {"kind":"ok"}`, tên gửi lên cloud `"Mặc định"` trong khi store là `"TEN-MOI-CHUA-XUONG-DIA"`; biến thể tab: `sql gửi lên cloud: ""` trong khi store là `"SELECT 'ban-moi-cua-A'"` |
| R2 | Trung bình | `disposeWorkspace()` gọi `tabAutosave.dispose()` **trước** `Promise.race`; bên trong `dispose()` có `await Promise.all(inFlight)` không hạn | `PROJECT_HANG: resolved 1502 ms` (trần chạy đúng) nhưng `TAB_HANG: HUNG 6001 ms` |

Sửa:
- `autosave.ts`: thay `lastFailure` vô hướng bằng `Set<string> failedKeys` — chỉ xóa dấu của **chính key** khi key đó ghi được. Thêm `hasPendingFailures()`.
- `hydrate.ts`: thêm `failedWrites: Set<string>` cho hàng project (promise hỏng đã settle thì rời `projectWrites` nên phải nhớ riêng); `flushWorkspace()` ném khi còn key hỏng; export `hasUnflushedFailures()`.
- `sync.ts`: `pushProject` dùng `hasUnflushedFailures()` thay vì đọc `saveState` của store — `saveState` là trạng thái tức thời, không dùng làm bằng chứng "mọi thứ đã xuống đĩa".
- `disposeWorkspace`: `Promise.race` bọc **cả** `tabAutosave.dispose()` lẫn `projectWrites`.

**Bài học quan trọng về đột biến ngược:** R1 có **ba** lớp phòng thủ (`failedKeys` trong `flushStrict`, `failedWrites` trong `flushWorkspace`, `hasUnflushedFailures` trong `pushProject`). Phá một hay hai lớp thì test vẫn xanh vì lớp còn lại chặn — chỉ khi phá **cả ba** mới thấy `kind: "ok"` và test đỏ. Vì vậy ghi chú cũ "hai lớp bù nhau, phá riêng lớp này thì lớp kia chặn" là **đúng về hành vi nhưng sai về kết luận test**: các lớp này **tương quan**, cùng bị vô hiệu bởi một sự kiện (một lượt ghi thành công), nên không phải defense-in-depth thật. Đã sửa bằng cách theo dõi theo key.

Test mới: `autosave.test.ts` 2 ca (lỗi theo key; ghi lại đúng key mới hết báo), `push-freshness.test.ts` 1 ca (R1a), `hydrate.test.ts` 1 ca (R2 đo thời gian dispose).

### Rò do chính bản sửa R1 sinh ra: `cancel()` không xoá dấu lỗi

Bản sửa R1 đổi sang `failedKeys` và chỉ xoá dấu khi **chính key đó ghi lại được**. Nhưng xoá tab/project là **đường thoát khác**: bản ghi không còn thì không bao giờ "ghi lại được" nữa, nên dấu lỗi nằm lại vĩnh viễn.

Hậu quả: một lần ghi hỏng trước khi xoá tab làm `hasPendingFailures()` đúng **mãi mãi** → `pushProject` ném `STORAGE_UNAVAILABLE` ở mọi lần bấm Lưu sau đó, cho tới khi F5. Tính năng lưu cloud chết hẳn, và thông báo lỗi nói về "lần lưu gần nhất" đã qua từ lâu — người dùng không có cách nào tự thoát.

Sửa (`8dbbff7`): `cancel(key)` gọi `failedKeys.delete(key)`; `cancel()` không tham số gọi `failedKeys.clear()`. 2 test mới, đã kiểm bằng cách phá `cancel` thì cả hai đều đỏ.

**Bài học:** khi thêm một tập trạng thái "còn nợ", phải liệt kê **mọi** đường làm nó rỗng: ghi thành công (đã có), **xoá bản ghi** (bị bỏ sót), đổi phiên (đã có qua `disposeWorkspace`), huỷ thủ công. Chỉ nghĩ tới đường thành công là đủ để sinh lỗi kẹt vĩnh viễn.

## Vòng sửa thứ sáu: hai lỗ rò do chính bản vá R1 sinh ra

Reviewer vòng 6 xác nhận **R1 và R2 đã đóng thật** (tự dựng lại kịch bản, không tin test của tác giả: R1-A và R1-B đều `push THREW`, `calls=0`; `TAB_HANG` 1500 ms, `PROJECT_HANG` 1502 ms), nhưng kết luận **FAIL** vì bản vá sinh hai lỗ rò làm nút Lưu cloud chết vĩnh viễn.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| 4a | Trung bình | Xoá tab lúc đĩa hỏng → `hasUnflushedFailures=true` **mãi mãi**, push `THREW/FAILED` dù đĩa đã hết lỗi; đĩa còn tab ma → sau F5 tab đã xoá **sống lại** và thành activeTab. Xoá project cũng kẹt y hệt và chặn luôn việc Lưu **dự án khác** | Tách `failedDeletes: Map<string, () => Promise<void>>` khỏi `failedWrites`; xoá hỏng thì **thử lại** trong `flushWorkspace()` chứ không chặn |
| 4b | Trung bình | Đóng tab đúng lúc lượt ghi còn bay rồi request lỗi **muộn** → `failedKeys.add(key)` chạy sau `cancel()` và dựng lại dấu lỗi trên key đã chết → kẹt vĩnh viễn | `keyEpoch: Map<string, number>`; mỗi lượt ghi nhớ thế hệ lúc bắt đầu, ghi xong mà thế hệ đã đổi thì bỏ qua kết quả |

**Vì sao 4a nguy hiểm hơn vẻ ngoài:** lỗi xoá và lỗi ghi khác nhau về hậu quả. Ghi hỏng nghĩa là bản trên đĩa **cũ hơn** trong RAM → đẩy lên cloud là đẩy bản cũ, phải chặn. Xoá hỏng chỉ để lại **bản ghi ma**; bản ghi đó không còn trong store nên **không nằm trong payload**, nội dung đẩy lên vẫn đúng. Gộp chung hai loại là biến một phiền toái nhỏ thành khoá cứng tính năng.

**Phát hiện phụ reviewer nêu (Thấp, chưa sửa):** hai lớp `failedWrites` (trong `flushWorkspace`) và `hasUnflushedFailures` (trong `pushProject`) **che nhau** — phá riêng từng lớp thì không test nào đỏ, phá cả hai mới đỏ. Không phải lỗi chức năng (lớp thứ hai là phòng thủ dư thừa có chủ ý), nhưng nghĩa là bảng đột biến không chứng minh được **từng** lớp. Ghi lại để người sau không tưởng nhầm là mỗi lớp đều có test ghim.

**Test mới:** `autosave.test.ts` +1 (cancel thắng lượt ghi đang bay), `hydrate.test.ts` +2 (xoá tab / xoá project lúc đĩa hỏng). Đã kiểm bằng đột biến: bỏ `keyEpoch` → test 4b đỏ; gộp lỗi xoá vào `failedWrites` → cả 2 test 4a đỏ.

Sau vòng 6: `npm run check` **1445 passed / 18 skipped**, `tsc` sạch, 117 file pass.

**N4 (đã biết, không sửa):** khi `pushProject` phát hiện phiên đã đổi thì nó **đã POST xong**, nên có thể còn một dự án mồ côi trên cloud. Không ai dọn, và giao diện chỉ hiện `error.AUTH_REQUIRED`. Chấp nhận cho V1 — an toàn hơn ghi nhầm vào dự án của người khác — nhưng nếu sau này có dọn dẹp thì đây là chỗ cần xử lý.

## Vòng sửa thứ bảy: ba lỗi Cao trong chính bộ máy ghi dấu nợ

Reviewer vòng 7 **FAIL**. Cả ba lỗi đều nằm trong bộ máy `failedKeys`/`keyEpoch`/`inFlightKeys` — tức là trong **chính cơ chế đi bắt lỗi**, không phải trong tính năng.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| N1 | Cao | `inFlightKeys` là `Set` nên đếm thiếu khi một key có hai lượt cùng bay → lượt đầu settle xoá key → `forgetEpochIfIdle` xoá thế hệ → lượt sau hỏng muộn thấy `0 === 0`, hoặc mất dấu lỗi thật hoặc dựng lại dấu trên key đã chết. `[J1] flying=2 afterLate=true flush=THREW push=THREW:FAILED calls=0` | Đổi `Set<string>` → `Map<string, number>` (đếm), thêm `beginFlight`/`endFlight` |
| N2 | Cao | `schedule()` không bump thế hệ, nên lượt CŨ settle muộn xoá dấu lỗi THẬT của lượt MỚI. `[L1] afterRealFailure=true afterOldSucceededLate=false flushStrict=RESOLVED`; đầu-cuối `[H1] push=ok calls=1 SENT_SQL="SELECT 'BAN_CU'" SQL_IN_STORE="SELECT 'BAN_MOI'"` — **đúng bug gốc của Task154** | `schedule()` gọi `bumpEpoch(key)` ngay sau `clearTimeout` |
| N3 | Cao | `failedWrites` chỉ giữ **tên key**, không có đường thử lại → đĩa hết lỗi rồi kẹt vĩnh viễn, chặn cả dự án khác. `[D1] failuresAfterDiskFixed=true push=THREW:FAILED calls=0` | Đổi sang `Map<string, () => Promise<void>>` giữ hàm thử lại; `flushWorkspace()` gọi `retryPending` |
| N4 | Phụ | Trần **từng entry** cộng dồn: 6 entry treo → `[C1] flushMs=4502`, lần sau `[C2] firstMs=9003` | `RETRY_BUDGET_MS` dùng chung một `deadline` |
| N5 | Phụ | `disposeWorkspace()` bỏ rơi `failedDeletes` → `[D3] ghostAliveAfterF5=true` | Thử lại cả hai Map trong dispose |
| N6 | Phụ | `cancel()` không tham số chỉ lặp `keyEpoch`, bỏ sót key đang bay chưa từng bump | Gom đủ `keyEpoch ∪ pending ∪ failedKeys ∪ inFlightKeys` |

Sau vòng 7: `npm run check` **1453 passed / 18 skipped**, `tsc` sạch.

## Vòng sửa thứ tám: bỏ hẳn sổ nợ, đối chiếu đĩa với store

Reviewer vòng 8 **FAIL** với 4 lỗi Cao + 2 phụ. Điểm chung: **vòng 5, 6, 7, 8 đều sửa đúng một nguyên nhân** — mỗi tập `failedKeys`/`failedWrites`/`failedDeletes` là một **bản sao thủ công** của một sự thật đã có sẵn trên đĩa, và mỗi đường bỏ sót cập nhật là một lần kẹt vĩnh viễn hoặc một lần đẩy bản cũ lên cloud. Vá tiếp triệu chứng chỉ sinh ra tập thứ tư.

**Quyết định: bỏ hẳn sổ nợ.** `flushWorkspace()` nay đọc đĩa, so với store, ghi lại chỗ lệch, rồi **đọc lại để xác nhận**. Không còn tập trạng thái nào để quên cập nhật.

| Lỗi | Mức | Đo được | Sửa |
|---|---|---|---|
| 1 | Cao | Hàng project không có "thế hệ": đổi tên TEN-A (chậm) → TEN-B (hỏng) → TEN-A xong muộn xoá mất dấu lỗi của TEN-B. `{"afterLateSuccess":false,"diskBeforeSave":"TEN-A","inStore":"TEN-B","pushOutcome":"OK","payloadName":"TEN-A"}` | Đối chiếu **không có dấu lỗi nào để xoá**: thấy đĩa ≠ store thì ghi lại |
| 2 | Cao | Đường thử lại phát lại closure chụp lúc hỏng nên ghi **đĩa lùi lại**: `{"onDisk":"TEN-B","inStore":"TEN-C","payloadName":"TEN-B"}` | Luôn ghi giá trị **hiện tại** của store, không giữ closure cũ |
| 3 | Cao | `flushWorkspace()` không có trần cho lượt ghi đang bay: `HANG-PROJECT-WRITE {"elapsedMs":8001}`, `HANG-NO-DEBT {"hasUnflushedFailures":false,"writeHanging":true}` — treo **và** không ghi nhận nợ, nên chỉ thêm trần là tái sinh đúng bug gốc | `guard()` bọc **mọi** thao tác IndexedDB; hết ngân sách → `diskMatchesStore=false` → chặn Lưu |
| 4 | TB | `DISPOSE_WRITE_TIMEOUT_MS` (1500) < ngân sách (2000): `PH2 {"disposeElapsed":1501,"ghostAliveInStore":true,"retryNeededMs":1600}` | 3000 > 2000 |
| 5 | TB | Tab có nợ nhưng N3 chỉ vá project: đĩa hết lỗi rồi 5/5 lần Lưu vẫn hỏng, `fetchCalls:0` | Đối chiếu không phân biệt tab/project |
| 6 | Thấp | Ngân sách không dùng chung giữa hai Map: `{"elapsedMs":3006,"budgetMs":2000}` | Một vòng lặp, một `deadline` |

**Phụ (7):** `cancel()` không tham số gom `keyEpoch ∪ pending ∪ failedKeys ∪ inFlightKeys` là **code chết**. Đột biến M6 (chỉ lặp `keyEpoch`) để **tất cả 29 test của tác giả + 11 test của reviewer xanh**. Vì `schedule()` bump trước khi vào `pending`, không đường nào tạo ra `key ∈ inFlightKeys ∧ key ∉ keyEpoch`. Cả bộ máy `failedKeys`/`keyEpoch`/`inFlightKeys`/`flushStrict`/`hasPendingFailures` trong `autosave.ts` chỉ còn test của chính nó dùng → **đã xoá**, cùng 8 test tương ứng.

**Ba lớp bảo vệ che nhau:** phá riêng từng lớp trong ba lớp của R1 thì 8/8 test vẫn xanh; chỉ phá cả ba mới đỏ. Bảng đột biến vì thế **không** chứng minh được từng lớp — ghi lại để người sau không tưởng nhầm.

**Kiểm chứng đột biến (6/6 bị bắt):** M1 `projectDiffers` luôn `false`; M2 dùng snapshot cũ; M3 bỏ trần `guard`; M4 dispose về 1500; M5 bỏ đối chiếu tab; M6 thêm ngân sách thứ hai.

**Ba test đầu tiên viết ra đã XANH OAN dưới đúng đột biến của chúng** — đúng lớp lỗi đã xảy ra 3 lần trong task này:
- Helper `sabotagePut` **không hề ném lỗi**, chỉ đếm → V8-2 và V8-5 là test rỗng. Sửa thành nhận `shouldFail(value)`.
- V8-2 chỉ có **một** lần Lưu nên không có gì được "phát lại". Sửa thành hai lần Lưu.
- V8-3 bị `raceWithDeadline` che, không chạm tới `guard`. Thêm **V8-3b** cho đường **ĐỌC** treo (không có lượt ghi nào đang bay).

Sau vòng 8: `npm run check` **1452 passed / 18 skipped**, exit 0, `tsc` sạch, 1 cảnh báo cũ ngoài phạm vi.

## Vòng sửa thứ chín: reviewer độc lập tìm 3 lỗi Cao, cả 3 đều đúng

Reviewer vòng 9 dựng lại bộ máy ghi từ đầu (bỏ sổ nợ) và tìm ra 3 lỗi **nặng hơn** những lỗi mà bản viết lại vừa sửa. Cả ba đều tái hiện được, và tôi đã đo lại từng cái.

**Lỗi 1 — đăng xuất "Xoá nháp cục bộ" hồi sinh dữ liệu riêng tư (vi phạm AC2 Task129).**
`purgeUserScope()` xoá thẳng trên đĩa, không đi qua store. Ngay sau đó `markAnon()` đổi scope → `disposeWorkspace()` → `flushWorkspace(session)`. Bước cuối thấy store còn dữ liệu mà đĩa rỗng nên coi là "ghi hỏng" và **ghi lại đúng những hàng vừa xoá**. Đo được: `sauPurge(userProjects=0)` → `sauDoiScope(userProjects=1)`, `sqlSongLai="SELECT 'bi-mat-nguoi-dung'"`. Đây là hồi quy do chính `af559d7` gây ra (code cũ chỉ chạy `retryPending`).
Sửa: thêm cờ `purged` trên phiên + `markWorkspacePurged()`, gọi ngay sau `purgeUserScope()` trong `user-nav.tsx`. Đây là **ngoại lệ duy nhất** của quy tắc "store là nguồn sự thật" — có chú thích dài giải thích vì sao.

**Lỗi 2 — bản ghi ma khoá nút Lưu vĩnh viễn (tái sinh lỗi 4a vòng 6).**
Nhánh `leftover` được thiết kế để không bao giờ chặn, nhưng bước đọc-lại xác nhận gặp `guard()` hết hạn → `catch` đổi thành `blocking: 1` → ném. Đo được `[G1] flush=THREW ms=2047` với chỉ một tab ma, 3/3 lần.
Sửa: tách `measured` khỏi `blocking`. "Đo được và thấy lệch" khác "không đo được"; chỉ cái đầu mới là bằng chứng.

**Lỗi 3 — tab đã xoá lọt vào payload đẩy cloud.**
`pushProject` dựng payload từ **đĩa** (`sync.ts:337`), nên bản ghi ma còn trên đĩa sẽ được gửi lên. Đo được `payloadCoTabDaXoa=true sqlTrongPayload="|SELECT 'bi-mat-cua-toi'"`. Chú thích cũ trong `hydrate.ts` khẳng định "nó không nằm trong payload" — **sai**.
Sửa: `sync.ts` lọc danh sách tab theo **store** (nguồn sự thật về "cái gì còn tồn tại"), lấy nội dung từ đĩa. Đây mới là chỗ chặn đúng, thay vì chặn ở `flushWorkspace` (chặn ở đó tái sinh lỗi 4a).

### Ba lỗi nữa do chính tôi tìm ra khi sửa (đo được, không phải suy đoán)

| # | Triệu chứng đo được | Nguyên nhân | Sửa |
|---|---|---|---|
| A | `[Y] ms=2166 blocking=1 measured=false` rồi ném, dù vòng sau chỉ cần 114 ms là xong | Ngân sách là **tổng thời gian**; workspace 601 tab cần hơn 2 s cho một lượt ghi trên máy chậm | Đổi sang phát hiện **đứng yên**: mỗi vòng trả `work` = số hàng ghi/xoá được; `STALL_LIMIT=5` vòng không tăng là kết luận |
| B | `leftover=1 work=0` lặp 11+ vòng, tốn trọn 2 s cho một tab đã đóng | Nhánh ma không dùng phát hiện đứng yên | Áp cùng `STALL_LIMIT` cho nhánh ma: bỏ cuộc sau ~0,5 s thay vì 2 s |
| C | `[N4]` hết giờ ở bước xác nhận xoá và biến cả lần Lưu thành "không đo được gì" | Bước dọn ma chạy trước bước xác nhận ghi | Đảo thứ tự: xác nhận ghi → dọn ma → xác nhận xoá |

### Sáu test mới, mỗi test đã kiểm bằng đột biến

| Test | Bắt được gì | Đột biến làm nó đỏ |
|---|---|---|
| `V9-1` (viết lại) | Gõ tiếp trong lúc Lưu → `RESOLVED` với đĩa cũ | Bỏ kiểm danh tính store cuối `reconcileOnce` |
| `V9-2` | 601 tab, sửa 1 tab, Lưu phải thành công | Gộp `deadline` đo chung với ngân sách chờ |
| `V9-3` | Xoá nháp rồi đổi phiên không hồi sinh dữ liệu | Bỏ nhánh `if (session.purged)` |
| `V8-4` (viết lại) | Dispose phải **cứu được** lượt xoá hỏng tạm thời | Hạ `DISPOSE_WRITE_TIMEOUT_MS` xuống 60 ms |
| `push-freshness` mới | Tab ma không lọt payload | (xem dưới) |
| `V8-3`, `V8-3b` | Ghi/đọc treo suốt ngân sách phải chặn (fail-safe) | Bỏ `guard()` |

`V9-1` và `V8-4` cũ đều **xanh oan** trước khi viết lại: `V9-1` dùng `setTimeout(1)` nên tuỳ tốc độ máy (đỏ khi chạy cả file, xanh khi chạy riêng); `V8-4` chỉ đo `elapsed >= 1900` — kiểm chi tiết cài đặt chứ không kiểm kết quả. Đây là lần thứ bảy trong task này một test xanh dưới đúng đột biến mà nó sinh ra để bắt.

Sau vòng 9: `npm run check` **1456 passed / 18 skipped**, exit 0, `tsc` sạch.
## Kiểm tra

- `npm run check`: **1456 passed | 18 skipped**, 117 file pass, 0 error (1 cảnh báo cũ ngoài phạm vi ở `e2e/plan-explain.spec.ts`).
- `npx tsc --noEmit`: sạch.
- Trình duyệt thật (Chromium, bản `next build` + `next start`) — **16/16 PASS**:

| Kích thước | Kết quả đo |
|---|---|
| vi/1280 | panel mở, `data-state=local`, `docOverflow=0`, nút là `<button>` thật, nhận focus bằng Tab |
| vi/390 | `docOverflow=0`, panel `left=8 right=382` trong `innerWidth=390`, không tràn |
| en/390 | chuỗi en đúng ("On this device only"), không tràn |
| đổi ngôn ngữ khi panel mở | sang `/en/lab` panel vẫn dựng, chuỗi đổi ngay |

- Bàn phím: mọi hành động là `<button>` thật; `cloud-save` nhận focus và bấm được bằng Enter.
- Ghi chú cho người kiểm sau: **dưới 900px giao diện là bốn tab vùng**, mục Cloud nằm trong vùng `sql` — phải bấm tab `#tab-sql` trước khi tìm nút mở danh sách dự án. Không phải lỗi, nhưng lần đầu dễ tưởng panel không tồn tại trên mobile.

## Sáu tiêu chí xong

| AC | Trạng thái | Bằng chứng |
|---|---|---|
| AC1 chưa lưu hiện `local`, lưu xong `synced` kèm thời gian | Đạt | test `AC1` + đo trình duyệt |
| AC2 sửa SQL thì `modified`, không tự đẩy | Đạt | test `AC2`, `đổi tên tab cũng tính là thay đổi` |
| AC3 xung đột hiện 2 lựa chọn, không tự chọn | Đạt | 3 test trong nhóm `xung đột (AC3)` |
| AC4 xóa cần xác nhận, local vẫn còn, về `local` | Đạt | test `AC4` |
| AC5 khách thấy lời mời đăng nhập, không thấy nút lưu | Đạt | test `AC5` |
| AC6 đủ vi/en, bàn phím, 390px không tràn | Đạt | test + 16/16 đo trình duyệt |

## Vấn đề đã biết (không chặn)

1. **Vượt phạm vi commit `bcfe308`.** `task154.md` ghi "Không đổi logic sync (Task153)", nhưng commit đó sửa cả `sync.ts` để sửa LỖI 4/5 của Task153. Nội dung đúng và có test, nhưng nhãn commit không sạch.
2. **`unpersistedLinks` chưa có hook `visibilitychange`.** Đã dọn khi mất phiên đăng nhập; nếu người dùng mở hai tab trình duyệt cùng tài khoản thì mỗi tab giữ Map riêng — chấp nhận được vì đều là cùng một người dùng.
3. **Chưa kiểm luồng OAuth thật** (cần Google/GitHub thật). Phần này kiểm bằng cách giả lập `authStatus`.
4. **Chưa có ảnh chụp trong bàn giao** — máy chạy không đọc được ảnh; số đo ở bảng trên thay cho ảnh.
5. **Chưa rà hết nơi dùng `PushResult`**: đã rà, chỉ có **một** nơi dùng (`cloud-panel.tsx`) và nó xử lý đủ 4 nhánh (`ok`, `conflict`, `remote_gone`, lỗi). Không còn chỗ nào so `kind === "ok"` mà bỏ sót.

## Việc còn phải làm (ngoài Task154)

- Quyết định trần 2MB tổng/dự án so với quota 100 tab × 512KB (xem `SP023/README.md`).
- Task155 (`security-audit`) và Task156 (referrer/XSS, hồi quy RLS) chưa làm.

