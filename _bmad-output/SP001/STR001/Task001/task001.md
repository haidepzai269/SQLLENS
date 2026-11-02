# Task001: Khung web

Thuộc: SP001 / STR001
Mục tiêu: Tạo ứng dụng Next.js trong `web/` với TypeScript và shadcn/ui, có lint, typecheck, test, và cài sẵn các thư viện đã chốt.
Phạm vi: `web/**`. Không sửa file ngoài `web/`.
Không làm: i18n, deploy, CI, giao diện thật, nối PGlite. Trang chủ chỉ là trang trống tạm thời.

Hợp đồng:
- Dùng npm, App Router, thư mục `web/src/`, alias `@/` trỏ đến `web/src/`, Tailwind theo mặc định của shadcn/ui.
- `web/package.json` có các lệnh: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `check`.
- `npm run check` chạy lần lượt lint, typecheck, test. Task007 sẽ thêm bước kiểm tra bản dịch vào lệnh này, và CI chỉ gọi `npm run check`.
- Thư viện chạy: `next-intl`, `gsap`, `@gsap/react`, `@electric-sql/pglite` đúng bản `0.5.14`, `pgsql-parser`, `node-sql-parser`, `@uiw/react-codemirror`, `@codemirror/lang-sql`, `@xyflow/react`, `@dagrejs/dagre`, `cytoscape`, `@faker-js/faker`.
- Thư viện dev: `vitest`, `@playwright/test`, `@testing-library/react`, kiểu cho `cytoscape` nếu gói không kèm.
- Component shadcn/ui cài sẵn trong `web/src/components/ui/`: button, card, tabs, dialog, input, textarea, badge, tooltip, dropdown-menu, skeleton, sonner, table, alert.

Tiêu chí xong:
- AC1: `npm ci` trong `web/` chạy thành công từ lockfile.
- AC2: `npm run check` thoát với mã 0, có ít nhất một test Vitest thật render một component.
- AC3: `npm run build` thoát với mã 0.
- AC4: `npm run start` phục vụ `/` với mã 200.
- AC5: `node_modules/@electric-sql/pglite/package.json` có version `0.5.14`.
- AC6: Trang chủ không import các thư viện nặng đã cài sẵn. Các thư viện này chỉ nằm trong `package.json`.

Ca biên:
- Nếu `next-intl` hoặc thư viện nào không tương thích peer dependency với bản Next.js mới nhất, chọn bản tương thích gần nhất và ghi vào bàn giao. Không dùng `--force` hay `--legacy-peer-deps` khi chưa ghi lý do.

Kiểm tra: `cd web && npm ci && npm run check && npm run build`
Góc review thêm: không có.
Đọc thêm: `CLAUDE.md` mục "Quyết định đã chốt".

Việc thử thêm: khi đến bước review, thử gọi `task-reviewer` bằng Agent tool, rồi ghi vào bàn giao là subagent có gọi được subagent khác hay không. Không gọi được thì báo phiên chính.
