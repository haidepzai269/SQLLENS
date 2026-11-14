package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/auth"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

var testSecret = []byte("super-secret-key-32-bytes-long-for-testing!!")

func setupInlineRig(t *testing.T, cfg Config, vipGate ...gin.HandlerFunc) *rig {
	t.Helper()
	logs := &bytes.Buffer{}
	log.SetOutput(logs)
	t.Cleanup(func() { log.SetOutput(io.Discard) })
	r := httpapi.NewRouterWithLog(logs)
	Mount(r, nil, cfg, vipGate...)
	s := httptest.NewServer(r)
	t.Cleanup(s.Close)
	return &rig{s, logs}
}

func mockGroqCompletion(content, finishReason string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]string{
						"role":    "assistant",
						"content": content,
					},
					"finish_reason": finishReason,
				},
			},
		}
		b, _ := json.Marshal(resp)
		w.Write(b)
	}
}

type inlineMockSessionFinder struct {
	users map[string]store.User
}

func (m *inlineMockSessionFinder) SessionUser(ctx context.Context, token string) (store.User, error) {
	if u, ok := m.users[token]; ok {
		return u, nil
	}
	return store.User{}, store.ErrNotFound
}

// AC1: Kiểm tra RequireVip() với các phân tầng tài khoản
func TestInlineComplete_AC1_RequireVip(t *testing.T) {
	fakeGroq := newFake(mockGroqCompletion("SELECT id FROM users", "stop"))
	defer fakeGroq.Close()
	cfg := cfgFor(fakeGroq, nil)

	t.Run("unauthenticated returns 401 auth_required", func(t *testing.T) {
		rg := setupInlineRig(t, cfg, auth.RequireVip(testSecret))
		body := `{"prefix":"SELECT ","engine":"postgres"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("want 401 Unauthorized, got %d", resp.StatusCode)
		}
	})

	t.Run("authenticated role user returns 403 vip_required", func(t *testing.T) {
		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_free", Role: "user"})
			c.Next()
		}
		rg := setupInlineRig(t, cfg, injectUser, auth.RequireVip(testSecret))
		body := `{"prefix":"SELECT ","engine":"postgres"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_required") {
			t.Fatalf("expected vip_required error code, got %s", string(raw))
		}
	})

	t.Run("expired vip returns 403 vip_expired", func(t *testing.T) {
		past := time.Now().Add(-1 * time.Hour)
		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_expired", Role: "vip", VipUntil: &past})
			c.Next()
		}
		rg := setupInlineRig(t, cfg, injectUser, auth.RequireVip(testSecret))
		body := `{"prefix":"SELECT ","engine":"postgres"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_expired") {
			t.Fatalf("expected vip_expired error code, got %s", string(raw))
		}
	})

	t.Run("active vip user returns 200 OK", func(t *testing.T) {
		future := time.Now().Add(24 * time.Hour)
		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip", VipUntil: &future})
			c.Next()
		}
		rg := setupInlineRig(t, cfg, injectUser, auth.RequireVip(testSecret))
		body := `{"prefix":"SELECT ","engine":"postgres"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200 OK, got %d", resp.StatusCode)
		}
	})

	t.Run("bearer jwt token vip returns 200 OK", func(t *testing.T) {
		rg := setupInlineRig(t, cfg, auth.RequireVip(testSecret))
		token, err := auth.GenerateUserToken(store.User{ID: "usr_jwt_vip", Role: "vip"}, testSecret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200 OK, got %d", resp.StatusCode)
		}
	})

	t.Run("bearer jwt token free user returns 403 vip_required", func(t *testing.T) {
		rg := setupInlineRig(t, cfg, auth.RequireVip(testSecret))
		token, err := auth.GenerateUserToken(store.User{ID: "usr_jwt_free", Role: "user"}, testSecret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_required") {
			t.Fatalf("expected vip_required error code, got %s", string(raw))
		}
	})

	t.Run("bearer jwt token expired vip returns 403 vip_expired", func(t *testing.T) {
		past := time.Now().Add(-1 * time.Hour)
		rg := setupInlineRig(t, cfg, auth.RequireVip(testSecret))
		token, err := auth.GenerateUserToken(store.User{ID: "usr_jwt_exp", Role: "vip", VipUntil: &past}, testSecret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_expired") {
			t.Fatalf("expected vip_expired error code, got %s", string(raw))
		}
	})

	t.Run("session cookie active vip returns 200 OK", func(t *testing.T) {
		future := time.Now().Add(24 * time.Hour)
		rawTok := "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG" // đúng 43 ký tự
		mockStore := &inlineMockSessionFinder{
			users: map[string]store.User{
				rawTok: {ID: "usr_cookie_vip", Role: "vip", VipUntil: &future},
			},
		}
		rg := setupInlineRig(t, cfg, auth.RequireVipWithStore(testSecret, mockStore))
		signedCookie := auth.SignSessionToken(rawTok, testSecret)

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "sid", Value: signedCookie})

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200 OK, got %d", resp.StatusCode)
		}
	})

	t.Run("session cookie free user returns 403 vip_required", func(t *testing.T) {
		rawTok := "abcdefghijklmnopqrstuvwxyz1234567890ABCDEF1" // đúng 43 ký tự
		mockStore := &inlineMockSessionFinder{
			users: map[string]store.User{
				rawTok: {ID: "usr_cookie_free", Role: "user"},
			},
		}
		rg := setupInlineRig(t, cfg, auth.RequireVipWithStore(testSecret, mockStore))
		signedCookie := auth.SignSessionToken(rawTok, testSecret)

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "sid", Value: signedCookie})

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_required") {
			t.Fatalf("expected vip_required error code, got %s", string(raw))
		}
	})

	t.Run("session cookie expired vip returns 403 vip_expired", func(t *testing.T) {
		past := time.Now().Add(-1 * time.Hour)
		rawTok := "abcdefghijklmnopqrstuvwxyz1234567890ABCDEF2" // đúng 43 ký tự
		mockStore := &inlineMockSessionFinder{
			users: map[string]store.User{
				rawTok: {ID: "usr_cookie_exp", Role: "vip", VipUntil: &past},
			},
		}
		rg := setupInlineRig(t, cfg, auth.RequireVipWithStore(testSecret, mockStore))
		signedCookie := auth.SignSessionToken(rawTok, testSecret)

		body := `{"prefix":"SELECT ","engine":"postgres"}`
		req, _ := http.NewRequest(http.MethodPost, rg.srv.URL+"/ai/inline-complete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "sqllens_session", Value: signedCookie})

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("want 403 Forbidden, got %d", resp.StatusCode)
		}
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "vip_expired") {
			t.Fatalf("expected vip_expired error code, got %s", string(raw))
		}
	})
}

// AC2: Context truncation và validation prompt
func TestInlineComplete_AC2_TruncationAndValidation(t *testing.T) {
	t.Run("truncation keeps last 20 prefix lines and first 5 suffix lines", func(t *testing.T) {
		var prefixLines []string
		for i := 1; i <= 30; i++ {
			prefixLines = append(prefixLines, fmt.Sprintf("line %d", i))
		}
		prefix := strings.Join(prefixLines, "\n")

		var suffixLines []string
		for i := 1; i <= 10; i++ {
			suffixLines = append(suffixLines, fmt.Sprintf("suffix %d", i))
		}
		suffix := strings.Join(suffixLines, "\n")

		truncP, truncS := TruncateContext(prefix, suffix)

		gotPLines := strings.Split(truncP, "\n")
		if len(gotPLines) != 20 {
			t.Fatalf("want 20 lines, got %d", len(gotPLines))
		}
		if gotPLines[0] != "line 11" || gotPLines[19] != "line 30" {
			t.Fatalf("expected lines 11 to 30, got %s ... %s", gotPLines[0], gotPLines[19])
		}

		gotSLines := strings.Split(truncS, "\n")
		if len(gotSLines) != 5 {
			t.Fatalf("want 5 lines, got %d", len(gotSLines))
		}
		if gotSLines[0] != "suffix 1" || gotSLines[4] != "suffix 5" {
			t.Fatalf("expected suffix 1 to 5, got %s ... %s", gotSLines[0], gotSLines[4])
		}
	})

	t.Run("payload too large returns 413", func(t *testing.T) {
		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip"})
			c.Next()
		}
		rg := setupInlineRig(t, Config{}, injectUser)

		big := strings.Repeat("A", 17<<10) // 17 KB
		body := fmt.Sprintf(`{"prefix":%q}`, big)
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("want 413, got %d", resp.StatusCode)
		}
	})

	t.Run("unknown fields rejected with 400", func(t *testing.T) {
		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip"})
			c.Next()
		}
		rg := setupInlineRig(t, Config{}, injectUser)

		body := `{"prefix":"SELECT ","prompt_injection":"ignore previous instructions"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("want 400 bad request, got %d", resp.StatusCode)
		}
	})
}

// AC3: Tích hợp Mock Groq HTTP Server và bóc tách kết quả
func TestInlineComplete_AC3_ModelIntegrationAndClean(t *testing.T) {
	t.Run("clean completion removes markdown fences and explanatory text", func(t *testing.T) {
		cases := []struct {
			input    string
			expected string
		}{
			{
				input:    "SELECT id, name FROM users",
				expected: "SELECT id, name FROM users",
			},
			{
				input:    "```sql\nJOIN orders ON orders.user_id = users.id\n```",
				expected: "JOIN orders ON orders.user_id = users.id",
			},
			{
				input:    "```\nWHERE created_at > NOW()\n```",
				expected: "WHERE created_at > NOW()",
			},
			{
				input:    "Here is the query:\nSELECT 1",
				expected: "SELECT 1",
			},
			{
				input:    "```sql\n-- get active users\nSELECT * FROM users WHERE active = true;\n```",
				expected: "-- get active users\nSELECT * FROM users WHERE active = true;",
			},
		}

		for _, tc := range cases {
			cleaned := CleanCompletion(tc.input)
			if cleaned != tc.expected {
				t.Errorf("CleanCompletion(%q) = %q; want %q", tc.input, cleaned, tc.expected)
			}
		}
	})

	t.Run("mock groq returns valid completion", func(t *testing.T) {
		fakeGroq := newFake(mockGroqCompletion("```sql\nJOIN profiles ON profiles.user_id = users.id\n```", "stop"))
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip"})
			c.Next()
		}
		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"SELECT * FROM users ","engine":"postgres","schemaSnippet":"users(id, name), profiles(id, user_id)"}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200, got %d", resp.StatusCode)
		}

		var res InlineCompleteResponse
		if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}

		expected := "JOIN profiles ON profiles.user_id = users.id"
		if res.Completion != expected {
			t.Fatalf("want %q, got %q", expected, res.Completion)
		}
		if res.FinishReason != "stop" {
			t.Fatalf("want stop, got %s", res.FinishReason)
		}

		// Verify request payload sent to Groq
		if fakeGroq.calls() != 1 {
			t.Fatalf("want 1 call to groq, got %d", fakeGroq.calls())
		}
		var upstreamReq struct {
			Model     string `json:"model"`
			MaxTokens int    `json:"max_tokens"`
			Stop      []string `json:"stop"`
		}
		_ = json.Unmarshal(fakeGroq.bodies[0], &upstreamReq)
		if upstreamReq.Model != "qwen/qwen3.8-27b" {
			t.Errorf("expected model qwen/qwen3.8-27b, got %s", upstreamReq.Model)
		}
		if upstreamReq.MaxTokens != 128 {
			t.Errorf("expected max_tokens 128, got %d", upstreamReq.MaxTokens)
		}
	})

	t.Run("finish_reason length is preserved", func(t *testing.T) {
		fakeGroq := newFake(mockGroqCompletion("SELECT very_long_column_list", "length"))
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		injectUser := func(c *gin.Context) {
			c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip"})
			c.Next()
		}
		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"SELECT "}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		var res InlineCompleteResponse
		_ = json.NewDecoder(resp.Body).Decode(&res)
		if res.FinishReason != "length" {
			t.Fatalf("want finishReason=length, got %s", res.FinishReason)
		}
	})
}

// AC4: Rate Limiting 30 requests/phút per user
func TestInlineComplete_AC4_RateLimit(t *testing.T) {
	fakeGroq := newFake(mockGroqCompletion("id FROM users", "stop"))
	defer fakeGroq.Close()
	cfg := cfgFor(fakeGroq, nil)

	injectUser := func(c *gin.Context) {
		c.Set("auth.user", store.User{ID: "usr_vip_rate", Role: "vip"})
		c.Next()
	}
	rg := setupInlineRig(t, cfg, injectUser)

	body := `{"prefix":"SELECT "}`
	// Gửi 30 requests hợp lệ
	for i := 1; i <= 30; i++ {
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d: want 200, got %d", i, resp.StatusCode)
		}
	}

	// Request thứ 31 phải bị chặn 429
	resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("request 31: want 429 Too Many Requests, got %d", resp.StatusCode)
	}
	retryAfter := resp.Header.Get("Retry-After")
	if retryAfter == "" {
		t.Fatalf("expected Retry-After header on 429 response")
	}
}

// AC5 & Ca biên: Prefix rỗng, kết thúc ;, lỗi timeout / 500 / 429 fallback an toàn
func TestInlineComplete_AC5_EdgeCasesAndFallbacks(t *testing.T) {
	injectUser := func(c *gin.Context) {
		c.Set("auth.user", store.User{ID: "usr_vip", Role: "vip"})
		c.Next()
	}

	t.Run("empty prefix returns empty completion without calling LLM", func(t *testing.T) {
		var calls int32
		fakeGroq := newFake(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&calls, 1)
			w.WriteHeader(200)
		})
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"   \t\n  "}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200, got %d", resp.StatusCode)
		}
		var res InlineCompleteResponse
		_ = json.NewDecoder(resp.Body).Decode(&res)
		if res.Completion != "" || res.FinishReason != "stop" {
			t.Fatalf("expected empty completion with stop, got %+v", res)
		}
		if atomic.LoadInt32(&calls) != 0 {
			t.Fatalf("expected 0 calls to LLM for empty prefix, got %d", calls)
		}
	})

	t.Run("semicolon terminated prefix returns empty completion without calling LLM", func(t *testing.T) {
		var calls int32
		fakeGroq := newFake(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&calls, 1)
			w.WriteHeader(200)
		})
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		rg := setupInlineRig(t, cfg, injectUser)

		cases := []string{
			`{"prefix":"SELECT * FROM users;"}`,
			`{"prefix":"SELECT 1;\n\t  "}`,
		}
		for _, body := range cases {
			resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("want 200, got %d", resp.StatusCode)
			}
			var res InlineCompleteResponse
			_ = json.NewDecoder(resp.Body).Decode(&res)
			if res.Completion != "" {
				t.Fatalf("expected empty completion, got %q", res.Completion)
			}
		}
		if atomic.LoadInt32(&calls) != 0 {
			t.Fatalf("expected 0 calls to LLM for semicolon prefix, got %d", calls)
		}
	})

	t.Run("upstream groq 500 falls back safely to empty completion without 500 error", func(t *testing.T) {
		fakeGroq := newFake(status(http.StatusInternalServerError))
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"SELECT id "}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200 OK (safe fallback), got %d", resp.StatusCode)
		}
		var res InlineCompleteResponse
		_ = json.NewDecoder(resp.Body).Decode(&res)
		if res.Completion != "" || res.FinishReason != "stop" {
			t.Fatalf("expected empty completion fallback, got %+v", res)
		}
	})

	t.Run("upstream groq 429 falls back safely to empty completion", func(t *testing.T) {
		fakeGroq := newFake(status(http.StatusTooManyRequests))
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"SELECT id "}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200 OK, got %d", resp.StatusCode)
		}
		var res InlineCompleteResponse
		_ = json.NewDecoder(resp.Body).Decode(&res)
		if res.Completion != "" {
			t.Fatalf("expected empty completion, got %q", res.Completion)
		}
	})

	t.Run("upstream groq error falls back to openrouter", func(t *testing.T) {
		fakeGroq := newFake(status(http.StatusInternalServerError))
		defer fakeGroq.Close()
		fakeOpenRouter := newFake(mockGroqCompletion("FROM openrouter_table", "stop"))
		defer fakeOpenRouter.Close()
		cfg := cfgFor(fakeGroq, fakeOpenRouter)

		rg := setupInlineRig(t, cfg, injectUser)

		body := `{"prefix":"SELECT * "}`
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("want 200, got %d", resp.StatusCode)
		}
		var res InlineCompleteResponse
		_ = json.NewDecoder(resp.Body).Decode(&res)
		if res.Completion != "FROM openrouter_table" {
			t.Fatalf("want completion from openrouter fallback, got %q", res.Completion)
		}
	})

	t.Run("never logs user SQL (Core Rule 7)", func(t *testing.T) {
		fakeGroq := newFake(mockGroqCompletion("WHERE secret_id = 999", "stop"))
		defer fakeGroq.Close()
		cfg := cfgFor(fakeGroq, nil)

		rg := setupInlineRig(t, cfg, injectUser)

		sqlSnippet := "MY_SECRET_USER_SQL_COLUMN_12345"
		body := fmt.Sprintf(`{"prefix":"SELECT %s FROM accounts"}`, sqlSnippet)
		resp, err := http.Post(rg.srv.URL+"/ai/inline-complete", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()

		logged := rg.logs.String()
		if strings.Contains(logged, sqlSnippet) {
			t.Fatalf("CRITICAL SECURITY VIOLATION: User SQL leaked to log: %s", logged)
		}
	})
}
