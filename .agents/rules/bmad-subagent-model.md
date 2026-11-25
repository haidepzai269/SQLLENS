# Quy tắc mở sub-agent & chọn model BMAD

- **Bắt buộc:** Mỗi khi chủ dự án yêu cầu mở sub-agent hoặc agent tự mở sub-agent (cả dev `amelia-dev` lẫn reviewer `task-reviewer`), **ưu tiên dùng công cụ `swarm` (`action: "add"`) và ghim đích danh `model: "gemini-4-hydrogen-medium"`** (`Gemini 4 Hydrogen (Medium)`) thay vì `invoke_subagent`.
- **Lý do & Fallback:**
  - `invoke_subagent` chỉ hỗ trợ 4 bậc cố định (`inherit | pro | flash | flash_lite`), không ghim được đích danh `gemini-4-hydrogen-medium`.
  - Chỉ khi công cụ `swarm` không khả dụng trong phiên (ví dụ phiên chưa được kích hoạt swarm) thì mới fallback sang `invoke_subagent` với `Model: "flash"` (tuyệt đối không dùng `pro`/`inherit` gây tốn token), hoặc đề nghị chủ dự án kích hoạt `/swarm`.
