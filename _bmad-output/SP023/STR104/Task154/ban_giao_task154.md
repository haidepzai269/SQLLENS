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
| `web/src/modules/workspace/{repository,store,types,hydrate}.ts` | `replaceProjectContent`, `setProjectCloud`, ghi liên kết cloud xuống đĩa khi đổi |
| `web/messages/{vi,en}/cloud.json` | 36 key mỗi ngôn ngữ, khớp nhau (đã sửa 5 key trùng ở vòng trước) |

## Kiểm tra

- `npm run check`: **1427 passed | 18 skipped**, 117 file pass, 0 error.
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

