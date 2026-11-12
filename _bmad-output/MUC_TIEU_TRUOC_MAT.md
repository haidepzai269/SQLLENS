# SQLLens - Mục tiêu trước mắt & Lộ trình triển khai chi tiết
*Cập nhật: 2026-11-12 | Biên bản thống nhất chiến lược kỹ thuật & Sản phẩm*

Tài liệu này ghi chép chi tiết 7 mục tiêu hành động ưu tiên cao nhất của dự án SQLLens theo đúng chỉ đạo của Chủ dự án. Toàn bộ kiến trúc tuân thủ nguyên tắc: **Nhanh (<0.5s) - Minh bạch nhãn kết luận - Tối ưu 100% chi phí vận hành - Không ảo giác**.

---

## 📌 BẢNG TỔNG QUAN 7 MỤC TIÊU CHIẾN LƯỢC

| STT | Hạng mục | Trạng thái mặc định | Cơ chế kỹ thuật | Đối tượng / Role |
| :---: | :--- | :---: | :--- | :--- |
| **1** | **Fix lỗi nút "Hỏi AI Mentor" ở Terminal** | — | Nối prop `onAskAi` vào endpoint `POST /ai/diagnose` (Task095), stream kết quả trực tiếp tại lỗi kèm 1-Click Fix | Mọi người dùng |
| **2** | **Thiết kế phân quyền (User thường & VIP)** | — | Phân quyền RBAC trong Auth JWT, Neon DB: `guest` \| `user` \| `vip`, cơ chế nâng cấp tài khoản | Toàn hệ thống |
| **3** | **Thiết kế giao diện `/settings` chi tiết & Dropdown nâng cao** | — | Dropdown giữ nguyên thêm nút "Cài đặt nâng cao...", trang `/settings` đầy đủ tùy chọn soạn thảo, màu sắc, autocomplete | Toàn hệ thống |
| **4** | **Quy chuẩn Switch bật/tắt độc quyền** | — | Áp dụng 100% component Custom Switch (SVG Cross/Checkmark, hiệu ứng trượt slider 3D) cho mọi nút gạt | Toàn giao diện |
| **5** | **Triển khai Code-Based Autocomplete (Dropdown)** | **TẮT (OFF)** | `@codemirror/lang-sql` + Schema DB Sandbox PGlite/MySQL, popup menu từ khóa/bảng/cột, 0ms, 0đ | User thường & VIP |
| **6** | **Triển khai Inline thường (Code-Based Ghost Text)** | **BẬT (ON)** | State-machine AST & Foreign Key graph heuristics trong CodeMirror 6, chữ mờ xám, phím `Tab` nhận, 0ms, 0đ | User thường & VIP |
| **7** | **Triển khai Inline AI (AI Copilot Deep Completion)** | **TẮT (OFF)** | Gợi ý cả đoạn code/CTE phức tạp từ ngữ cảnh và comment qua model Qwen 3.8-27B siêu tốc 0.19s | **Dành riêng VIP** |

---

## MỤC 1: FIX NGAY NÚT "HỎI AI MENTOR VỀ LỖI NÀY" Ở TERMINAL

### 1.1. Nguyên nhân kỹ thuật gốc rễ
1. **Thiếu prop `onAskAi`:**
   - Trong [`web/src/modules/lab/lab-workspace.tsx`](file:///c:/SQLLens/web/src/modules/lab/lab-workspace.tsx#L656-L667) khi render thẻ lỗi `<SqlErrorView ... />`, prop `onAskAi` hoàn toàn không được truyền vào.
   - Thẻ [`web/src/components/result-grid/sql-error-view.tsx`](file:///c:/SQLLens/web/src/components/result-grid/sql-error-view.tsx#L206-L215) kích hoạt `onClick={() => onAskAi?.(remediation)}`. Do hàm là `undefined`, sự kiện bị nuốt chửng, không có state thay đổi, không có `fetch()`, dẫn tới tab Network trống trơn và giao diện không phản hồi.
2. **Chưa nối client tới Backend `POST /ai/diagnose`:**
   - Backend Go Gin ở Task095 ([`api/internal/ai/ai.go`](file:///c:/SQLLens/api/internal/ai/ai.go#L84)) đã có sẵn endpoint `POST /ai/diagnose` nhận payload `{ sql, error, engine, locale, question }` và stream SSE lời giải thích kèm khối ```sql ... ``` đã sửa.
   - Phía frontend chưa có hàm API client và chưa có khung UI hiển thị kết quả chẩn đoán tại chỗ.

### 1.2. Giải pháp triển khai chi tiết
- **Bước 1 (Client Streaming Service):** Tạo module `diagnose-service.ts` tại `web/src/modules/mentor/api/diagnose.ts` kết nối tới `/ai/diagnose`, đọc ReadableStream SSE (`data: {"delta": "..."}`).
- **Bước 2 (State & UI trong `SqlErrorView`):**
  - Thêm state: `diagnosing: boolean`, `diagnosisResult: string | null`, `suggestedSql: string | null`, `diagnoseError: string | null`.
  - Khi bấm nút:
    + Nút chuyển sang trạng thái loading với Spinner (chặn double-click).
    + Bên dưới thẻ lỗi mở ra một khung **"Chẩn đoán từ AI Mentor" (AI Doctor Card)** có viền tím/xanh nhạt.
    + Stream nội dung giải thích nguyên nhân gốc rễ và bóc tách đoạn SQL sửa chữa.
- **Bước 3 (1-Click Fix):**
  - Khối SQL sửa chữa hiển thị kèm nút **"Áp dụng sửa ngay (1-Click Fix)"**.
  - Bấm nút này sẽ gọi callback `onApplyFix(suggestedSql)` để tự động điền câu lệnh đã sửa vào SQL Editor.

---

## MỤC 2: THIẾT KẾ PHÂN QUYỀN — USER THƯỜNG VÀ VIP

### 2.1. Cấu trúc Role & Phân cấp tính năng (RBAC)
Hệ thống xác định 3 cấp độ tài khoản:
1. **Guest (Chưa đăng nhập):**
   - Dùng PGlite client-side đầy đủ, mô phỏng B-Tree, Plan, What-if.
   - Sử dụng **Inline Code-based Ghost Text** (miễn phí 100%).
   - Quota: 3 tin nhắn AI Mentor cơ bản (IP-based).
2. **User thường (Standard / Free - Đã đăng nhập qua Google/GitHub):**
   - Toàn quyền lưu trữ phiên, dùng MySQL Sandbox.
   - Sử dụng **Inline Code-based Ghost Text** không giới hạn.
   - Quota: Hạn ngạch AI Mentor tiêu chuẩn (ví dụ 10 câu hỏi/ngày).
3. **VIP (Pro / Enterprise):**
   - **Độc quyền:** Mở khóa **AI Inline Ghost Text (Copilot)** — đọc hiểu ngữ cảnh cả file và comment để sinh nguyên khối truy vấn phức tạp (CTE, Window function).
   - Hạn ngạch AI Mentor không giới hạn hoặc hạn mức cao (1000 lượt/tháng).
   - Ưu tiên tài nguyên container MySQL Sandbox hiệu năng cao.
   - Badge "VIP" màu vàng ánh kim hiển thị cạnh Avatar người dùng.

### 2.2. Cơ chế kỹ thuật & Nâng cấp tài khoản
- **Database Schema (Neon Postgres):**
  - Bảng `users`: Bổ sung cột `role VARCHAR(20) DEFAULT 'user'`, `vip_until TIMESTAMPTZ NULL`.
- **JWT / Auth Token:**
  - Token claims chứa `{ "user_id": "...", "role": "user" | "vip", "vip_until": ... }`.
- **Backend Gate (`api/internal/auth` & `api/internal/quota`):**
  - Middleware `RequireRole("vip")`: Chặn người dùng thường gọi các API cao cấp như `/ai/inline-complete`, trả về mã lỗi `403 Forbidden: "upgrade_required"`.
- **Luồng nâng cấp lên VIP (Upgrade Flow):**
  - Nút "Nâng cấp VIP" xuất hiện ở thanh Header, trang `/settings` và trong các gợi ý chuyển đổi (CTA khi user thường gõ comment truy vấn phức tạp).
  - Modal hoặc trang `/upgrade` giới thiệu tính năng vượt trội của gói VIP kèm các gói thuê bao hoặc mã kích hoạt (Voucher/Promo code).

---

## MỤC 3: THIẾT KẾ GIAO DIỆN `/settings` & DROPDOWN NÂNG CAO

### 3.1. Dropdown Settings ngoài màn hình chính (`PanelToggles`)
- Vị trí: Biểu tượng bánh răng ở góc trên bên phải thanh Header.
- Giao diện:
  - **Phần trên (Giữ nguyên hiện tại):** Danh sách 4 checkbox bật/tắt các phân vùng layout (Cột SQL, Vùng mô phỏng, Cột rủi ro, Terminal).
  - **Đường phân cách:** `<DropdownMenuSeparator />`.
  - **Phần bổ sung mới:** Mục menu **"Cài đặt nâng cao..." (Advanced Settings)** với biểu tượng mở rộng, click vào sẽ chuyển hướng sang trang `/settings` (hoặc mở Modal Settings toàn diện).

### 3.2. Cấu trúc trang Cài đặt chi tiết `/settings`
Trang cài đặt thiết kế theo chuẩn giao diện phẳng, hiện đại với thanh điều hướng danh mục bên trái hoặc dạng thẻ tab:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚙️ CÀI ĐẶT HỆ THỐNG (SETTINGS)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. SOẠN THẢO SQL (EDITOR)                                                   │
│    • Hiển thị số dòng (Line Numbers)                  [ SWITCH: BẬT ]       │
│    • Tự động ngắt dòng (Line Wrapping)                [ SWITCH: BẬT ]       │
│    • Tô sáng dòng đang gõ (Highlight Active Line)     [ SWITCH: BẬT ]       │
│    • Kích thước phông chữ                             [ 13px | 14px | 16px] │
│                                                                             │
│ 2. GIAO DIỆN & MÀU SẮC (APPEARANCE)                                         │
│    • Chế độ giao diện                                 [ Tối | Sáng | Auto ] │
│    • Tông màu tương phản (Contrast Boost)             [ SWITCH: TẮT ]       │
│                                                                             │
│ 3. TRỢ LÝ SOẠN THẢO & GỢI Ý MÃ (AUTOCOMPLETE)                              │
│    • Gợi ý viết tiếp trực tiếp (Inline Ghost Text)    [ SWITCH: BẬT ] (MĐ)  │
│      (Chữ mờ sau con trỏ, nhấn Tab để nhận - 0đ phí)                        │
│    • Menu gợi ý dạng popup (Code-based Dropdown)      [ SWITCH: TẮT ] (MĐ)  │
│      (Menu xổ xuống khi gõ từ khóa SQL/Tên bảng/Cột)                        │
│    • Gợi ý sâu từ AI Copilot (AI Inline Ghost Text)   [ SWITCH: TẮT ] (MĐ)  │
│      [⭐ Dành riêng VIP] (Tự động sinh khối SQL phức tạp từ comment)        │
│                                                                             │
│ 4. TÀI KHOẢN & PHÂN QUYỀN (ACCOUNT & VIP)                                   │
│    • Cấp độ tài khoản: THƯỜNG (FREE)                  [ NÂNG CẤP VIP ]      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## MỤC 4: QUY CHUẨN SWITCH BẬT/TẮT ĐỘC QUYỀN

Tất cả các nút bật tắt trong hệ thống (đặc biệt trong trang `/settings`) phải sử dụng linh kiện Switch sau đây.

### 4.1. Mã nguồn Component Chuẩn

```tsx
import React from 'react';
import styled from 'styled-components';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  defaultChecked,
  onChange,
  disabled,
  id,
  name,
  'aria-label': ariaLabel,
}) => {
  return (
    <StyledWrapper>
      <label className={`switch ${disabled ? 'disabled' : ''}`}>
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <div className="slider">
          <div className="circle">
            <svg
              className="cross"
              xmlSpace="preserve"
              style={{ enableBackground: 'new 0 0 512 512' }}
              viewBox="0 0 365.696 365.696"
              y={0}
              x={0}
              height={6}
              width={6}
              xmlnsXlink="http://www.w3.org/1999/xlink"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g>
                <path
                  data-original="#000000"
                  fill="currentColor"
                  d="M243.188 182.86 356.32 69.726c12.5-12.5 12.5-32.766 0-45.247L341.238 9.398c-12.504-12.503-32.77-12.503-45.25 0L182.86 122.528 69.727 9.374c-12.5-12.5-32.766-12.5-45.247 0L9.375 24.457c-12.5 12.504-12.5 32.77 0 45.25l113.152 113.152L9.398 295.99c-12.503 12.503-12.503 32.769 0 45.25L24.48 356.32c12.5 12.5 32.766 12.5 45.247 0l113.132-113.132L295.99 356.32c12.503 12.5 32.769 12.5 45.25 0l15.081-15.082c12.5-12.504 12.5-32.77 0-45.25zm0 0"
                />
              </g>
            </svg>
            <svg
              className="checkmark"
              xmlSpace="preserve"
              style={{ enableBackground: 'new 0 0 512 512' }}
              viewBox="0 0 24 24"
              y={0}
              x={0}
              height={10}
              width={10}
              xmlnsXlink="http://www.w3.org/1999/xlink"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g>
                <path
                  className=""
                  data-original="#000000"
                  fill="currentColor"
                  d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"
                />
              </g>
            </svg>
          </div>
        </div>
      </label>
    </StyledWrapper>
  );
};

const StyledWrapper = styled.div`
  .switch {
    /* switch */
    --switch-width: 46px;
    --switch-height: 24px;
    --switch-bg: rgb(131, 131, 131);
    --switch-checked-bg: rgb(0, 218, 80);
    --switch-offset: calc((var(--switch-height) - var(--circle-diameter)) / 2);
    --switch-transition: all .2s cubic-bezier(0.27, 0.2, 0.25, 1.51);
    /* circle */
    --circle-diameter: 18px;
    --circle-bg: #fff;
    --circle-shadow: 1px 1px 2px rgba(146, 146, 146, 0.45);
    --circle-checked-shadow: -1px 1px 2px rgba(163, 163, 163, 0.45);
    --circle-transition: var(--switch-transition);
    /* icon */
    --icon-transition: all .2s cubic-bezier(0.27, 0.2, 0.25, 1.51);
    --icon-cross-color: var(--switch-bg);
    --icon-cross-size: 6px;
    --icon-checkmark-color: var(--switch-checked-bg);
    --icon-checkmark-size: 10px;
    /* effect line */
    --effect-width: calc(var(--circle-diameter) / 2);
    --effect-height: calc(var(--effect-width) / 2 - 1px);
    --effect-bg: var(--circle-bg);
    --effect-border-radius: 1px;
    --effect-transition: all .2s ease-in-out;
  }

  .switch input {
    display: none;
  }

  .switch {
    display: inline-block;
  }

  .switch.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .switch svg {
    -webkit-transition: var(--icon-transition);
    -o-transition: var(--icon-transition);
    transition: var(--icon-transition);
    position: absolute;
    height: auto;
  }

  .switch .checkmark {
    width: var(--icon-checkmark-size);
    color: var(--icon-checkmark-color);
    -webkit-transform: scale(0);
    -ms-transform: scale(0);
    transform: scale(0);
  }

  .switch .cross {
    width: var(--icon-cross-size);
    color: var(--icon-cross-color);
  }

  .slider {
    -webkit-box-sizing: border-box;
    box-sizing: border-box;
    width: var(--switch-width);
    height: var(--switch-height);
    background: var(--switch-bg);
    border-radius: 999px;
    display: -webkit-box;
    display: -ms-flexbox;
    display: flex;
    -webkit-box-align: center;
    -ms-flex-align: center;
    align-items: center;
    position: relative;
    -webkit-transition: var(--switch-transition);
    -o-transition: var(--switch-transition);
    transition: var(--switch-transition);
    cursor: pointer;
  }

  .circle {
    width: var(--circle-diameter);
    height: var(--circle-diameter);
    background: var(--circle-bg);
    border-radius: inherit;
    -webkit-box-shadow: var(--circle-shadow);
    box-shadow: var(--circle-shadow);
    display: -webkit-box;
    display: -ms-flexbox;
    display: flex;
    -webkit-box-align: center;
    -ms-flex-align: center;
    align-items: center;
    -webkit-box-pack: center;
    -ms-flex-pack: center;
    justify-content: center;
    -webkit-transition: var(--circle-transition);
    -o-transition: var(--circle-transition);
    transition: var(--circle-transition);
    z-index: 1;
    position: absolute;
    left: var(--switch-offset);
  }

  .slider::before {
    content: "";
    position: absolute;
    width: var(--effect-width);
    height: var(--effect-height);
    left: calc(var(--switch-offset) + (var(--effect-width) / 2));
    background: var(--effect-bg);
    border-radius: var(--effect-border-radius);
    -webkit-transition: var(--effect-transition);
    -o-transition: var(--effect-transition);
    transition: var(--effect-transition);
  }

  /* actions */

  .switch input:checked+.slider {
    background: var(--switch-checked-bg);
  }

  .switch input:checked+.slider .checkmark {
    -webkit-transform: scale(1);
    -ms-transform: scale(1);
    transform: scale(1);
  }

  .switch input:checked+.slider .cross {
    -webkit-transform: scale(0);
    -ms-transform: scale(0);
    transform: scale(0);
  }

  .switch input:checked+.slider::before {
    left: calc(100% - var(--effect-width) - (var(--effect-width) / 2) - var(--switch-offset));
  }

  .switch input:checked+.slider .circle {
    left: calc(100% - var(--circle-diameter) - var(--switch-offset));
    -webkit-box-shadow: var(--circle-checked-shadow);
    box-shadow: var(--circle-checked-shadow);
  }
`;

export default Switch;
```

---

## MỤC 5: TRIỂN KHAI CHI TIẾT CODE-BASE AUTOCOMPLETE (DROPDOWN POPUP)

- **Trạng thái cấu hình:** **Mặc định TẮT (OFF)**.
- **Mục tiêu:** Cung cấp menu gợi ý dạng dropdown truyền thống (tương tự VS Code / DataGrip) cho người dùng muốn tra cứu trực quan danh sách bảng, cột hoặc từ khóa.
- **Kiến trúc kỹ thuật:**
  1. **Tích hợp CodeMirror Extension:**
     - Sử dụng `@codemirror/autocomplete` kết hợp extension `sql()` từ `@codemirror/lang-sql`.
     - Nhận cấu hình schema động từ state `tables` của `lab-workspace.tsx`:
       ```typescript
       const schema = useMemo(() => {
         const s: Record<string, string[]> = {};
         for (const tbl of tables) {
           s[tbl.name] = tbl.columns.map((c) => c.name);
         }
         return s;
       }, [tables]);
       ```
  2. **Nạp vào Extension khi tính năng được BẬT:**
     ```typescript
     extensions.push(sql({ dialect: DIALECT[engine], schema }));
     ```
  3. **Đặc tính:**
     - Tốc độ: < 1ms, chạy 100% trên Client Web Worker.
     - 0đ chi phí, 0 token.
     - Lọc mờ (Fuzzy matching) chuẩn xác.

---

## MỤC 6: TRIỂN KHAI CHI TIẾT INLINE THƯỜNG (CODE-BASED GHOST TEXT)

- **Trạng thái cấu hình:** **Mặc định BẬT (ON)**.
- **Mục tiêu:** Gợi ý viết tiếp đoạn code mờ xám ngay sau con trỏ chuột, không làm rối màn hình, nhấn phím `Tab` để hoàn thành. Hoàn toàn chạy bằng code, 0 AI, 0 token, độ trễ tức thì (0ms).

### 6.1. Động cơ phân tích cú pháp (Rule-based Heuristic Engine)
Chạy trên luồng client qua bộ phân tích ngữ cảnh:
1. **Dự đoán tự động `JOIN ... ON ...` (Dựa trên Foreign Key Graph):**
   - Phân tích bảng đang truy vấn trong mệnh đề `FROM <table>`.
   - Tra cứu schema lấy danh sách bảng có khóa ngoại liên kết (ví dụ `orders.user_id -> users.id`).
   - Khi người dùng gõ `SELECT * FROM users u JOIN `, gợi ý ngay:
     `orders o ON o.user_id = u.id`.
2. **Dự đoán tự động `GROUP BY`:**
   - Khi người dùng gõ `GROUP BY `, động cơ duyệt ngược lại mệnh đề `SELECT`, trích xuất các biểu thức cột không nằm trong aggregate function (`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`).
   - Tự động điền danh sách các cột đó: `GROUP BY u.department, u.role`.
3. **Dự đoán `INSERT INTO`:**
   - Khi gõ `INSERT INTO users `, tự động gợi ý danh sách toàn bộ cột của bảng:
     `(name, email, age) VALUES ()`.
4. **Dự đoán mệnh đề tiếp theo (SQL Flow Lifecycle):**
   - Sau `SELECT ... FROM table` -> gợi ý ` WHERE ` hoặc ` ORDER BY id DESC`.

### 6.2. Cơ chế hiển thị trong CodeMirror 6
- **Widget Decoration:**
  - Dùng `Decoration.widget({ side: 1 })` chèn một node DOM ảo ngay tại vị trí con trỏ `from === to`.
  - DOM: `<span class="opacity-40 select-none pointer-events-none text-muted-foreground font-mono">orders o ON o.user_id = u.id</span>`.
- **Xử lý phím tắt:**
  - `Tab`: Chèn đoạn text ghost vào vị trí con trỏ, đưa con trỏ về cuối đoạn text vừa chèn.
  - `Escape`: Ẩn ngay lập tức đoạn ghost text hiện tại.
  - Gõ phím bất kỳ: Nếu phím gõ trùng với ký tự đầu của ghost text -> cắt ngắn đoạn ghost text; nếu gõ ký tự khác -> hủy bỏ gợi ý.

---

## MỤC 7: TRIỂN KHAI CHI TIẾT INLINE AI (VIP COPILOT)

- **Trạng thái cấu hình:** **Mặc định TẮT (OFF) — Dành riêng cho tài khoản VIP**.
- **Mục tiêu:** Khi người dùng cần giải quyết các bài toán phức tạp (truy vấn phân tích, CTE nhiều tầng, logic từ bình luận tiếng Việt), AI sẽ đọc toàn bộ ngữ cảnh và sinh cả một khối code hoàn chỉnh.

### 7.1. Cơ chế kích hoạt & Tối ưu chi phí
1. **Kích hoạt thông minh (Smart Debounce & Comment Trigger):**
   - Chỉ gọi AI khi:
     + Người dùng gõ một dòng comment ý đồ (ví dụ: `-- Top 5 khách hàng chi tiêu nhiều nhất theo từng tháng\n`).
     + Hoặc người dùng dừng gõ phím quá **600ms** tại cuối một câu truy vấn chưa hoàn chỉnh.
     + Hoặc người dùng nhấn tổ hợp phím chủ động: `Ctrl + Space` (hoặc `Cmd + I`).
2. **Nén ngữ cảnh tối đa (Compact Prompting):**
   - Context chỉ lấy 15-20 dòng SQL gần nhất + Danh sách bảng/cột rút gọn (không gửi toàn bộ dump dữ liệu).
   - `max_tokens = 64` hoặc `128` (chỉ đủ cho câu query đang viết, không sinh lan man).
3. **Model siêu tốc (Gin Proxy 2.0):**
   - Gọi endpoint `POST /ai/inline-complete` qua Gin proxy kết nối model `qwen/qwen3.8-27b` với tốc độ phản hồi chỉ **0.19s**.
4. **Hiển thị & Tương tác:**
   - Trả về ghost text nhiều dòng (Multi-line Ghost Text).
   - Nhấn `Tab` để chấp nhận toàn bộ khối lệnh.
   - Nhấn `Escape` để hủy.

---

## 📅 BẢNG KẾ HOẠCH BÀN GIAO & PHÂN CÔNG THỰC HIỆN

```
┌──────────┬─────────────────────────────────────────────────┬──────────┬─────────────┐
│ Đợt      │ Nội dung công việc                              │ Nhân sự  │ Mục tiêu    │
├──────────┼─────────────────────────────────────────────────┼──────────┼─────────────┤
│ ĐỢT 1    │ Fix ngay nút "Hỏi AI Mentor" ở Terminal        │ Amelia   │ Mục 1       │
│          │ (Nối prop onAskAi, gọi /ai/diagnose, 1-Click)   │          │             │
├──────────┼─────────────────────────────────────────────────┼──────────┼─────────────┤
│ ĐỢT 2    │ Thiết kế Switch độc quyền & Màn hình /settings  │ Sally    │ Mục 3, 4    │
│          │ (CustomSwitch SVG, menu dropdown nâng cao)     │          │             │
├──────────┼─────────────────────────────────────────────────┼──────────┼─────────────┤
│ ĐỢT 3    │ Động cơ Inline Code-based & Autocomplete        │ Winston  │ Mục 5, 6    │
│          │ (CodeMirror ghost text, FK JOIN, GROUP BY)      │ + Amelia │             │
├──────────┼─────────────────────────────────────────────────┼──────────┼─────────────┤
│ ĐỢT 4    │ Phân quyền VIP & AI Inline Copilot              │ Winston  │ Mục 2, 7    │
│          │ (RBAC role vip, endpoint /ai/inline-complete)   │ + John   │             │
└──────────┴─────────────────────────────────────────────────┴──────────┴─────────────┘
```

*Tất cả cam kết kiểm tra bằng máy (`npm run check`, tests unit Go và Vitest) đạt 100% trước khi bàn giao.*
