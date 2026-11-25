# Quy tắc chọn model cho sub-agent BMAD

- **Bắt buộc:** Mỗi lần tạo hoặc gọi sub-agent (cả dev `amelia-dev` lẫn reviewer `task-reviewer`), truyền tham số model khi tạo sub-agent là **`gemini hydrogen medium`**.
- **Tương thích công cụ:**
  - Nếu công cụ tạo/gọi sub-agent hỗ trợ truyền tên model (ví dụ `swarm` hoặc `create sub-agent`), truyền đúng `gemini hydrogen medium`.
  - Nếu công cụ chỉ chấp nhận tập giá trị cố định (`invoke_subagent`: `inherit | pro | flash | flash_lite`), không truyền chuỗi sai schema và không tự ý chạy `pro`/`inherit` gây tốn token; ưu tiên `flash` hoặc báo chủ dự án dùng `/swarm` khi cần ghim đích danh `gemini hydrogen medium`.
