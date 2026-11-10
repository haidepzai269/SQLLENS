# Architecture Diagrams: 2-Layer Auth Shield

Tài liệu này mô tả kiến trúc lá chắn bảo vệ 2 tầng cho luồng xác thực của SQLLens.

## Sơ đồ luồng xử lý Request với 2 tầng lá chắn

```mermaid
flowchart TD
    ClientReq["Client Request mang Cookie 'sid'"] --> CheckBan{"Tầng 0: IP có trong Local Ban Cache?"}
    
    CheckBan -- Có (IP bị Ban) --> FastReject429["Trả mã 429 Too Many Requests ngay lập tức (0ms)<br/>Headers: Retry-After"]
    CheckBan -- Không --> CheckHMAC{"Tầng 1 (RAM): Cookie sid có đúng định dạng và HMAC hợp lệ?"}
    
    CheckHMAC -- Sai / Rác --> RecordAbuse1["Gọi Upstash Redis Lua Script:<br/>Tăng abuse counter cho IP"]
    RecordAbuse1 --> CheckLimit1{"Đạt ngưỡng vi phạm?"}
    CheckLimit1 -- Đạt ngưỡng --> SetBan1["Đánh dấu IP Banned trong Redis & Local Cache"]
    CheckLimit1 -- Chưa --> FastReject401["Trả mã 401 Unauthorized ngay tại RAM (<0.1ms)"]
    SetBan1 --> FastReject401
    
    CheckHMAC -- Đúng HMAC --> QueryDB{"Tầng 2 (Neon): Tìm token_hash trong Postgres"}
    
    QueryDB -- Không tìm thấy (Hết hạn / Bị thu hồi) --> RecordAbuse2["Ghi nhận vi phạm vào Redis Abuse Counter"]
    RecordAbuse2 --> Reject401["Trả mã 401 Unauthorized (Phiên không tồn tại)"]
    
    QueryDB -- Tìm thấy User hợp lệ --> CheckQuota{"Tầng 3 (Upstash): Kiểm tra User Rate Limit & Quota"}
    CheckQuota -- Vượt Quota --> Reject429User["Trả mã 429 Quota Exceeded"]
    CheckQuota -- Hợp lệ --> ExecuteHandler["Chuyển request vào API Handler"]
    
    subgraph RAM_Protection ["Tầng Bảo Vệ Cục Bộ (In-Memory Gin)"]
        CheckBan
        CheckHMAC
        FastReject429
        FastReject401
    end
    
    subgraph Distributed_Shield ["Tầng Lá Chắn Phân Tán (Upstash Redis)"]
        RecordAbuse1
        CheckLimit1
        SetBan1
        RecordAbuse2
        CheckQuota
    end
    
    subgraph Database_Core ["Lõi Cơ Sở Dữ Liệu (Neon Postgres - MaxConns=4)"]
        QueryDB
    end
```

## So sánh trước và sau khi áp dụng Lá chắn

| Tiêu chí | Trước khi có Lá chắn | Sau khi áp dụng Lá chắn (SPEC-auth-shield) |
| :--- | :--- | :--- |
| **Bắn `sid` rác ngẫu nhiên** | Chạm Neon Postgres cho **mọi request** -> Kiệt pool 4 conn -> Sập site (503). | Chặn đứng tại RAM của Gin bằng HMAC trong **< 0.1ms**, **0 query vào DB**. |
| **Spam `sid` rác dồn dập** | Không có cơ chế khóa IP, kẻ tấn công DoS tự do. | Redis Lua Script tự động cách ly IP vi phạm sau 10 lần sai; local cache chặn trong 0ms. |
| **Token bị thu hồi (Revoke)** | Vẫn tra DB kiểm tra bình thường. | Tra DB bình thường nhưng nếu bắn token cũ liên tục sẽ bị tính vào abuse counter. |
| **Tải trên Neon Postgres** | Rất nhạy cảm với bot quét lỗi / tấn công từ chối dịch vụ. | Database chỉ phục vụ request có chữ ký chuẩn mực, hoàn toàn an toàn. |
| **Tải trên Upstash Redis** | Chỉ dùng cho Quota sau khi đã tra DB. | Quản lý abuse counter và blacklist phân tán; có Local RAM Cache bảo vệ số lệnh Redis. |

