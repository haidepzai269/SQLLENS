# Quy trình làm việc của agent

Mục tiêu: giảm token mà vẫn giao sản phẩm hoàn chỉnh. Token tốn nhiều nhất ở việc đọc code và context, nên quy trình ưu tiên task nhỏ, bàn giao ngắn và kiểm tra bằng máy trước khi dùng model.

## 1. Cấu trúc thư mục

```text
_bmad-output/
  SP001/                 Epic
    STR001/              Story
      Task001/
        task001.md
        ban_giao_task001.md
  SP999/                 Epic phát sinh, luôn nằm cuối
```

- Số Task không lặp trong toàn dự án, để tìm `Task012` chỉ ra đúng một task.
- Phiên chính cấp số Task trước khi giao, agent không tự đặt số.

## 2. Lập kế hoạch và phát sinh

- Epic, Story, Task do chủ dự án bàn trực tiếp với party mode.
- Phát sinh trong lúc code: sửa ngay nếu còn trong task đang làm.
- Đã qua task hoặc story đó: ghi vào mục Phát sinh của file bàn giao. Sau khi merge, phiên chính đưa vào `SP999`.
- `SP999` chứa lỗi cần sửa, tính năng chủ dự án mới thêm và các chỗ làm tắt từ `/ponytail-debt`.

## 3. Vòng làm việc của một task

| Bước | Ai làm | Việc |
|---|---|---|
| 1 | Phiên chính | Commit `task0xx.md` lên `main`, tạo worktree và branch `task/Task0xx` |
| 2 | Amelia | Code bằng Ponytail, chạy kiểm tra bằng máy, commit |
| 3 | Amelia gọi reviewer mới | Review theo mục 5, báo lỗi cho Amelia. Nếu Amelia không gọi được thì phiên chính gọi |
| 4 | Amelia | Sửa lỗi, commit |
| 5 | Cùng reviewer đó | Chỉ kiểm tra các lỗi đã báo và diff của bản sửa, tối đa 2 vòng |
| 6 | Amelia | Viết `ban_giao_task0xx.md`, commit, báo cáo chủ dự án |
| 7 | Phiên chính | Merge vào `main`, push, xóa worktree, đưa phát sinh vào `SP999` |

- Amelia và reviewer đều dùng Sonnet 5.5, định nghĩa ở `.claude/agents/amelia-dev.md` và `.claude/agents/task-reviewer.md`.
- Mỗi task một reviewer mới. Chủ dự án quyết định task sau dùng Amelia mới hay Amelia cũ, tùy độ dài task.
- Sau 2 vòng vẫn còn lỗi thì dừng và báo chủ dự án.
- Server mở ra để kiểm tra phải được tắt trước khi báo cáo, vì trên Windows nó khóa file và làm `npm ci` lỗi `EPERM`.
- Các task chạy song song không được sửa cùng file. Phiên chính kiểm tra việc này trước khi giao.

## 4. Mẫu file

### `task0xx.md`

```markdown
# Task0xx: <tên task>

Thuộc: SP0xx / STR0xx
Mục tiêu: <một câu>
Phạm vi: <đường dẫn file được tạo hoặc sửa>
Không làm: <ranh giới>
Hợp đồng: <chữ ký hàm, kiểu dữ liệu, API hoặc route mà task khác dựa vào>
Tiêu chí xong:
- AC1: <đầu vào cụ thể cho ra kết quả cụ thể>
- AC2: <...>
Ca biên: <đầu vào bất thường và kết quả mong đợi>
Giao diện (nếu có màn hình): <trạng thái tải, rỗng, lỗi; đủ tiếng Việt và tiếng Anh; chiều rộng điện thoại>
Kiểm tra: <lệnh hoặc thao tác>
Góc review thêm: bảo mật / nhãn kết luận / giao diện
Đọc thêm: <mục trong CLAUDE.md hoặc bàn giao liên quan>
```

Task mô tả hành vi và hợp đồng, không viết sẵn code. Reviewer chấm theo từng mã AC. Giới hạn đề xuất là tối đa 5 file và một vòng review, sẽ chỉnh lại sau 3 task đầu.

Để task song song không sửa cùng file:

- Bản dịch tách theo module: `messages/<ngôn ngữ>/<module>.json`.
- SP001 cài sẵn các thư viện đã biết. Thư viện mới do phiên chính thêm.

### `ban_giao_task0xx.md`

Viết câu đầy đủ, tối đa 40 dòng.

```markdown
# Bàn giao Task0xx

Đã làm: <kết quả>
File chính: <đường dẫn>
Kết quả kiểm tra: <lệnh đã chạy và kết quả thật>
Kết quả review: <số lỗi đã sửa, các mục needs_validation còn lại>
Chưa làm được: <nếu có>
Phát sinh: <việc cần đưa vào SP999>
Việc tiếp theo cần biết: <điều task sau phải biết>
```

## 5. Review

**Bước 1. Máy kiểm trước.** Lint, typecheck, test và kiểm tra thiếu bản dịch. Trượt thì Amelia tự sửa, chưa gọi reviewer.

**Bước 2. Commit** để reviewer đọc đúng diff.

**Bước 3. Một reviewer mới đọc một lượt theo các góc phù hợp:**

| Khi nào | Góc kiểm tra |
|---|---|
| Mọi task | Đúng yêu cầu, đúng logic, test có kiểm tra thật hay không |
| Đụng auth, quota, Gin, sandbox hoặc SQL người dùng | Bảo mật, theo `ATTACK-CLASSES.md` của skill `security-audit`, chỉ đọc phần liên quan |
| Có kết luận hiển thị cho người dùng | Nhãn Thật, Mô phỏng, Ước lượng có đúng không, có câu nào hàm ý "thiết kế ổn" không |
| Có giao diện | Chạy thử thật, đủ tiếng Việt và tiếng Anh |

**Bước 4. Mỗi lỗi phải có bằng chứng:** file, dòng, cách tái hiện. Chưa chứng minh được thì ghi `needs_validation`, Amelia không bắt buộc sửa nhưng phải ghi vào bàn giao.

**Bước 5. Kiểm tra lại:** chỉ xem các lỗi đã báo và diff của bản sửa, tối đa 2 vòng.

**Bước 6. Trước khi đóng Epic có sandbox hoặc auth:** chạy skill `security-audit` đầy đủ hơn, trong Docker tắt mạng.

Có thể dùng Docker để tái hiện lỗi ở bất kỳ bước nào.

## 6. Tra code và tìm bug

Đi từ rẻ đến đắt:

| Tình huống | Dùng |
|---|---|
| Biết bug thuộc tính năng nào | Cây `SP/STR/Task`, file bàn giao, `git log --grep Task012` |
| Có dòng code nghi ngờ, cần biết task nào viết | `git blame`, rồi đọc bàn giao của task đó |
| Có tên hàm, file hoặc class, cần xem liên kết và tác động khi sửa | `graphify explain "Tên"`, thêm `--all` khi cần danh sách đầy đủ |
| Cần đường nối giữa hai phần | `graphify path "A" "B"` |
| Cần vị trí chính xác để đổi tên hoặc sửa, biết kiểu dữ liệu | `gopls` cho Go, TypeScript language server cho TS |
| Chưa có tên nào để bắt đầu, tìm chuỗi, thông báo lỗi, key dịch | Grep, tìm ra tên rồi quay lại Graphify |

Quy tắc khi dùng Graphify:

- Chạy `graphify update .` trong worktree khi cần graph mới. Lệnh này không tốn LLM.
- Không đọc `graph.json` hoặc cả `GRAPH_REPORT.md`, vì quá lớn.
- Đừng bắt đầu bằng `graphify query` với câu hỏi tự nhiên. Khi thử, câu hỏi đầu bị cắt còn 23/372 node và không chỉ ra file đúng.
- Graph chỉ là lối vào. Trước khi sửa, đọc đoạn code thật tại vị trí nó chỉ.

Đo ngày 2026-11-02 trên bản sao `webhook-hub` (1.197 file, 10.061 node), dựng trong 86 giây:

| Câu hỏi | Graphify | Grep |
|---|---|---|
| `hubFetch` liên kết với đâu | 3.038 ký tự (20 liên kết nhiều nhất), 9.291 ký tự với `--all` | 17.151 ký tự, 27 file |
| `TenantScopedRepository` ảnh hưởng đến đâu | 3.688 ký tự (20 liên kết nhiều nhất) | 27.452 ký tự, 53 file |

Chưa đối chiếu từng nơi gọi giữa hai cách. Go đã thử trên mẫu nhỏ: đọc đúng quan hệ gọi hàm.

## 7. Kiểm tra giao diện

- **Playwright:** viết test cho việc cần kiểm tra lặp lại. Chạy lại không tốn token.
- **agent-browser:** xem nhanh và dò lỗi, dùng `snapshot -i` và `screenshot --if-changed`.
- **Animation:** snapshot không thấy được, phải chụp ảnh từng bước.

## 8. Giao diện

- **Next.js và shadcn/ui.** Không tự thiết kế component khi shadcn đã có. Cây B-Tree và các hình mô phỏng được tự vẽ vì shadcn không có.
- **Sơ đồ và đồ thị.** Sơ đồ bảng và cây plan dùng React Flow với thẻ từ shadcn/ui. Đồ thị chờ khóa dùng Cytoscape.js.
- **taste-skill:** dùng cho hướng thiết kế, và theo phần riêng của skill khi làm màn hình app.
- **GSAP:** dùng cho landing page, trang quảng bá và animation mô phỏng nếu tiện. Task animation đầu tiên phải báo lại nếu GSAP không hợp với B-Tree.

## 9. Git

- Mỗi task một worktree và một branch `task/Task0xx`.
- Commit: `feat(Task012): <việc đã làm>`. Loại khác dùng `fix`, `test`, `docs`, `chore`.
- Commit sau mỗi task và trong các bước 2, 4, 6 của vòng làm việc. Push `main` sau mỗi task.
- Không commit `.env`, key hay dữ liệu thật của người dùng.

## 10. Caveman

- **Dùng cho:** trả lời trong phiên làm việc và báo cáo giữa các agent.
- **Không dùng cho:** `task0xx.md`, `ban_giao_task0xx.md`, spec, `CLAUDE.md`, file này, nội dung sản phẩm.
- **Không chạy `/caveman:compress` trên `CLAUDE.md`.**
- Bật `caveman` chỉ làm câu trả lời ngắn lại, không thay thế yêu cầu trung thực: chưa chạy thì nói chưa chạy.
