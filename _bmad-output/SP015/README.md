# SP015: AI Mentor 2.0 (Rule-Indexed Context & Deterministic Engine)

Kết quả: AI Mentor được kiên cố hóa với triết lý "Deterministic-First, AI-Last", tra cứu kho tri thức chuẩn O(1) in-memory theo RuleTag, nén 75% token, chống Prompt Injection tại Gin, hỗ trợ hội thoại đa lượt và khắc phục lỗi cụt lủn khi verify.

Tài liệu thiết kế: `_bmad-output/SPEC_RULE_INDEX.md` và `AI_PROBLEM.md`.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Nhãn |
|---|---|---|---|---|
| STR067 Kho tri thức Rule-Indexed | Task096 | Xây dựng thư viện tri thức chuẩn 15 tình huống Postgres & MySQL, tra cứu O(1) in-memory | Không | Mô phỏng |
| STR068 Bóc tách Plan & Nén Evidence | Task097 | Quét điểm nghẽn Plan gán RuleTag tự động, nén giảm 75% dung lượng JSON gửi lên AI | Task096 | Thật |
| STR069 Gin AI Proxy 2.0 & Guard | Task098 | Đổi model chính sang Qwen 3.8-27B siêu tốc (0.19s), xử lý reasoning stream, Intent Guard chặn Prompt Injection | Không | Thật |
| STR070 Hội thoại đa lượt & Summary | Task099 | Giao diện chat liên tục (Thread view), cơ chế Rolling Summary gửi tóm tắt câu trước | Task098 | Theo nguồn |
| STR071 Minh bạch Verify & MySQL Sandbox | Task100 | Chấm dứt cụt lủn khi SQL AI lỗi (hiện khung cảnh báo hổ phách), cầu nối EXPLAIN dry-run cho MySQL | Task097 | Thật |

## Trình tự thực thi khuyến nghị:

- **Đợt 1 (Lõi Backend & Tri thức):** Task096 (Knowledge Catalog) và Task098 (Gin Proxy & Intent Guard) có thể chạy song song độc lập.
- **Đợt 2 (Lõi nén & Đa lượt):** Task097 (Evidence Compactor) và Task099 (Multi-Turn Thread).
- **Đợt 3 (Giao diện & Kiểm chứng MySQL):** Task100 (Transparent Verification & MySQL Bridge).

