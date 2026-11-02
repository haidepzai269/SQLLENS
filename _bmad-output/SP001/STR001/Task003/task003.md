# Task003: CI GitHub Actions

Thuộc: SP001 / STR001
Mục tiêu: Mỗi lần push và pull request đều chạy kiểm tra của `web/` và `api/`.
Phạm vi: `.github/workflows/ci.yml`.
Không làm: deploy, job Playwright (Task011 thêm), lệnh riêng cho bản dịch (nằm trong `npm run check`).

Hợp đồng:
- Trigger: `push` lên `main` và `task/**`, `pull_request` vào `main`.
- Job `web`: Node 22, `npm ci`, `npm run check`, `npm run build`, chạy trong `web/`, có cache npm.
- Job `api`: Go 1.25, kiểm tra `gofmt -l .` không in gì, `go vet ./...`, `go test ./...`, chạy trong `api/`.
- `permissions: contents: read` ở cấp workflow. Repo công khai, nên không dùng `pull_request_target` và không in secret.

Tiêu chí xong:
- AC1: Sau khi push branch `task/Task003`, `gh run list --branch task/Task003` cho thấy cả hai job thành công.
- AC2: `gofmt` phát hiện file chưa format thì job `api` đỏ. Kiểm bằng cách viết logic `test -z "$(gofmt -l .)"`, vì `gofmt -l` một mình luôn thoát 0.
- AC3: Có `actionlint` sạch, chạy qua Docker: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`.

Ca biên:
- Được phép push branch `task/Task003` để chạy thử. Không push `main`.

Kiểm tra: `gh run list --branch task/Task003 --limit 3`
Góc review thêm: bảo mật của workflow.
Đọc thêm: `_bmad-output/SP001/STR001/Task001/ban_giao_task001.md`, `_bmad-output/SP001/STR001/Task002/ban_giao_task002.md`.
