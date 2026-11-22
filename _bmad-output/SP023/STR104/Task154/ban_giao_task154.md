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

**N4 (đã biết, không sửa):** khi `pushProject` phát hiện phiên đã đổi thì nó **đã POST xong**, nên có thể còn một dự án mồ côi trên cloud. Không ai dọn, và giao diện chỉ hiện `error.AUTH_REQUIRED`. Chấp nhận cho V1 — an toàn hơn ghi nhầm vào dự án của người khác — nhưng nếu sau này có dọn dẹp thì đây là chỗ cần xử lý.

## Kiểm tra

- `npm run check`: **1436 passed | 18 skipped**, 117 file pass, 0 error (1 cảnh báo cũ ngoài phạm vi ở `e2e/plan-explain.spec.ts`).
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

