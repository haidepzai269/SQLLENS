# Task066: Trang `/login` và giới hạn dùng thử

Thuộc: SP005 / STR024, yêu cầu của chủ dự án ngày 2026-11-04
Mục tiêu: Có trang đăng nhập riêng thật đẹp bằng GSAP. Người chưa đăng nhập vào được sản phẩm nhưng chỉ chạy được câu lệnh cơ bản, 2 lần dùng thử.
Phạm vi: `web/src/app/[locale]/login/**`, `web/src/modules/auth/**`, `web/src/modules/lab/lab-workspace.tsx` (chỉ chỗ chặn khi bấm Chạy), `web/src/modules/lab/stage/stage.tsx` (chỉ chỗ khóa tab), `web/src/components/shell/app-frame.tsx` (để `/login` không có khung ứng dụng), `web/messages/{vi,en}/auth.json`, `web/e2e/login.spec.ts`, `web/e2e/auth.spec.ts`.
Không làm: sửa Gin, đổi luồng OAuth, thêm nhà cung cấp đăng nhập.

Quy tắc khách, theo dòng "Đăng nhập" trong `CLAUDE.md`:
- Khách là khi `/api/me` trả 401. Trạng thái chưa biết, như Gin đang ngủ hoặc lỗi mạng, thì không chặn, vì không được khóa người dùng thật khi Gin chưa thức.
- Được chạy: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, xét bằng `parseSql` có sẵn, mọi câu trong lần chạy đều phải thuộc nhóm này. Parser chưa tải thì chờ, không cho qua.
- 2 lần bấm Chạy thành công, đếm ở `localStorage` và phải bọc `try/catch`. Một lần chạy lỗi cú pháp hoặc bị chặn không tính. `localStorage` bị chặn thì giữ đếm trong bộ nhớ của tab.
- Khách xem được tab Sơ đồ và Plan. B-Tree, Thử sửa, Capacity, Mentor, Sinh dữ liệu, MySQL hiện khóa kèm lời mời đăng nhập.

Công cụ bắt buộc: GSAP theo skill `gsap-core`, `gsap-timeline`, `gsap-react`, `gsap-performance`, hướng thiết kế theo `design-taste-frontend`. Dùng token trong `DESIGN.md`, cùng ngôn ngữ hình ảnh với `/about` (xem `web/src/modules/landing/`, dùng lại component được thì dùng lại, không chép).

Tiêu chí xong:
- AC1: `/vi/login`, `/en/login` không có khung ứng dụng. Có hai nút Google và GitHub dùng route `/api/auth/<provider>/start?next=` có sẵn, nút xem `/about`, nút "Dùng thử không đăng nhập" về `/`, và một hiệu ứng lớn bằng GSAP liên quan đến database. Nội dung không cần cuộn ở 1440x900 và 390x844.
- AC2: Nút "Đăng nhập" trên header và lời mời đăng nhập khi hết lượt dẫn tới `/login` giữ đúng `next`, ngôn ngữ, engine, và SQL đang soạn qua `sql-stash` có sẵn, đăng nhập xong quay lại đúng chỗ, SQL còn nguyên. `next` phải là đường dẫn nội bộ, thử `//evil.example` và `https://evil.example`. Hộp thoại `LoginDialog` của cổng MySQL và AI giữ nguyên.
- AC3: Đã đăng nhập mà vào `/login` thì chuyển về `next` hoặc `/`. `?auth_error=cancelled|failed` hiện câu rõ ràng ở trang này.
- AC4: Khách chạy được 2 lần câu cơ bản. Giao diện luôn hiện số lượt còn lại. Lần thứ ba không chạy SQL, hiện lời mời đăng nhập, và SQL trong ô soạn không mất.
- AC5: Khách chạy `DROP TABLE t`, `CREATE INDEX`, `BEGIN`, `DO`, hoặc lô có một câu không thuộc nhóm: không chạy gì, không tính lượt, hiện câu nói đây là tính năng cần đăng nhập. Tải lại trang thì lượt vẫn được giữ.
- AC6: Khách bấm các tab khóa: thấy lời mời đăng nhập, không gọi `readBTree`, `tryChange`, `/api/ai/chat`. Đăng nhập xong mọi tab mở và không còn giới hạn lượt.
- AC7: Giao diện hoặc bàn giao không nói giới hạn này là biện pháp bảo mật. Có ghi chú trong code dạng `shortcut:` rằng giới hạn chỉ ở client và vì sao chấp nhận được.
- AC8: `/api/me` trả 503 hoặc lỗi mạng: không chặn, không đếm lượt. Các spec cũ không chạy Gin vẫn đạt mà không cần sửa hàng loạt. Test cho ba trạng thái 401, 200, 503.
- AC9: `npm run check`, `npm run build` thoát 0. `web/e2e/login.spec.ts`, `web/e2e/auth.spec.ts`, `web/e2e/lab.spec.ts`, `web/e2e/lab-stage.spec.ts` đạt với `--workers=1`.

Giao diện: Đủ tiếng Việt và tiếng Anh, 1440 và 390 px không cuộn ngang. Có giảm chuyển động. Focus thấy rõ, có bàn phím. Mở trang login không tải WASM. Lưu ảnh chụp trong `_bmad-output/SP005/STR024/Task066/anh/`, gồm trang login hai cỡ hai ngôn ngữ, màn hết lượt, tab khóa, và tự mở xem, ghi rõ đã xem ảnh nào.
Ca biên: mở hai tab cùng lúc, xóa `localStorage` giữa chừng, SQL rất dài khi stash lỗi, đăng xuất khi đang dùng, mở `/login?next=` rỗng.
Góc review thêm: bảo mật (open redirect), giao diện, tiêu chí khớp `CLAUDE.md`.
Đọc thêm: `_bmad-output/SP005/STR024/Task044/ban_giao_task044.md`; `_bmad-output/SP013/STR058/Task067/ban_giao_task067.md`; `web/src/components/shell/app-frame.tsx`.
