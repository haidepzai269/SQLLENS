# Redis Lua Scripts: Abuse Gatekeeper & IP Quarantine

Tài liệu này định nghĩa cấu trúc và mã nguồn của Lua Script chạy nguyên tử trên Upstash Redis để quản lý việc giám sát và khóa IP có hành vi lạm dụng hoặc tấn công `sid` rác.

## 1. Mục tiêu kỹ thuật

- **Nguyên tử tuyệt đối (Atomic):** Một lệnh duy nhất kiểm tra counter, tăng counter, gán TTL nếu cần, và nếu vượt ngưỡng vi phạm thì kích hoạt khóa IP (`ban`) cùng thời hạn hết hạn.
- **Không lệch đồng hồ (No Clock Skew):** TTL tính hoàn toàn phía server Redis (`EXPIRE` / `PEXPIRE`).
- **Tối ưu chi phí Upstash:** Không phát sinh nhiều round-trip HTTP REST call giữa Gin và Upstash.

## 2. Lua Script Nguyên Tử: `abuse_guard.lua`

```lua
-- KEYS[1]: Khóa đếm vi phạm của IP, ví dụ "abuse:ip:" .. client_ip
-- KEYS[2]: Khóa trạng thái Ban của IP, ví dụ "ban:ip:" .. client_ip
-- ARGV[1]: Ngưỡng vi phạm cho phép trong cửa sổ (ví dụ: 10 lần)
-- ARGV[2]: Cửa sổ thời gian theo dõi tính bằng giây (ví dụ: 60 giây)
-- ARGV[3]: Thời gian cấm (Ban duration) tính bằng giây (ví dụ: 900 giây = 15 phút)

-- Kiểm tra xem IP có đang trong thời gian bị Ban hay không
local is_banned = redis.call('EXISTS', KEYS[2])
if is_banned == 1 then
    local ttl = redis.call('TTL', KEYS[2])
    return {1, ttl} -- 1 nghĩa là ĐANG BỊ BAN, ttl là số giây còn lại
end

-- Tăng bộ đếm vi phạm
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end

-- Nếu vượt quá ngưỡng vi phạm -> Kích hoạt lệnh Ban
if current > tonumber(ARGV[1]) then
    redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[3]))
    redis.call('DEL', KEYS[1]) -- Reset bộ đếm sau khi đã ban
    return {1, tonumber(ARGV[3])} -- Vừa bị đưa vào danh sách BAN
end

-- Chưa đạt ngưỡng vi phạm: Trả về trạng thái an toàn
local ttl = redis.call('TTL', KEYS[1])
return {0, current, ttl} -- 0 nghĩa là KHÔNG BỊ BAN, current là số lần vi phạm hiện tại
```

## 3. Định dạng Token có chữ ký (Signed Session Token Format)

Token cookie `sid` mới được định dạng theo cấu trúc:

$$\text{sid} = \text{raw\_token} + \text{"."} + \text{hmac\_signature}$$

Trong đó:
- `raw_token`: 32 bytes ngẫu nhiên từ `crypto/rand`, mã hóa `base64.RawURLEncoding` (độ dài 43 ký tự).
- `hmac_signature`: `HMAC-SHA256(raw_token, SESSION_SECRET)`, mã hóa `base64.RawURLEncoding` (độ dài 43 ký tự).
- Tổng độ dài chuỗi cookie `sid`: $43 + 1 + 43 = 87$ ký tự.

### Quy trình xác thực nhanh trong RAM của Gin:
1. Đọc cookie `sid`.
2. Kiểm tra `strings.Split(sid, ".")`: bắt buộc phải có đúng 2 phần, độ dài mỗi phần đúng 43 ký tự.
3. Tính toán lại HMAC cho phần 1 bằng `SESSION_SECRET`.
4. So sánh với phần 2 bằng `crypto/subtle.ConstantTimeCompare`.
5. Nếu không khớp: Ghi nhận vi phạm vào Redis abuse guard và trả về `401 Unauthorized`.
6. Nếu khớp: Lấy `raw_token` băm `SHA-256` để truy vấn Neon Postgres (bảo toàn tính toàn vẹn 100% của bảng `sessions` hiện tại).

