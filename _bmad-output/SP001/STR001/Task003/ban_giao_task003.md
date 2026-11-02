# Bàn giao Task003

Đã làm: Workflow CI `.github/workflows/ci.yml`. Trigger là push lên `main` và `task/**`, pull request vào `main`. Job `web` chạy Node 22 với cache npm, `npm ci`, `npm run check`, `npm run build` trong `web/`. Job `api` chạy Go 1.25, `test -z "$(gofmt -l .)"`, `go vet ./...`, `go test ./...` trong `api/`. `permissions: contents: read` ở cấp workflow, checkout dùng `persist-credentials: false`, không có `pull_request_target` và không dùng secret.
File chính: `.github/workflows/ci.yml`.
Kết quả kiểm tra: AC1 đạt, run 41437148991 trên `task/Task003` (commit cafa04e), job `api` và `web` đều success. AC2 đạt, `test -z "$(gofmt -l .)"` thoát 1 với file Go chưa format và thoát 0 với `api/` hiện tại. AC3 đạt, `actionlint` qua Docker không in gì, mã thoát 0 (trên Git Bash cần `MSYS_NO_PATHCONV=1` để Docker nhận đường dẫn).
Kết quả review: task-reviewer mới, 0 lỗi, 0 needs_validation.
Chưa làm được: Chưa kiểm hành vi trên pull request từ fork.
Phát sinh: Các action chỉ ghim theo tag (`@v4`, `@v5`), chưa ghim SHA. Nên ghim SHA khi cần siết chuỗi cung ứng. `next/font/google` cần mạng lúc build, runner GitHub có mạng nên build đã qua.
Việc tiếp theo cần biết: Task011 thêm job Playwright vào cùng file. Bản dịch được kiểm trong `npm run check`.
