package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestRouter(secret []byte, vipMiddleware gin.HandlerFunc) *gin.Engine {
	r := gin.New()
	r.GET("/protected/vip", vipMiddleware, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "welcome vip"})
	})
	return r
}

type mockSessionFinder struct {
	users   map[string]store.User
	demoted atomic.Bool
}

func (m *mockSessionFinder) SessionUser(ctx context.Context, token string) (store.User, error) {
	if u, ok := m.users[token]; ok {
		return u, nil
	}
	return store.User{}, store.ErrNotFound
}

func (m *mockSessionFinder) DemoteExpiredVIP(ctx context.Context, userID string) error {
	m.demoted.Store(true)
	return nil
}

func TestRequireVip_ContextUser(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(30 * 24 * time.Hour)

	tests := []struct {
		name       string
		user       *store.User
		wantStatus int
		wantCode   string
	}{
		{
			name:       "Chưa đăng nhập (guest)",
			user:       nil,
			wantStatus: http.StatusUnauthorized,
			wantCode:   "auth_required",
		},
		{
			name:       "User thường",
			user:       &store.User{ID: "u1", Role: "user"},
			wantStatus: http.StatusForbidden,
			wantCode:   "vip_required",
		},
		{
			name:       "Guest role",
			user:       &store.User{ID: "u2", Role: "guest"},
			wantStatus: http.StatusForbidden,
			wantCode:   "vip_required",
		},
		{
			name:       "VIP đã hết hạn",
			user:       &store.User{ID: "u3", Role: "vip", VipUntil: &past},
			wantStatus: http.StatusForbidden,
			wantCode:   "vip_expired",
		},
		{
			name:       "VIP còn hạn",
			user:       &store.User{ID: "u4", Role: "vip", VipUntil: &future},
			wantStatus: http.StatusOK,
			wantCode:   "",
		},
		{
			name:       "VIP vĩnh viễn (vip_until nil)",
			user:       &store.User{ID: "u5", Role: "vip", VipUntil: nil},
			wantStatus: http.StatusOK,
			wantCode:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := gin.New()
			// Mock middleware đặt user vào context nếu có
			r.Use(func(c *gin.Context) {
				if tt.user != nil {
					c.Set(userKey, *tt.user)
				}
				c.Next()
			})
			r.GET("/vip-only", RequireVip(secret), func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"ok": true})
			})

			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodGet, "/vip-only", nil)
			r.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body: %s", w.Code, tt.wantStatus, w.Body.String())
			}

			if tt.wantCode != "" {
				var body struct {
					Error struct {
						Code       string `json:"code"`
						MessageKey string `json:"messageKey"`
					} `json:"error"`
					Message string `json:"message"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatalf("unmarshal error: %v", err)
				}
				if body.Error.Code != tt.wantCode {
					t.Errorf("error code = %q, want %q", body.Error.Code, tt.wantCode)
				}
				if (tt.wantCode == "vip_required" || tt.wantCode == "vip_expired") && body.Message == "" {
					t.Errorf("thiếu trường message trong lỗi %s: %s", tt.wantCode, w.Body.String())
				}
			}
		})
	}
}

func TestRequireVip_BearerToken(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(30 * 24 * time.Hour)

	r := setupTestRouter(secret, RequireVip(secret))

	t.Run("Bearer token VIP còn hạn", func(t *testing.T) {
		tok, err := GenerateUserToken(store.User{ID: "vip1", Role: "vip", VipUntil: &future}, secret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Bearer token VIP vĩnh viễn", func(t *testing.T) {
		tok, err := GenerateUserToken(store.User{ID: "vip-forever", Role: "vip", VipUntil: nil}, secret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Bearer token User thường", func(t *testing.T) {
		tok, err := GenerateUserToken(store.User{ID: "u1", Role: "user"}, secret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_required" {
			t.Fatalf("error code = %v, want vip_required", errObj["code"])
		}
	})

	t.Run("Bearer token VIP hết hạn", func(t *testing.T) {
		tok, err := GenerateUserToken(store.User{ID: "vip-exp", Role: "vip", VipUntil: &past}, secret, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_expired" {
			t.Fatalf("error code = %v, want vip_expired", errObj["code"])
		}
	})

	t.Run("Bearer token sai chữ ký", func(t *testing.T) {
		wrongSecret := []byte("wrong-secret-key-32-bytes-long-padding!!")
		tok, _ := GenerateUserToken(store.User{ID: "fake-vip", Role: "vip", VipUntil: &future}, wrongSecret, time.Hour)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401, body: %s", w.Code, w.Body.String())
		}
	})
}

func TestRequireVip_SessionCookie(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(30 * 24 * time.Hour)

	// Tạo các raw token 43 ký tự chuẩn (32 bytes base64url)
	rawVipTok := randToken(32)
	rawUserTok := randToken(32)
	rawExpiredTok := randToken(32)
	rawMissingTok := randToken(32)

	mockStore := &mockSessionFinder{
		users: map[string]store.User{
			rawVipTok:     {ID: "u_vip", Role: "vip", VipUntil: &future},
			rawUserTok:    {ID: "u_user", Role: "user"},
			rawExpiredTok: {ID: "u_expired", Role: "vip", VipUntil: &past},
		},
	}

	r := setupTestRouter(secret, RequireVipWithStore(secret, mockStore))

	t.Run("Session Cookie sid VIP còn hạn", func(t *testing.T) {
		signed := signToken(rawVipTok, secret)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sid", Value: signed})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Session Cookie sqllens_session VIP còn hạn", func(t *testing.T) {
		signed := signToken(rawVipTok, secret)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sqllens_session", Value: signed})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Session Cookie user thường", func(t *testing.T) {
		signed := signToken(rawUserTok, secret)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sid", Value: signed})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_required" {
			t.Fatalf("error code = %v, want vip_required", errObj["code"])
		}
	})

	t.Run("Session Cookie VIP hết hạn trả về vip_expired và kích hoạt demote", func(t *testing.T) {
		signed := signToken(rawExpiredTok, secret)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sid", Value: signed})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_expired" {
			t.Fatalf("error code = %v, want vip_expired", errObj["code"])
		}
		if !mockStore.demoted.Load() {
			t.Errorf("expected DemoteExpiredVIP to be triggered for expired vip")
		}
	})

	t.Run("Session Cookie không tìm thấy trong store", func(t *testing.T) {
		signed := signToken(rawMissingTok, secret)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sid", Value: signed})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Session Cookie sai chữ ký HMAC", func(t *testing.T) {
		tampered := rawVipTok + ".invalidsignaturecharacterslongenough1234567"
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		req.AddCookie(&http.Cookie{Name: "sid", Value: tampered})
		r.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Request không có auth", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/protected/vip", nil)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401, body: %s", w.Code, w.Body.String())
		}
	})
}

func TestRequireRole(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(30 * 24 * time.Hour)

	r := gin.New()
	r.GET("/admin", RequireRoleWithSecret(secret, "admin"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "admin_granted"})
	})
	r.GET("/vip-role", RequireRoleWithSecret(secret, "vip"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "vip_granted"})
	})

	t.Run("User không đủ quyền (role=user) vào admin", func(t *testing.T) {
		tok, _ := GenerateUserToken(store.User{ID: "u1", Role: "user"}, secret, time.Hour)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/admin", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("User đúng quyền (role=admin)", func(t *testing.T) {
		tok, _ := GenerateUserToken(store.User{ID: "adm", Role: "admin"}, secret, time.Hour)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/admin", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("RequireRole(vip) với VIP còn hạn", func(t *testing.T) {
		tok, _ := GenerateUserToken(store.User{ID: "vip_ok", Role: "vip", VipUntil: &future}, secret, time.Hour)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/vip-role", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("RequireRole(vip) với VIP đã hết hạn -> trả về vip_expired", func(t *testing.T) {
		tok, _ := GenerateUserToken(store.User{ID: "vip_dead", Role: "vip", VipUntil: &past}, secret, time.Hour)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/vip-role", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_expired" {
			t.Fatalf("error code = %v, want vip_expired", errObj["code"])
		}
	})

	t.Run("RequireRole(vip) với user thường -> trả về vip_required", func(t *testing.T) {
		tok, _ := GenerateUserToken(store.User{ID: "u_norm", Role: "user"}, secret, time.Hour)
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/vip-role", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403, body: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		json.Unmarshal(w.Body.Bytes(), &resp)
		errObj, _ := resp["error"].(map[string]any)
		if errObj["code"] != "vip_required" {
			t.Fatalf("error code = %v, want vip_required", errObj["code"])
		}
	})
}

func TestRedeemVIP_Validation(t *testing.T) {
	r := gin.New()
	a := &Auth{}
	r.POST("/auth/redeem-vip", func(c *gin.Context) {
		c.Set(userKey, store.User{ID: "test-user", Role: "user"})
		c.Next()
	}, a.redeemVIP)

	t.Run("Payload rỗng hoặc không có code", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodPost, "/auth/redeem-vip", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400, body: %s", w.Code, w.Body.String())
		}
	})

	t.Run("Code chỉ toàn khoảng trắng", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodPost, "/auth/redeem-vip", strings.NewReader(`{"code":"   "}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400, body: %s", w.Code, w.Body.String())
		}
	})
}
