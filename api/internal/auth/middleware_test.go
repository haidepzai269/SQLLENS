package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
			wantCode:   "vip_required",
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
				if tt.wantCode == "vip_required" && body.Message == "" {
					t.Errorf("thiếu trường message trong lỗi vip_required: %s", w.Body.String())
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

func TestRequireRole(t *testing.T) {
	secret := []byte("this-is-a-very-secure-32-byte-secret-key!")
	r := gin.New()
	r.GET("/admin", RequireRoleWithSecret(secret, "admin"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "admin_granted"})
	})

	t.Run("User không đủ quyền (role=user)", func(t *testing.T) {
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
