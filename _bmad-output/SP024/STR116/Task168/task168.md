# Task168: Arena — Chọn kịch bản + điều hướng bước (ScenarioPicker & StepController)

Thuộc: SP024 / STR116 (Deadlock Arena)
Mục tiêu: Xây dựng bộ điều khiển kịch bản deadlock cục bộ gồm ScenarioPicker (5 kịch bản conflict-sim chuẩn), StepController (Trước/Sau/Auto-Play 500ms), nhãn Mô phỏng bắt buộc, và state store Zustand.

Phạm vi:
- `web/src/modules/arena/types.ts` (mới — kiểu dữ liệu kịch bản, bước, state)
- `web/src/modules/arena/arena-store.ts` (mới — Zustand store quản lý kịch bản và bước)
- `web/src/modules/arena/components/scenario-picker.tsx` (mới — linh kiện chọn 5 kịch bản)
- `web/src/modules/arena/components/step-controller.tsx` (mới — thanh điều khiển Prev / Next / Auto-Play)
- `web/src/modules/arena/components/simulation-badge.tsx` (mới — nhãn Mô phỏng cố định)
- `web/src/modules/arena/components/arena-view.tsx` (mới — view tổng hợp ghép ScenarioPicker + StepController + SimulationBadge)
- `web/src/modules/arena/arena-store.test.ts` (mới — unit test cho store)
- `web/src/modules/arena/components/scenario-picker.test.tsx` (mới — test ScenarioPicker)
- `web/src/modules/arena/components/step-controller.test.tsx` (mới — test StepController)
- `web/messages/vi/arena.json` (mới — bản dịch tiếng Việt)
- `web/messages/en/arena.json` (mới — bản dịch tiếng Anh)

Không làm:
- Không gọi API mạng `POST /api/v1/cloud/projects/:id/arena-step` (việc của Task169).
- Không vẽ đồ thị Cytoscape Wait-For Graph (việc của Task169).
- Không tích hợp AI Mentor (việc của Task170).
- Không chạm backend Go `api/`.
- Không chạm các file ngoài thư mục `web/src/modules/arena/` và `web/messages/*/arena.json`.
- Tuyệt đối tuân thủ Core Rule 7: không lưu, không log, không gửi SQL của người dùng.

Hợp đồng:
- Kịch bản đọc trực tiếp từ `web/src/modules/conflict-sim/engine/scenarios.ts` (`SCENARIOS`):
  Đúng 5 ID chuẩn: `lost_update`, `deadlock_reverse_order`, `write_skew`, `double_booking`, `non_repeatable_read`.
- Kết quả mô phỏng mỗi kịch bản lấy từ `simulate(scenario)` trong `web/src/modules/conflict-sim/engine/simulate.ts` để lấy danh sách ticks, các giao dịch và trạng thái lỗi (deadlock / broken).
- Store `useArenaStore` (Zustand):
  ```typescript
  export interface ArenaState {
    scenarioId: ScenarioId;
    stepIndex: number;
    isPlaying: boolean;
    autoPlaySpeedMs: number; // default: 500ms
    setScenario: (id: ScenarioId) => void;
    nextStep: () => void;
    prevStep: () => void;
    setStep: (step: number) => void;
    togglePlay: () => void;
    pause: () => void;
    reset: () => void;
  }
  ```
- Nhãn Mô phỏng: Luôn ghim nhãn `Mô phỏng` (Simulation), sử dụng `ConclusionBadge` với `conclusion="simulated"` hoặc component badge tương đương, không cho phép tùy chọn ẩn.

Tiêu chí xong:
- **AC1:** Chọn kịch bản có id `deadlock_reverse_order` (tên hiển thị từ i18n) → thấy bước 1 với 2 transaction; bước 3 hiện `deadlock detected` (hoặc thông báo deadlock tương ứng từ engine).
- **AC2:** Nhãn **Mô phỏng** (Simulation) luôn hiển thị ở header giao diện Arena, không thể ẩn.
- **AC3:** `npm run check` PASS (lint, typecheck, vitest). `npm run check:i18n` PASS (mọi chuỗi UI có bản dịch vi + en đầy đủ).
- **AC4:** `<ScenarioPicker />` liệt kê đúng 5 kịch bản đang có, đọc id từ `web/src/modules/conflict-sim/engine/scenarios.ts`: `lost_update`, `deadlock_reverse_order`, `write_skew`, `double_booking`, `non_repeatable_read`. Không tự đặt tên mới.
- **AC5:** `<StepController />` có nút "Bước trước" (disabled khi ở bước 0), "Bước sau" (disabled khi ở bước cuối), "Play/Pause" tự động tăng bước mỗi 500ms, tự dừng khi chạm bước cuối.
- **AC6:** Giao diện responsive trên màn hình điện thoại 390px, không vỡ layout, không tràn ngang (`overflow-x`).

Ca biên:
- Đang auto-play mà người dùng chọn kịch bản khác: tự động pause và reset `stepIndex` về 0 của kịch bản mới.
- Bấm Next khi đang ở bước cuối cùng: giữ nguyên bước cuối, không tăng vượt quá `totalSteps - 1`.
- Bấm Prev khi đang ở bước 0: giữ nguyên 0, không giảm xuống âm.
- Auto-play chạy đến bước cuối: tự động chuyển `isPlaying` về `false` và dừng timer interval.

Giao diện:
- Khởi tạo mặc định với kịch bản `deadlock_reverse_order`.
- Đầy đủ bản dịch tiếng Việt (`web/messages/vi/arena.json`) và tiếng Anh (`web/messages/en/arena.json`).
- Hỗ trợ phím điều hướng hoặc nút bấm rõ ràng, kích thước tối thiểu 44px touch target trên mobile.

Kiểm tra:
- `cd web && npm run check:i18n`
- `cd web && npm run lint`
- `cd web && npm run typecheck`
- `cd web && npm test src/modules/arena`

Góc review thêm:
- Tính độc lập: Không phụ thuộc hay gọi API mạng nào.
- Tính trung thực: Nhãn "Mô phỏng" bắt buộc hiển thị rõ ràng.
- Ranh giới phạm vi: Không lấn sang vẽ Cytoscape (Task169) hay AI (Task170).

Đọc thêm:
- `_bmad-output/SP024/BAN_NHAP_STORY_SP024.md` mục D (STR116, Task168)
- `web/src/modules/conflict-sim/engine/scenarios.ts`
- `web/src/modules/conflict-sim/engine/simulate.ts`
