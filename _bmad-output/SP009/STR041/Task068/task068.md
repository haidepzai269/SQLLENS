# Task068: Gắn bằng chứng và mức độ cho rủi ro

Thuộc: SP009 / STR041
Mục tiêu: Từ `RuleHit` và plan thật, tạo kết luận rủi ro có đúng một nhãn, có mức độ, có bằng chứng, và báo "chưa mô phỏng được" khi không đủ dữ liệu.
Phạm vi: `web/src/modules/findings/evidence/**`, `web/src/contracts/finding.ts`, `web/src/modules/findings/query-rules/**` (chỉ khi cần truyền `sql`), `web/messages/{vi,en}/findings.json`.
Không làm: màn hình, gắn vào `lab-workspace`, sửa bộ phân tích plan.

Hợp đồng, thêm vào `web/src/contracts/finding.ts`:
- `Severity = "broken" | "unverified" | "not_broken"`. Đỏ là `broken`, vàng là `unverified`, xanh là `not_broken`, theo dòng "Màu mức độ ở cột rủi ro" trong `CLAUDE.md`.
- `FindingData = { hit: RuleHit; severity: Severity; planNodeId?: string }`.
- `attachEvidence(hits: RuleHit[], input: { plans: { statementIndex: number; plan: Outcome<Plan> }[] }): Outcome<FindingData>[]`.

Tiêu chí xong:
- AC1: Luật query có plan thật: plan cho thấy bảng đó đọc bằng `seq_scan` thì `broken`, nhãn `real`, `evidence` có số dòng và số trang của nút đó, kèm `planNodeId`. Bảng nhỏ khiến planner vẫn chọn `seq_scan` dù có index thì câu bằng chứng phải nói đúng điều quan sát được, không kết luận luật là nguyên nhân khi không chứng minh được.
- AC2: Luật query mà plan vẫn dùng index: `not_broken`, nhãn `real`, câu bằng chứng chỉ nói "trong kịch bản đã chạy", không hàm ý thiết kế ổn.
- AC3: Luật query không có plan, plan là `NotSimulated`, hoặc plan MySQL `analyzed: false`: không được gắn nhãn Thật. Không có plan thì trả `NotSimulated` với `reasonKey`. Plan MySQL ước lượng thì mức `unverified`, nhãn `estimated`.
- AC4: Luật schema như thiếu PK, FK không có index, FLOAT lưu tiền, VARCHAR quá lớn: mô tả có từ cấu trúc nhưng chưa chạy kịch bản hỏng, nên mức `unverified`, không phải `broken`. Nhãn và câu bằng chứng phải đúng nguyên tắc 1 và 4 trong `CLAUDE.md`, ghi quyết định vào bàn giao.
- AC5: Có đủ câu dịch hai ngôn ngữ cho mọi `messageKey` của Task052, Task053 và của task này. Câu `implicit-cast` phân biệt `values.effect` theo ghi chú trong `SP009/README.md`. `checkQueries` nhận `sql` để có vị trí tô đúng biểu thức. Test quét toàn bộ câu dịch, không có câu hàm ý thiết kế ổn, tốt, an toàn.
- AC6: Dựng với kiểu `Outcome`, thiếu `evidence` thì không compile. Toàn bộ kết quả không có trường thời gian.
- AC7: `npm run check` thoát 0. Có test tích hợp chạy `explain` thật trên PGlite cho ít nhất luật bọc hàm, `LIKE '%x'`, sai tiền tố trái.

Ca biên: nhiều câu với `statementIndex` lệch; một bảng xuất hiện hai lần trong plan với hai bí danh; hit không có `table`; plan join nhiều bảng; không có hit nào, kết quả là mảng rỗng và không được hiểu là không có rủi ro.
Kiểm tra: `cd web && npm run check`. Không cần chạy Playwright.
Góc review thêm: nhãn kết luận, nguyên tắc 1, 2, 3, 4.
Đọc thêm: bàn giao Task046, Task052, Task053; `_bmad-output/SP009/README.md`.
