-- Migration 002: Thêm phân quyền RBAC và bảng quản lý VIP code

-- 1. Thêm cột role và vip_until vào bảng users
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_until timestamptz NULL;

-- Đảm bảo ràng buộc kiểm tra role hợp lệ
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('guest', 'user', 'vip', 'admin'));

-- 2. Bảng lưu trữ mã VIP kích hoạt
CREATE TABLE IF NOT EXISTS vip_codes (
    code text PRIMARY KEY,
    duration_days integer NOT NULL CHECK (duration_days > 0),
    max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Bảng ghi nhận lịch sử kích hoạt VIP của từng người dùng (chống dùng lặp lại)
CREATE TABLE IF NOT EXISTS user_vip_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code text NOT NULL REFERENCES vip_codes (code) ON DELETE CASCADE,
    redeemed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, code)
);

CREATE INDEX IF NOT EXISTS user_vip_redemptions_user_id_idx ON user_vip_redemptions (user_id);

-- 4. Khởi tạo sẵn một số mã kích hoạt mẫu
INSERT INTO vip_codes (code, duration_days, max_uses) VALUES
    ('VIP-SQLLENS-1M', 30, 1000),
    ('VIP-DEV-3M', 90, 100),
    ('VIP-FOREVER', 3650, 10)
ON CONFLICT (code) DO NOTHING;
