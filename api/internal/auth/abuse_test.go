package auth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
)

// mockUpstash mô phỏng Upstash Redis REST API xử lý Lua Script abuse_guard và lệnh TTL.
type mockUpstash struct {
	mu       sync.Mutex
	counters map[string]int
	bans     map[string]time.Time
	reqCount int
	fail     bool
}

func newMockUpstash() *mockUpstash {
	return &mockUpstash{
		counters: make(map[string]int),
		bans:     make(map[string]time.Time),
	}
}

func (m *mockUpstash) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.reqCount++

	if m.fail {
		http.Error(w, `{"error":"upstash internal error"}`, http.StatusInternalServerError)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"cannot read body"}`, http.StatusBadRequest)
		return
	}

	var cmd []any
	if err := json.Unmarshal(body, &cmd); err != nil || len(cmd) == 0 {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	cmdName, _ := cmd[0].(string)
	switch strings.ToUpper(cmdName) {
	case "EVAL":
		// cmd: ["EVAL", script, "2", k1, k2, limit, window, blockDuration]
		if len(cmd) < 8 {
			http.Error(w, `{"error":"eval wrong args"}`, http.StatusBadRequest)
			return
		}
		k1, _ := cmd[3].(string)
		k2, _ := cmd[4].(string)
		limitStr, _ := cmd[5].(string)
		limit, _ := strconv.Atoi(limitStr)
		blockStr, _ := cmd[7].(string)
		blockSec, _ := strconv.Atoi(blockStr)

		now := time.Now()
		// Kiểm tra banKey
		if exp, exists := m.bans[k2]; exists {
			if now.Before(exp) {
				ttl := int64(exp.Sub(now).Seconds())
				if ttl < 1 {
					ttl = 1
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"result": []int64{1, ttl}})
				return
			}
			delete(m.bans, k2)
		}

		// Tăng counter
		m.counters[k1]++
		cur := m.counters[k1]
		if cur > limit {
			exp := now.Add(time.Duration(blockSec) * time.Second)
			m.bans[k2] = exp
			delete(m.counters, k1)
			_ = json.NewEncoder(w).Encode(map[string]any{"result": []int64{1, int64(blockSec)}})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{"result": []int64{0, int64(cur), 60}})

	case "TTL":
		// cmd: ["TTL", banKey]
		if len(cmd) < 2 {
			http.Error(w, `{"error":"ttl wrong args"}`, http.StatusBadRequest)
			return
		}
		k2, _ := cmd[1].(string)
		now := time.Now()
		if exp, exists := m.bans[k2]; exists {
			if now.Before(exp) {
				ttl := int64(exp.Sub(now).Seconds())
				if ttl < 1 {
					ttl = 1
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"result": ttl})
				return
			}
			delete(m.bans, k2)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": -2})

	default:
		http.Error(w, `{"error":"unknown command"}`, http.StatusBadRequest)
	}
}

// TestAbuse_ClientIP kiểm tra việc trích xuất Client IP an toàn từ X-Forwarded-For và fallback.
func TestAbuse_ClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		xff        string
		remoteAddr string
		wantIP     string
	}{
		{
			name:       "Single IPv4 from XFF",
			xff:        "203.0.113.195",
			remoteAddr: "10.0.0.1:1234",
			wantIP:     "203.0.113.195",
		},
		{
			name:       "Multiple IPv4s from XFF takes first",
			xff:        "203.0.113.195, 70.41.3.18, 150.172.238.178",
			remoteAddr: "10.0.0.1:1234",
			wantIP:     "203.0.113.195",
		},
		{
			name:       "IPv4 with port in XFF",
			xff:        "203.0.113.195:8080",
			remoteAddr: "10.0.0.1:1234",
			wantIP:     "203.0.113.195",
		},
		{
			name:       "IPv6 in XFF",
			xff:        "2001:db8::1",
			remoteAddr: "10.0.0.1:1234",
			wantIP:     "2001:db8::1",
		},
		{
			name:       "No XFF falls back to ClientIP",
			xff:        "",
			remoteAddr: "198.51.100.22:54321",
			wantIP:     "198.51.100.22",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			req := httptest.NewRequest("GET", "/test", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			c.Request = req

			got := ClientIP(c)
			if got != tc.wantIP {
				t.Errorf("ClientIP() = %q, want %q", got, tc.wantIP)
			}
		})
	}
}

// TestAbuse_KeyHashing kiểm tra việc băm SHA-256 IP cho Redis keys chống injection.
func TestAbuse_KeyHashing(t *testing.T) {
	ip := "192.168.1.100"
	k1 := abuseKey(ip)
	k2 := banKey(ip)

	if !strings.HasPrefix(k1, "abuse:ip:") {
		t.Errorf("abuseKey prefix invalid: %q", k1)
	}
	if !strings.HasPrefix(k2, "ban:ip:") {
		t.Errorf("banKey prefix invalid: %q", k2)
	}

	// Phần hash SHA-256 sau tiền tố phải có độ dài đúng 64 ký tự hex
	hash1 := strings.TrimPrefix(k1, "abuse:ip:")
	if len(hash1) != 64 {
		t.Errorf("abuseKey hash length = %d, want 64", len(hash1))
	}
	hash2 := strings.TrimPrefix(k2, "ban:ip:")
	if len(hash2) != 64 {
		t.Errorf("banKey hash length = %d, want 64", len(hash2))
	}

	// Đảm bảo không có ký tự khoảng trắng hoặc ký tự đặc biệt
	if strings.ContainsAny(k1, " \r\n\t") || strings.ContainsAny(k2, " \r\n\t") {
		t.Errorf("keys contain invalid whitespace characters")
	}
}

// TestAbuseGate_AC1_to_AC5 kiểm tra toàn diện các tiêu chí từ AC1 đến AC5:
// - AC1: Lua script nguyên tử
// - AC2: Vi phạm 1..10 lần nhận mã 401
// - AC3: Vi phạm lần thứ 11 tự động Banned 15 phút, nhận mã 429 và Retry-After
// - AC4: Mọi request tiếp theo từ IP đang bị ban đều bị từ chối 429 trước khi vào handler
// - AC5: Sau 15 phút hết hạn ban, IP được phục hồi quyền truy cập bình thường
func TestAbuseGate_AC1_to_AC5(t *testing.T) {
	mock := newMockUpstash()
	srv := httptest.NewServer(mock)
	defer srv.Close()

	secret := "0123456789abcdef0123456789abcdef"
	gk := NewAbuseGatekeeper(srv.URL, "test-token", nil)
	if gk == nil {
		t.Fatal("NewAbuseGatekeeper returned nil")
	}

	r := httpapi.NewRouter()
	a := Mount(r, Deps{
		Config:     Config{PublicOrigin: "https://app.test", SessionSecret: secret},
		Gatekeeper: gk,
	})

	r.GET("/api/protected", a.requireUser, func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	testIP := "203.0.113.50"

	doRequestWithBadToken := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/protected", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		req.AddCookie(&http.Cookie{Name: "sid", Value: "invalid.hmac.signature.token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	// AC2: Vi phạm từ lần 1 đến 10 đều nhận 401 Unauthorized
	for i := 1; i <= 10; i++ {
		w := doRequestWithBadToken()
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("request #%d: expected 401 Unauthorized, got %d (body: %s)", i, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "auth_required") {
			t.Errorf("request #%d: body missing 'auth_required': %s", i, w.Body.String())
		}
	}

	// AC3: Ở lần vi phạm thứ 11, IP tự động Banned trong 15 phút (900s), nhận 429 Too Many Requests
	w11 := doRequestWithBadToken()
	if w11.Code != http.StatusTooManyRequests {
		t.Fatalf("request #11: expected 429 Too Many Requests, got %d (body: %s)", w11.Code, w11.Body.String())
	}
	retryAfter := w11.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Errorf("request #11: missing Retry-After header")
	} else {
		val, err := strconv.Atoi(retryAfter)
		if err != nil || val <= 0 || val > 900 {
			t.Errorf("request #11: invalid Retry-After value: %q (want <= 900)", retryAfter)
		}
	}
	if !strings.Contains(w11.Body.String(), "rate_limited") || !strings.Contains(w11.Body.String(), "error.rateLimited") {
		t.Errorf("request #11: unexpected body: %s", w11.Body.String())
	}

	// AC4: Mọi request tiếp theo từ IP đang bị ban đều bị chặn 429 ngay tại AbuseGate
	for j := 1; j <= 3; j++ {
		// Thử request bất kỳ (thậm chí không mang cookie)
		req := httptest.NewRequest("GET", "/api/protected", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("banned IP request #%d: expected 429 Too Many Requests, got %d", j, w.Code)
		}
		if w.Header().Get("Retry-After") == "" {
			t.Errorf("banned IP request #%d: missing Retry-After header", j)
		}
	}

	// AC5: Sau 15 phút, trạng thái ban tự động hết hạn, IP được phục hồi quyền truy cập bình thường
	mock.mu.Lock()
	// Giả lập thời gian trôi qua hơn 15 phút: xóa key ban
	for k := range mock.bans {
		delete(mock.bans, k)
	}
	mock.mu.Unlock()
	gk.ClearLocalCache()

	// Request sau khi hết hạn: không còn bị chặn 429
	reqAfter := httptest.NewRequest("GET", "/api/protected", nil)
	reqAfter.Header.Set("X-Forwarded-For", testIP)
	wAfter := httptest.NewRecorder()
	r.ServeHTTP(wAfter, reqAfter)

	// Vì không có cookie, nhận 401 auth_required chứ KHÔNG PHẢI 429
	if wAfter.Code != http.StatusUnauthorized {
		t.Fatalf("after ban expired: expected 401 Unauthorized, got %d", wAfter.Code)
	}
	if strings.Contains(wAfter.Body.String(), "rate_limited") {
		t.Errorf("after ban expired: request was still rate limited")
	}
}

// TestAbuse_StoreNotFound_Integration kiểm tra khi token đúng HMAC nhưng store trả về ErrNotFound:
// sau 10 lần thì lần thứ 11 sẽ bị ban 429.
func TestAbuse_StoreNotFound_Integration(t *testing.T) {
	mock := newMockUpstash()
	srv := httptest.NewServer(mock)
	defer srv.Close()

	gk := NewAbuseGatekeeper(srv.URL, "test-token", nil)
	ctx := context.Background()
	ip := "198.51.100.99"

	for i := 1; i <= 10; i++ {
		banned, ttl, err := gk.RecordAbuse(ctx, ip)
		if err != nil {
			t.Fatalf("call #%d failed: %v", i, err)
		}
		if banned {
			t.Fatalf("call #%d should not be banned yet", i)
		}
		if ttl != 0 {
			t.Errorf("call #%d expected ttl 0, got %d", i, ttl)
		}
	}

	// Lần 11
	banned, ttl, err := gk.RecordAbuse(ctx, ip)
	if err != nil {
		t.Fatalf("call #11 failed: %v", err)
	}
	if !banned {
		t.Fatalf("call #11 must be banned")
	}
	if ttl <= 0 || ttl > 900 {
		t.Errorf("call #11 invalid ttl: %d", ttl)
	}

	// CheckBan kiểm tra trạng thái ban
	isBanned, checkTTL, err := gk.CheckBan(ctx, ip)
	if err != nil {
		t.Fatalf("CheckBan failed: %v", err)
	}
	if !isBanned {
		t.Errorf("CheckBan should report banned=true")
	}
	if checkTTL <= 0 {
		t.Errorf("CheckBan ttl should be > 0, got %d", checkTTL)
	}
}

// TestAbuse_FailOpen_UpstashDown kiểm tra khi Upstash gặp sự cố hoặc timeout thì hệ thống fail open,
// không làm sập server và không chặn người dùng bình thường.
func TestAbuse_FailOpen_UpstashDown(t *testing.T) {
	mock := newMockUpstash()
	mock.fail = true // Upstash luôn trả về lỗi 500
	srv := httptest.NewServer(mock)
	defer srv.Close()

	gk := NewAbuseGatekeeper(srv.URL, "test-token", nil)
	r := httpapi.NewRouter()
	_ = Mount(r, Deps{
		Config:     Config{PublicOrigin: "https://app.test", SessionSecret: "0123456789abcdef0123456789abcdef"},
		Gatekeeper: gk,
	})

	r.GET("/api/test-route", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/api/test-route", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// AbuseGate fail open: request vẫn được chuyển tiếp tới handler
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK on Upstash failure (fail open), got %d", w.Code)
	}
	if w.Body.String() != "ok" {
		t.Errorf("expected body 'ok', got %q", w.Body.String())
	}
}

// TestAbuse_NilSafety kiểm tra an toàn tuyệt đối khi AbuseGatekeeper là nil hoặc unconfigured.
func TestAbuse_NilSafety(t *testing.T) {
	var gk *AbuseGatekeeper
	ctx := context.Background()

	banned, ttl, err := gk.RecordAbuse(ctx, "1.2.3.4")
	if banned || ttl != 0 || err != nil {
		t.Errorf("nil RecordAbuse unexpected: banned=%v, ttl=%d, err=%v", banned, ttl, err)
	}

	banned, ttl, err = gk.CheckBan(ctx, "1.2.3.4")
	if banned || ttl != 0 || err != nil {
		t.Errorf("nil CheckBan unexpected: banned=%v, ttl=%d, err=%v", banned, ttl, err)
	}

	mw := gk.AbuseGate()
	if mw == nil {
		t.Fatal("nil AbuseGate() returned nil handler")
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	mw(c)

	if c.IsAborted() {
		t.Errorf("nil AbuseGate aborted context")
	}

	// Test unconfigured (empty URL / token)
	unconf := NewAbuseGatekeeper("", "", nil)
	if unconf != nil {
		t.Errorf("NewAbuseGatekeeper with empty strings should return nil")
	}
}

// TestLocalBan_FastPathZeroUpstashCalls kiểm tra AC1:
// Khi một IP bị ban tiếp tục spam 1.000 request, 100% request bị chặn tại RAM (Tầng 0),
// số lượng HTTP request gọi sang Upstash REST tăng thêm = 0.
func TestLocalBan_FastPathZeroUpstashCalls(t *testing.T) {
	mock := newMockUpstash()
	srv := httptest.NewServer(mock)
	defer srv.Close()

	secret := "0123456789abcdef0123456789abcdef"
	gk := NewAbuseGatekeeper(srv.URL, "test-token", nil)
	if gk == nil {
		t.Fatal("NewAbuseGatekeeper returned nil")
	}
	defer gk.Close()

	r := httpapi.NewRouter()
	a := Mount(r, Deps{
		Config:     Config{PublicOrigin: "https://app.test", SessionSecret: secret},
		Gatekeeper: gk,
	})

	r.GET("/api/data", a.requireUser, func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	testIP := "198.51.100.77"

	// Vi phạm 11 lần để IP bị Banned
	for i := 1; i <= 11; i++ {
		req := httptest.NewRequest("GET", "/api/data", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		req.AddCookie(&http.Cookie{Name: "sid", Value: "invalid.signature.token"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
	}

	// Ghi nhận số request gọi sang Upstash REST tính đến thời điểm bị ban
	mock.mu.Lock()
	initialUpstashCalls := mock.reqCount
	mock.mu.Unlock()

	// Spam tiếp 1.000 request từ IP bị ban
	for i := 1; i <= 1000; i++ {
		req := httptest.NewRequest("GET", "/api/data", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("request #%d after ban: expected 429 Too Many Requests, got %d", i, w.Code)
		}
		if w.Header().Get("Retry-After") == "" {
			t.Errorf("request #%d after ban: missing Retry-After header", i)
		}
	}

	// Khẳng định số lượng HTTP request gọi sang Upstash REST tăng thêm = 0
	mock.mu.Lock()
	finalUpstashCalls := mock.reqCount
	mock.mu.Unlock()

	upstashCallsAdded := finalUpstashCalls - initialUpstashCalls
	if upstashCallsAdded != 0 {
		t.Fatalf("AC1 VIOLATION: Upstash REST calls increased by %d, expected 0", upstashCallsAdded)
	}
}

// TestGracefulSessionTransition kiểm tra AC2:
// Người dùng mang session cũ chưa ký (32 bytes raw token, 43 ký tự base64 url không có dấu chấm)
// được từ chối 401 êm dịu mà KHÔNG bị tính vào abuse counter.
func TestGracefulSessionTransition(t *testing.T) {
	mock := newMockUpstash()
	srv := httptest.NewServer(mock)
	defer srv.Close()

	secret := "0123456789abcdef0123456789abcdef"
	gk := NewAbuseGatekeeper(srv.URL, "test-token", nil)
	if gk == nil {
		t.Fatal("NewAbuseGatekeeper returned nil")
	}
	defer gk.Close()

	r := httpapi.NewRouter()
	a := Mount(r, Deps{
		Config:     Config{PublicOrigin: "https://app.test", SessionSecret: secret},
		Gatekeeper: gk,
	})

	r.GET("/api/transition", a.requireUser, func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	testIP := "203.0.113.123"

	// Giả lập token cũ: sinh 32 bytes raw token hợp lệ (43 ký tự base64 url)
	legacyToken := randToken(32)
	if len(legacyToken) != 43 || strings.Contains(legacyToken, ".") {
		t.Fatalf("legacyToken format unexpected: len=%d, val=%s", len(legacyToken), legacyToken)
	}

	// Gửi 15 request liên tục với legacy token
	for i := 1; i <= 15; i++ {
		req := httptest.NewRequest("GET", "/api/transition", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		req.AddCookie(&http.Cookie{Name: "sid", Value: legacyToken})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// Phải nhận 401 Unauthorized êm dịu, KHÔNG bao giờ bị 429
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("legacy request #%d: expected 401 Unauthorized, got %d", i, w.Code)
		}
		if !strings.Contains(w.Body.String(), "auth_required") {
			t.Errorf("legacy request #%d: body missing auth_required: %s", i, w.Body.String())
		}
	}

	// Khẳng định Abuse counter trong Upstash không hề tăng đối với IP này
	mock.mu.Lock()
	count := mock.counters[abuseKey(testIP)]
	mock.mu.Unlock()
	if count != 0 {
		t.Fatalf("AC2 VIOLATION: abuse counter for legacy session user is %d, expected 0", count)
	}

	// Ngược lại: nếu là token rác (không phải legacy token) thì sau 11 lần PHẢI bị ban
	for i := 1; i <= 10; i++ {
		req := httptest.NewRequest("GET", "/api/transition", nil)
		req.Header.Set("X-Forwarded-For", testIP)
		req.AddCookie(&http.Cookie{Name: "sid", Value: "junk-token-invalid"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("junk request #%d: expected 401, got %d", i, w.Code)
		}
	}

	// Lần thứ 11 với token rác -> Phải bị ban 429
	req11 := httptest.NewRequest("GET", "/api/transition", nil)
	req11.Header.Set("X-Forwarded-For", testIP)
	req11.AddCookie(&http.Cookie{Name: "sid", Value: "junk-token-invalid"})
	w11 := httptest.NewRecorder()
	r.ServeHTTP(w11, req11)
	if w11.Code != http.StatusTooManyRequests {
		t.Fatalf("junk request #11: expected 429 Too Many Requests, got %d", w11.Code)
	}
}
