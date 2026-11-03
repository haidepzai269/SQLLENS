# SP009: `findings`

Kết quả: Danh sách rủi ro của schema và query, mỗi mục có bằng chứng từ plan và đúng một nhãn. Không có câu nào hàm ý thiết kế ổn.

Hợp đồng chung: `web/src/contracts/finding.ts` (`RuleHit`). Luật chỉ trả `RuleHit`, chưa phải kết luận. STR041 mới gắn bằng chứng và nhãn.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR039 Luật schema | Task052 | Thiếu PK, FK không có index, FLOAT lưu tiền, VARCHAR quá lớn | Không | 1 |
| STR040 Luật query | Task053 | Bọc hàm lên cột có index, `LIKE '%x'`, sai tiền tố trái, ép kiểu ngầm | Không | 1 |
| STR041 Bằng chứng | chưa chia. Phải truyền `sql` cho `checkQueries` để tô đúng biểu thức, và câu dịch `implicit-cast` phân biệt `values.effect` (Task053) | | Task046, Task052, Task053 | 2 |
| STR042 Màn hình rủi ro | chưa chia | | STR041 | 3 |

## Các file bị đụng

| Task | File |
|---|---|
| Task052 | `web/src/modules/findings/schema-rules/**` |
| Task053 | `web/src/modules/findings/query-rules/**` |

Câu dịch của `messageKey` làm ở STR042, cùng màn hình.
