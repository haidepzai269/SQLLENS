# Task156: Kiểm referrer/XSS của share và hồi quy RLS

Thuộc: SP023 / STR105
Mục tiêu: Chốt hai rủi ro đặc thù của đợt này bằng test chạy thật: nội dung trong URL không rò sang nơi khác, và RLS không bị hồi quy sau các thay đổi cloud.

Phạm vi:
- `web/e2e/share-security.spec.ts`
- `api/internal/store/tenant_rls_test.go` (chỉ thêm ca hồi quy)
- `next.config.ts` (nếu header chưa đúng)

Không làm:
- Không đổi giao diện share.
- Không nới policy RLS.
- Không thay `no-referrer` bằng giá trị yếu hơn.

Hợp đồng:
- E2E mở `/share#d=<payload độc hại>` với SQL chứa `<img src=x onerror=alert(1)>` và `"><script>`; trang phải hiển thị dạng text trong editor, không chạy script.
- Test kiểm header `Referrer-Policy: no-referrer` trên route `/share` ở cả vi và en.

Tiêu chí xong:
- AC1: Payload chứa thẻ HTML/script không thực thi, không tạo node HTML trong DOM.
- AC2: Không có cảnh báo `alert` nào bật lên (bắt bằng `page.on("dialog")`).
- AC3: Header `Referrer-Policy: no-referrer` có trên `/vi/share` và `/en/share`.
- AC4: Khi điều hướng từ `/share` sang domain khác, request đi kèm không có `Referer` chứa payload.
- AC5: Hồi quy RLS: chạy lại `Task152` và pass; nếu fail thì dừng, báo chủ dự án.
- AC6: Test chạy ở CI, không flake 3 lần liên tiếp.

Ca biên: payload có `javascript:` trong tên tab; payload có `</textarea>`; mở share rồi bấm Fork; mở share trong iframe.
Giao diện: không có (kiểm bảo mật), nhưng phải xác nhận nội dung vẫn đọc được bình thường sau khi escape.
Kiểm tra: `npx playwright test web/e2e/share-security.spec.ts` và `RLS_TEST_DSN=... cd api && go test ./internal/store/... -run RLS`.
Góc review thêm: bảo mật (XSS, referrer), tính thật của test.
Đọc thêm: `_bmad-output/SP022/README.md`, `_bmad-output/SP023/STR103/Task152/task152.md`.
