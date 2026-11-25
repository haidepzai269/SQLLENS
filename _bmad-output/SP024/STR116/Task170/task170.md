# Task170 — Arena: AI Mentor phân tích kịch bản (VIP only)

Thuộc: SP024 / STR116
Mục tiêu: Thêm nút "Phân tích với AI Mentor" (chỉ hiển thị với user VIP) trong Deadlock Arena, gọi `POST /api/ai/inline-complete` với prompt thuần từ dữ liệu `conflict-sim`, tuyệt đối không nhúng SQL workspace của người dùng.
Phạm vi: `web/src/modules/arena/mentor/` (mới: `arena-mentor-prompt.ts`, `arena-mentor-panel.tsx`, `arena-mentor.test.tsx`), `web/src/modules/arena/components/arena-view.tsx` (nhận prop tùy chọn `isVip?: boolean`, giữ 100% tương thích test Task168 & Task169), `web/messages/{vi,en}/arena.json` (mục `mentor.*`).
Không làm: Không sửa `api/`, không sửa `web/src/modules/room/`, `web/src/modules/share/`, `web/messages/*/room.json`, `web/messages/*/share.json`, **tuyệt đối không gọi `/api/v1/ai/*`** (chỉ gọi `/api/ai/inline-complete`), không nhúng SQL từ workspace.

## Hợp đồng

- `buildArenaMentorPrompt({ scenarioId, stepIndex, locale })`: dựng `{ prefix, suffix, engine: "postgres", schemaSnippet }` chỉ từ metadata kịch bản & bước hiện tại của `conflict-sim` (`scenarios-data.ts`), tuyệt đối không đọc `useWorkspaceStore` hay nhận SQL tab của người dùng.
- `analyzeArenaStepWithMentor(params, fetchImpl?)`: gọi `POST /api/ai/inline-complete` (`credentials: "same-origin"`), trả `{ analysis, ok, errorKind? }`.
- `<ArenaMentorPanel isVip={isVip} />` tích hợp vào `<ArenaView isVip?: boolean />`: chỉ render nút "Phân tích với AI Mentor" khi `isVip === true`; luôn gắn nhãn **Mô phỏng** cạnh kết quả phân tích.

## Tiêu chí xong

- AC1: Nút "Phân tích với AI Mentor" chỉ hiển thị khi `isVip === true`; ẩn hoàn toàn khi `isVip` là `false` hoặc không truyền (bảo toàn 100% test Task168/169).
- AC2: Prompt chỉ dựng từ metadata kịch bản & bước mô phỏng (`conflict-sim`), **không** nhúng bất kỳ câu SQL nào từ workspace tab (unit test kiểm tra prompt trước khi gửi không chứa chuỗi SQL workspace thử nghiệm).
- AC3: Phản hồi từ AI hiển thị rõ trong khung phân tích kèm nhãn **Mô phỏng**; xử lý an toàn lỗi mạng / 401 / 403 / 429 / 500.
- AC4: Unit test khẳng định URL gọi ra chính xác là `/api/ai/inline-complete`, **không** gọi `/api/v1/ai/*`.
- AC5: `npm run check` PASS (`check:i18n`, `eslint`, `tsc --noEmit`, `vitest`), `API_ORIGIN=http://127.0.0.1:8080 npm run build` PASS.

## Ca biên

- Người dùng đổi bước hoặc đổi kịch bản trong khi kết quả phân tích cũ đang hiển thị → xóa kết quả cũ hoặc ghi rõ đang xem phân tích cũ, không treo spinner khi request bị abort.
- Response trả về `completion` rỗng hoặc JSON lỗi → hiển thị thông báo lỗi thân thiện (vi/en), có nút thử lại.
- Non-VIP không bao giờ phát sinh request tới `/api/ai/inline-complete`.

## Kiểm tra

```bash
cd web && npm run check
cd web && API_ORIGIN=http://127.0.0.1:8080 npm run build
```

## Góc review thêm

- Bảo mật / Nguyên tắc 6 & 7: prompt sạch tuyệt đối, không rò SQL workspace của người dùng; chỉ gọi `/api/ai/inline-complete` (không `/v1`).
- Nhãn kết luận: **Mô phỏng** bắt buộc hiển thị trên kết quả phân tích Arena.
- Giao diện: đủ vi/en, 390px không tràn ngang.

## Đọc thêm

- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` §Task170
- `web/src/modules/vip/api/copilot-client.ts`
- `web/src/modules/arena/components/arena-view.tsx`
- `web/src/modules/arena/scenarios-data.ts`
