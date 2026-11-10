package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
)

const (
	defaultLimit         = 10
	defaultWindow        = 60 * time.Second
	defaultBlockDuration = 900 * time.Second // 15 phút
	callTimeout          = 2 * time.Second
)

// Lua script chạy nguyên tử trên Upstash Redis:
// KEYS[1]: abuse key (đếm vi phạm của IP: abuse:ip:<hash>)
// KEYS[2]: ban key (trạng thái ban của IP: ban:ip:<hash>)
// ARGV[1]: limit (ngưỡng vi phạm, mặc định 10)
// ARGV[2]: window tính bằng giây (cửa sổ theo dõi, mặc định 60)
// ARGV[3]: block_duration tính bằng giây (thời gian cấm, mặc định 900)
const abuseScript = `local is_banned = redis.call('EXISTS', KEYS[2])
if is_banned == 1 then
    local ttl = redis.call('TTL', KEYS[2])
    return {1, ttl}
end
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if current > tonumber(ARGV[1]) then
    redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[3]))
    redis.call('DEL', KEYS[1])
    return {1, tonumber(ARGV[3])}
end
local ttl = redis.call('TTL', KEYS[1])
return {0, current, ttl}`

// AbuseGatekeeper quản lý việc phát hiện và cách ly IP lạm dụng qua Upstash Redis.
type AbuseGatekeeper struct {
	url           string
	token         string
	hc            *http.Client
	limit         int
	window        time.Duration
	blockDuration time.Duration
}

// NewAbuseGatekeeper khởi tạo AbuseGatekeeper. Nếu restURL hoặc restToken rỗng thì trả về nil.
func NewAbuseGatekeeper(restURL, restToken string, httpClient *http.Client) *AbuseGatekeeper {
	if restURL == "" || restToken == "" {
		return nil
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: callTimeout}
	}
	return &AbuseGatekeeper{
		url:           strings.TrimRight(restURL, "/"),
		token:         restToken,
		hc:            httpClient,
		limit:         defaultLimit,
		window:        defaultWindow,
		blockDuration: defaultBlockDuration,
	}
}

// WithConfig cho phép tùy biến ngưỡng (dùng cho test hoặc cấu hình đặc biệt).
func (g *AbuseGatekeeper) WithConfig(limit int, window, blockDuration time.Duration) *AbuseGatekeeper {
	if g == nil {
		return nil
	}
	if limit > 0 {
		g.limit = limit
	}
	if window > 0 {
		g.window = window
	}
	if blockDuration > 0 {
		g.blockDuration = blockDuration
	}
	return g
}

// ipHash băm SHA-256 IP để tránh Redis key injection và ký tự bất thường.
func ipHash(ip string) string {
	h := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(h[:])
}

func abuseKey(ip string) string {
	return "abuse:ip:" + ipHash(ip)
}

func banKey(ip string) string {
	return "ban:ip:" + ipHash(ip)
}

// ClientIP trích xuất Client IP an toàn từ X-Forwarded-For (lấy IP đầu tiên),
// fallback về c.ClientIP().
func ClientIP(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return "127.0.0.1"
	}
	xff := c.GetHeader("X-Forwarded-For")
	if xff != "" {
		parts := strings.Split(xff, ",")
		first := strings.TrimSpace(parts[0])
		if host, _, err := net.SplitHostPort(first); err == nil {
			first = host
		}
		if ip := net.ParseIP(first); ip != nil {
			return ip.String()
		}
	}
	cip := c.ClientIP()
	if host, _, err := net.SplitHostPort(cip); err == nil {
		cip = host
	}
	if ip := net.ParseIP(cip); ip != nil {
		return ip.String()
	}
	if cip != "" {
		return cip
	}
	return "127.0.0.1"
}

// RecordAbuse ghi nhận một lần vi phạm của Client IP qua Lua script nguyên tử.
// Trả về banned=true cùng ttlSeconds nếu IP đang hoặc vừa bị đưa vào danh sách Ban.
func (g *AbuseGatekeeper) RecordAbuse(ctx context.Context, clientIP string) (banned bool, ttlSeconds int64, err error) {
	if g == nil || g.url == "" || g.token == "" {
		return false, 0, nil
	}
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	k1 := abuseKey(clientIP)
	k2 := banKey(clientIP)
	body, err := json.Marshal([]any{
		"EVAL",
		abuseScript,
		"2",
		k1,
		k2,
		strconv.Itoa(g.limit),
		strconv.FormatInt(int64(g.window.Seconds()), 10),
		strconv.FormatInt(int64(g.blockDuration.Seconds()), 10),
	})
	if err != nil {
		return false, 0, errors.New("bad request marshal")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.url, bytes.NewReader(body))
	if err != nil {
		return false, 0, errors.New("bad request")
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.hc.Do(req)
	if err != nil {
		log.Printf("abuse: upstash unreachable: %v", err)
		return false, 0, errors.New("upstash unreachable")
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("abuse: upstash status %d", resp.StatusCode)
		return false, 0, fmt.Errorf("upstash status %d", resp.StatusCode)
	}

	var out struct {
		Result []int64 `json:"result"`
		Error  string  `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.Error != "" || len(out.Result) < 2 {
		log.Printf("abuse: upstash bad reply: %s", string(raw))
		return false, 0, errors.New("upstash bad reply")
	}

	if out.Result[0] == 1 {
		ttl := out.Result[1]
		if ttl <= 0 {
			ttl = int64(g.blockDuration.Seconds())
		}
		return true, ttl, nil
	}

	return false, 0, nil
}

// CheckBan kiểm tra IP có đang bị tạm khóa (Ban) hay không qua TTL của ban key.
// Trả về banned=true cùng thời gian còn lại (giây).
func (g *AbuseGatekeeper) CheckBan(ctx context.Context, clientIP string) (banned bool, ttlSeconds int64, err error) {
	if g == nil || g.url == "" || g.token == "" {
		return false, 0, nil
	}
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	body, err := json.Marshal([]any{"TTL", banKey(clientIP)})
	if err != nil {
		return false, 0, errors.New("bad request marshal")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.url, bytes.NewReader(body))
	if err != nil {
		return false, 0, errors.New("bad request")
	}
	req.Header.Set("Authorization", "Bearer "+g.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.hc.Do(req)
	if err != nil {
		log.Printf("abuse: upstash unreachable: %v", err)
		return false, 0, errors.New("upstash unreachable")
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil || resp.StatusCode != http.StatusOK {
		log.Printf("abuse: upstash status %d", resp.StatusCode)
		return false, 0, fmt.Errorf("upstash status %d", resp.StatusCode)
	}

	var out struct {
		Result int64  `json:"result"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.Error != "" {
		log.Printf("abuse: upstash bad reply: %s", string(raw))
		return false, 0, errors.New("upstash bad reply")
	}

	if out.Result > 0 {
		return true, out.Result, nil
	}
	if out.Result == -1 {
		return true, int64(g.blockDuration.Seconds()), nil
	}
	return false, 0, nil
}

// AbuseGate trả về Gin middleware chặn đứng request từ Client IP đang bị ban bằng mã 429.
func (g *AbuseGatekeeper) AbuseGate() gin.HandlerFunc {
	if g == nil {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		ip := ClientIP(c)
		banned, ttl, err := g.CheckBan(c.Request.Context(), ip)
		if err != nil {
			// Fail open: log lỗi an toàn, không làm gián đoạn người dùng bình thường khi Upstash gặp sự cố
			c.Next()
			return
		}
		if banned {
			if ttl < 1 {
				ttl = 1
			}
			c.Header("Retry-After", strconv.FormatInt(ttl, 10))
			httpapi.Abort(c, http.StatusTooManyRequests, "rate_limited", "error.rateLimited")
			return
		}
		c.Next()
	}
}
