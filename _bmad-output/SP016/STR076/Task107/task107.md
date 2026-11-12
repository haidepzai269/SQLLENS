# Task107: Giao diện nhận diện Badge VIP, Modal nâng cấp tài khoản và Cổng kích hoạt mã VIP (Promo Code)

Thuộc: SP016 / STR076
Mục tiêu: Xây dựng huy hiệu nhận diện VIP màu vàng ánh kim tinh tế tại Header và Avatar; xây dựng Modal / Trang nâng cấp VIP (`/upgrade`) so sánh quyền lợi vượt trội và hỗ trợ nhập mã quà tặng (Promo code) để kích hoạt VIP tức thì.

Phạm vi:
- `web/src/components/shell/user-nav.tsx`
- `web/src/components/ui/vip-badge.tsx`
- `web/src/modules/vip/upgrade-modal.tsx`
- `web/src/modules/vip/upgrade-modal.test.tsx`
- `web/src/modules/vip/api/redeem.ts`
- `web/messages/vi/vip.json`, `web/messages/en/vip.json`

Không làm: Không ép buộc người dùng nâng cấp để sử dụng các tính năng cơ bản (PGlite và Ghost text Heuristics miễn phí vĩnh viễn); không tích hợp cổng thanh toán phức tạp trong task này.

Hợp đồng:
- `VipBadge({ size?: 'sm' | 'md' })`: Render badge VIP viền vàng kim loại, gradient nhẹ và hiệu ứng ánh sáng.
- `UpgradeModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })`: Mở hộp thoại nâng cấp tài khoản kèm ô nhập mã kích hoạt.
- `redeemVipCode(code: string): Promise<{ success: boolean; expiresAt: string }>`: Gọi `POST /api/auth/redeem-vip`.

Tiêu chí xong:
- AC1: Nếu tài khoản có `role === "vip"` và chưa hết hạn, hiển thị `VipBadge` cạnh tên người dùng ở Header và menu cá nhân.
- AC2: Nếu tài khoản là `user` hoặc `guest`, hiển thị nút "Nâng cấp VIP" với hiệu ứng thu hút nhẹ.
- AC3: Modal nâng cấp (`UpgradeModal`) trình bày bảng so sánh minh bạch:
  - Bản Thường (0đ): Ghost text Heuristics, Quota AI tiêu chuẩn.
  - Bản VIP: AI Copilot sâu đa dòng (Qwen 0.19s), Quota AI không giới hạn, Ưu tiên CPU container MySQL.
- AC4: Ô nhập mã kích hoạt (Voucher/Promo code):
  - Kiểm tra tính hợp lệ và gọi `redeemVipCode`.
  - Hiển thị thông báo thành công chúc mừng người dùng nâng cấp VIP và tự động cập nhật lại trạng thái tài khoản không cần tải lại trang.
- AC5: Đầy đủ bản dịch đa ngôn ngữ cho `vi` và `en` trong `vip.json`.
- AC6: Unit test và Component test cho `UpgradeModal` và `VipBadge` đạt 100%.

Ca biên: Nhập mã kích hoạt sai định dạng; mã đã hết hạn; mạng lỗi khi đang nạp mã.
Kiểm tra: `npm run check` và `npx vitest run web/src/modules/vip/upgrade-modal.test.tsx`.
Góc review thêm: Trải nghiệm chuyển đổi nhẹ nhàng, không làm phiền người dùng.
Đọc thêm: `_bmad-output/SPEC_SMART_EDITOR.md` mục 3 (STR076) & `MUC_TIEU_TRUOC_MAT.md` mục 2.

