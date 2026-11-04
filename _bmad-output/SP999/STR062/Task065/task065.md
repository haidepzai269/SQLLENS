# Task065: CI xanh ổn định và chặn route thử trên production

Thuộc: SP999 / STR062
Mục tiêu: Tìm đúng nguyên nhân `btree-anim` lệch khi lùi bước, và không để các route `e2e-*` mở công khai trên production.
Phạm vi: `web/e2e/btree-anim.spec.ts`, `web/src/modules/btree-reader/anim/**`, file proxy hoặc middleware của `web/src`, `render.yaml`, `web/e2e/*` nếu cần cho kiểm thử route.
Không làm: thêm tính năng B-Tree, nới ngưỡng test khi chưa biết nguyên nhân.

Tiêu chí xong:
- AC1: `web/e2e/btree-anim.spec.ts:117` từng lệch 56,2 px và 61,2 px trên CI ở bước lùi, nhưng lần chạy khác lại đạt. Tìm nguyên nhân bằng bằng chứng: ghi vị trí key và giá trị `p` theo thời gian, chạy với CPU bị làm chậm (`Emulation.setCPUThrottlingRate`) để tái hiện, ghi kết quả tái hiện vào bàn giao.
- AC2: Nếu là lỗi thật của sản phẩm thì sửa sản phẩm. Nếu chỉ là test đo lúc tween chưa dừng thì sửa `settle` hoặc phép đo. Ngưỡng 1,5 px giữ nguyên. Chạy `--repeat-each=10 --workers=1` có CPU chậm 4 lần cho test này: 10/10 đạt.
- AC3: Khi `VERCEL_ENV` là `production`, mọi đường dẫn `/<locale>/e2e-*` trả 404, không lộ nội dung. Ở máy, CI và bản Preview vẫn truy cập được để Playwright chạy. Có test cho hàm quyết định, với cả hai locale, chữ hoa thường, dấu `/` cuối và đường dẫn trùng tiền tố như `/vi/e2e-` hay `/vi/about`, để không chặn nhầm trang thật.
- AC4: `render.yaml` có thêm `GROQ_API_KEY`, `OPENROUTER_API_KEY` với `sync: false`.
- AC5: `npm run check`, `npm run build` thoát 0. `web/e2e/btree-anim.spec.ts`, `web/e2e/lab.spec.ts` đạt với `--workers=1`.

Ca biên: lùi bước khi đang chạy, lùi nhanh liên tục, đổi cỡ cửa sổ giữa lúc lùi; route thử với query string.
Kiểm tra sau merge: phiên chính kiểm `/vi/e2e-mentor` trên production trả 404. Ghi rõ điều này vào bàn giao.
Góc review thêm: test có kiểm thật hay không, không che lỗi thật.
Đọc thêm: `_bmad-output/SP008/STR036/Task045/ban_giao_task045.md`; `CLAUDE.md` dòng GSAP Task045.
