# Hướng dẫn mở cổng sandbox cho Render (Task074)

Mục tiêu: để Gin trên Render gọi được agent trên máy Azure qua HTTPS. Trạng thái hiện tại: agent đã chạy sẵn cổng HTTPS 8443 trên máy Azure, nhưng từ ngoài chưa tới được vì NSG chưa mở (và `ufw` đang bật). Không có giá trị thật nào được ghi trong file này; chỗ cần điền ghi bằng `<...>`.

Điều kiện đã có trên máy Azure: agent bản mới đang chạy bằng service `sqllens-agent`, token mới 32 byte ngẫu nhiên ở `/etc/sqllens-agent/token`, chứng chỉ tự ký ở `/etc/sqllens-agent/tls.crt`, `AGENT_TLS_ADDR=0.0.0.0:8443` trong `/etc/sqllens-agent/env`.

## 1. Đọc vân tay chứng chỉ và token (qua SSH)

Dùng đúng cách bạn vẫn SSH vào máy Azure.

```bash
# Vân tay chứng chỉ, không phải bí mật
ssh <user>@<IP máy Azure> 'sudo /opt/sqllens/sqllens-agent fingerprint'

# Token, là bí mật: chỉ in ra terminal của bạn, dán thẳng vào Render, không gửi qua chat hay ghi vào file
ssh <user>@<IP máy Azure> 'sudo cat /etc/sqllens-agent/token'
```

Vân tay là 64 ký tự hex. Token là 64 ký tự hex.

## 2. Lấy dải IP ra ngoài của Render

Render Dashboard, mở service `sqllens-api`, menu **Connect**, tab **Outbound**: có danh sách dải CIDR của region Singapore. Tài liệu: mục "Outbound IP addresses" trên docs của Render. Dải này dùng chung cho nhiều khách hàng Render nên token mới là lớp bảo vệ chính; NSG chỉ để giảm nhiễu.

## 3. Mở cổng 8443 trên NSG (Azure Portal)

1. Máy ảo, **Networking**, **Add inbound port rule**.
2. Source: **IP Addresses**, điền các dải CIDR ở bước 2 (nhiều dải thì tách bằng dấu phẩy). Không chọn Any.
3. Destination port ranges: `8443`. Protocol: TCP. Action: Allow. Đặt tên, ví dụ `render-sandbox-8443`. Priority tùy bạn, thấp hơn các rule Deny.

Cổng `8081` (loopback) không bao giờ mở.

## 4. Cho phép cổng trong `ufw` trên máy Azure

Máy đang bật `ufw`, nên NSG mở rồi mà `ufw` chưa cho phép thì vẫn không vào được. Với mỗi dải CIDR:

```bash
ssh <user>@<IP máy Azure> 'sudo ufw allow from <CIDR của Render> to any port 8443 proto tcp'
ssh <user>@<IP máy Azure> 'sudo ufw status numbered'
```

(Agent chạy thẳng trên máy, không qua Docker, nên `ufw` có tác dụng với cổng này.)

## 5. Đặt biến trên Render

Service `sqllens-api`, **Environment**, thêm 3 biến (đã khai báo `sync: false` trong `render.yaml`):

| Biến | Giá trị |
|---|---|
| `SANDBOX_URL` | `https://<IP máy Azure>:8443` (không có đường dẫn phía sau) |
| `SANDBOX_TOKEN` | token ở bước 1 |
| `SANDBOX_CERT_SHA256` | vân tay ở bước 1 |

Lưu rồi để Render deploy lại. Thiếu một biến, hoặc token ngắn hơn 32 ký tự, hoặc URL không phải `https://`, thì route MySQL trả 503 `not_configured` và phần còn lại vẫn chạy.

## 6. Kiểm

1. Trước khi mở NSG: `curl -k --max-time 8 https://<IP máy Azure>:8443/healthz` phải treo rồi hết giờ (curl exit 28). Sau khi mở NSG và `ufw`, lệnh này từ máy cá nhân của bạn vẫn phải treo vì IP của bạn không nằm trong dải Render.
2. Đăng nhập vào web bằng Google hoặc GitHub. Mở console của trình duyệt trên trang web:
   ```js
   fetch('/api/mysql/sessions', {method: 'POST'}).then(r => r.status)
   ```
   Kỳ vọng 201 sau vài giây. Gọi lần hai ngay lập tức phải ra 429 (`user_session_limit`, mỗi người 1 phiên).
3. Dọn: `fetch('/api/mysql/sessions/<id>', {method: 'DELETE'})` với `<id>` trong thân của lần 1, kỳ vọng 204.
4. Log của Render và `sudo journalctl -u sqllens-agent` chỉ được có dòng sự kiện (route, mã trả về), không có SQL, token hay user id.

## 7. Đóng lại khi có sự cố

Làm theo thứ tự, dừng ở bước đủ:

1. **Chặn ngay:** Azure Portal, xóa rule `render-sandbox-8443` (hoặc đổi sang Deny). Và `sudo ufw delete <số rule>` (xem số bằng `sudo ufw status numbered`).
2. **Tắt cổng HTTPS của agent:** `sudo sh -c 'rm /etc/sqllens-agent/env && systemctl restart sqllens-agent'`. Cổng 8443 biến mất, loopback 8081 vẫn chạy.
3. **Nghi lộ token:** sinh token mới, không in ra, rồi cập nhật `SANDBOX_TOKEN` trên Render.
   ```bash
   sudo sh -c 'umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" > /etc/sqllens-agent/token.new && mv /etc/sqllens-agent/token.new /etc/sqllens-agent/token; systemctl restart sqllens-agent'
   ```
4. **Nghi lộ khóa chứng chỉ hoặc chứng chỉ sắp hết hạn (hạn 3 năm):** `sudo /opt/sqllens/sqllens-agent cert -rotate`, `sudo systemctl restart sqllens-agent`, đọc vân tay mới (bước 1), cập nhật `SANDBOX_CERT_SHA256`.
5. **Quay về bản agent cũ:** `sudo sh -c 'cp -p /opt/sqllens/sqllens-agent.prev /opt/sqllens/sqllens-agent && systemctl restart sqllens-agent'`. Bản cũ chỉ nghe loopback và không đòi header user.
6. Trên Render có thể xóa 3 biến `SANDBOX_*` để MySQL trả 503 mà không đụng gì khác.
