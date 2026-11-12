# Task104: Xây dựng linh kiện CustomSwitch SVG Cross/Checkmark độc quyền và SettingsContext

Thuộc: SP016 / STR075
Mục tiêu: Đóng gói linh kiện `CustomSwitch` chuẩn 100% theo mã CSS / styled-components với hiệu ứng trượt 3D, SVG Cross/Checkmark; xây dựng `SettingsContext` quản lý trạng thái các tùy chọn hệ thống (soạn thảo, màu sắc, autocomplete) và đồng bộ bền vững vào `localStorage`.

Phạm vi:
- `web/src/components/ui/custom-switch.tsx`
- `web/src/components/ui/custom-switch.test.tsx`
- `web/src/contexts/settings-context.tsx`
- `web/src/contexts/settings-context.test.tsx`
- `web/src/app/providers.tsx` (hoặc nơi wrap Context root)

Không làm: Không dùng các thư viện UI switch mặc định của bên thứ ba; không làm thay đổi các giá trị mặc định của editor khi chưa được bật; không làm mất cài đặt cũ khi người dùng làm mới trang.

Hợp đồng:
- `SwitchProps`: `{ checked?: boolean; defaultChecked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; id?: string; name?: string; 'aria-label'?: string; className?: string }`.
- `SettingsState`:
  ```typescript
  interface SettingsState {
    lineNumbers: boolean;           // Mặc định: true
    lineWrapping: boolean;          // Mặc định: true
    highlightActiveLine: boolean;   // Mặc định: true
    fontSize: 13 | 14 | 16;         // Mặc định: 14
    theme: 'dark' | 'light' | 'auto'; // Mặc định: 'dark'
    contrastBoost: boolean;         // Mặc định: false
    ghostTextEnabled: boolean;      // Mặc định: true (BẬT)
    dropdownAutocomplete: boolean;  // Mặc định: false (TẮT)
    aiCopilotEnabled: boolean;      // Mặc định: false (TẮT)
  }
  ```
- `useSettings()`: Hook truy xuất `settings` và hàm `updateSettings(partial)`.

Tiêu chí xong:
- AC1: Linh kiện `CustomSwitch` hiển thị chính xác theo kích thước 46x24px, slider bo tròn, vòng tròn 18px, icon Cross khi tắt, icon Checkmark khi bật.
- AC2: Hiệu ứng chuyển động mượt mà với đường cong bezier `cubic-bezier(0.27, 0.2, 0.25, 1.51)` và đường effect line mở rộng khi trượt.
- AC3: Tuân thủ đầy đủ trợ năng: Điều khiển được bằng phím `Space`/`Enter`, có role `switch` và thuộc tính `aria-checked`.
- AC4: `SettingsContext` khởi tạo với đúng các giá trị mặc định (Ghost text: BẬT, Dropdown: TẮT, AI Copilot: TẮT).
- AC5: Tự động tải từ và ghi lại vào `localStorage` với key `sqllens_settings_v1`. Khi dữ liệu `localStorage` bị hỏng, tự khôi phục về giá trị mặc định an toàn.
- AC6: Unit test cho `CustomSwitch` và `SettingsContext` đạt 100%.

Ca biên: `localStorage` bị vô hiệu hóa hoặc vượt quá hạn mức bộ nhớ; chuyển trạng thái nhanh liên tục; kiểm thử trên trình duyệt không hỗ trợ styled-components.
Kiểm tra: `npm run check` và `npx vitest run web/src/components/ui/custom-switch.test.tsx web/src/contexts/settings-context.test.tsx`.
Góc review thêm: Độ mượt mà của animation / Độ phản hồi nhanh không lag khi toggle.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR075) & `MUC_TIEU_TRUOC_MAT.md` mục 4.

