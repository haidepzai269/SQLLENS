# SP018: AI Mentor Deep Optimizer Intelligence (Execution Plan Evidence & Upfront Feeding)

Epic này hiện thực hóa khả năng thấu hiểu kế hoạch thực thi CSDL (Execution Plan / Buffers) của AI Mentor theo đặc tả `_bmad-output/SPEC_AI_PLAN_EVIDENCE.md`.
Thay vì suy đoán lý thuyết, AI Mentor được cung cấp dữ liệu đo đạc thực nghiệm từ sandbox mang nhãn **Thật**, nén xuống dưới 40 tokens và truyền trực tiếp trong 1 request duy nhất (zero latency, zero tool-calling risk).

## Danh sách Stories & Tasks

| Story | Task | Tên Task | Phân công | Trạng thái |
|---|---|---|---|---|
| **STR086** | `Task119` | Client-Side Safe EXPLAIN & 40-Token AST Plan Minifier | Amelia | Chờ thực hiện |
| **STR087** | `Task120` | Upfront Evidence Injection, System Prompt Engineering & Live Review Verification | Winston / Amelia | Chờ thực hiện |
| **STR088** | `Task121` | UI Smart Controls (Pill Badge, Quick Chips) & MySQL Engine Guard | Sally / Amelia | Chờ thực hiện |

## Chỉ thị Nghiệm thu Đặc biệt từ Chủ Dự án:
Khi `Task120` hoàn thành, **Agent Reviewer độc lập bắt buộc phải chạy thử thật (Live Model Testing)** với payload nén 40 tokens để kiểm chứng chất lượng phân tích của AI Mentor trước khi ký duyệt bàn giao!
