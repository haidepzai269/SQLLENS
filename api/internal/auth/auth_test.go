package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
	"github.com/jackc/pgx/v5"
)

const origin = "https://app.test"

type env struct {
	t         *testing.T
	h         http.Handler
	a         *Auth
	st        *store.Store
	logs      *bytes.Buffer
	prov      *httptest.Server
	challenge string        // code_challenge của lần start gần nhất
	badVerif  atomic.Bool   // giả lập nhà cung cấp từ chối code_verifier
	failTok   atomic.Bool   // giả lập token endpoint lỗi
	upstash   *atomic.Int64 // số lệnh EVAL đã nhận
}

// Cần Postgres: đặt T042_DATABASE_URL, ví dụ postgres://postgres:pw@localhost:54420/a42
func newEnv(t *testing.T) *env {
	t.Helper()
	url := os.Getenv("T042_DATABASE_URL")
	if url == "" {
		t.Skip("bỏ qua: chưa đặt T042_DATABASE_URL (cần Postgres trong Docker)")
	}
	if !strings.Contains(url, "@localhost:") && !strings.Contains(url, "@127.0.0.1:") {
		t.Fatal("từ chối chạy: test xóa bảng, chỉ cho phép database ở localhost")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	// store không export pool: xóa dữ liệu qua kết nối riêng.
	resetDB(t, url)
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, st: st, logs: &bytes.Buffer{}, upstash: &atomic.Int64{}}
	e.prov = httptest.NewServer(http.HandlerFunc(e.provider))
	t.Cleanup(e.prov.Close)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := e.upstash.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"result": []int64{n, 86400000}})
	}))
	t.Cleanup(up.Close)
	// Bộ đếm Upstash giả đếm chung mọi khóa: đủ để thử 429 và đếm lệnh.
	prev := log.Writer()
	log.SetOutput(e.logs)
	t.Cleanup(func() { log.SetOutput(prev) })
	ep := func(p string) Endpoints {
		return Endpoints{e.prov.URL + "/" + p + "/auth", e.prov.URL + "/" + p + "/token", e.prov.URL + "/" + p + "/user"}
	}
	cfg := Config{PublicOrigin: origin,
		Google: Provider{"gid", "gsecret", ep("google")}, GitHub: Provider{"hid", "hsecret", ep("github")}}
	r := httpapi.NewRouterWithLog(e.logs)
	e.a = Mount(r, Deps{Config: cfg, Store: st, Limiter: quota.New(up.URL, "tok", nil)})
	gatedPing(r, e.a)
	e.h = r
	return e
}

func (e *env) provider(w http.ResponseWriter, r *http.Request) {
	p := strings.Split(r.URL.Path, "/")[1]
	if strings.HasSuffix(r.URL.Path, "/token") {
		r.ParseForm()
		id, sec := "gid", "gsecret"
		if p == "github" {
			id, sec = "hid", "hsecret"
		}
		v := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
		ok := r.PostForm.Get("client_id") == id && r.PostForm.Get("client_secret") == sec &&
			r.PostForm.Get("code") == "CODE1" && r.PostForm.Get("grant_type") == "authorization_code" &&
			r.PostForm.Get("redirect_uri") == origin+"/api/auth/"+p+"/callback" &&
			base64.RawURLEncoding.EncodeToString(v[:]) == e.challenge && !e.badVerif.Load() && !e.failTok.Load()
		if !ok {
			w.Write([]byte(`{"error":"invalid_grant"}`)) // GitHub trả lỗi với 200
			return
		}
		w.Write([]byte(`{"access_token":"ATOKEN","token_type":"bearer"}`))
		return
	}
	if r.Header.Get("Authorization") != "Bearer ATOKEN" {
		http.Error(w, "no", 401)
		return
	}
	if p == "google" {
		w.Write([]byte(`{"sub":"g-123","name":"Alice G","email":"alice@example.com","email_verified":true,"picture":"https://img.test/a.png"}`))
		return
	}
	w.Write([]byte(`{"id":4242,"login":"bob","name":null,"email":null,"avatar_url":"https://img.test/b.png"}`))
}

func (e *env) do(method, path string, hdr map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, req)
	return w
}

func cookie(w *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// start chạy bước 1 và trả state cùng cookie gắn trình duyệt.
func (e *env) start(provider, next string) (state string, bind *http.Cookie, w *httptest.ResponseRecorder) {
	w = e.do("GET", "/auth/"+provider+"/start?next="+url.QueryEscape(next), nil)
	if w.Code != 302 {
		e.t.Fatalf("start %d %s", w.Code, w.Body)
	}
	loc, _ := url.Parse(w.Header().Get("Location"))
	q := loc.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("redirect_uri") != origin+"/api/auth/"+provider+"/callback" || q.Get("state") == "" {
		e.t.Fatalf("start query %v", q)
	}
	e.challenge = q.Get("code_challenge")
	return q.Get("state"), cookie(w, bindName(q.Get("state"))), w
}

// callback gửi các cookie bind; trình duyệt thật gửi mọi cookie đang giữ.
func (e *env) callback(provider, query string, bind ...*http.Cookie) *httptest.ResponseRecorder {
	if len(bind) == 0 || bind[0] == nil {
		return e.do("GET", "/auth/"+provider+"/callback?"+query, nil)
	}
	return e.do("GET", "/auth/"+provider+"/callback?"+query, nil, bind...)
}

func (e *env) login(provider, next string) (*http.Cookie, *httptest.ResponseRecorder) {
	state, bind, _ := e.start(provider, next)
	w := e.callback(provider, "state="+state+"&code=CODE1", bind)
	if w.Code != 302 {
		e.t.Fatalf("callback %d %s", w.Code, w.Body)
	}
	return cookie(w, cookieName), w
}

func TestLoginRoundTrip(t *testing.T) { // AC1, AC6
	e := newEnv(t)
	for _, c := range []struct{ p, name, avatar string }{{"google", "Alice G", "https://img.test/a.png"}, {"github", "bob", "https://img.test/b.png"}} {
		sid, w := e.login(c.p, "/vi/lab?x=1")
		if sid == nil || !sid.HttpOnly || !sid.Secure || sid.SameSite != http.SameSiteLaxMode || sid.Path != "/" || sid.MaxAge != 30*86400 {
			t.Fatalf("%s cookie %+v", c.p, sid)
		}
		if got := w.Header().Get("Location"); got != origin+"/vi/lab?x=1" {
			t.Fatalf("Location %q", got)
		}
		me := e.do("GET", "/me", nil, sid)
		var body map[string]any
		json.Unmarshal(me.Body.Bytes(), &body)
		if me.Code != 200 || body["name"] != c.name || body["provider"] != c.p || body["avatarUrl"] != c.avatar || body["id"] == "" {
			t.Fatalf("%s /me %d %s", c.p, me.Code, me.Body)
		}
		if me.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("thiếu no-store")
		}
		if strings.Contains(me.Body.String(), "email") {
			t.Fatal("/me không được trả email")
		}
		for _, secret := range []string{"CODE1", "ATOKEN", sid.Value, "alice@example.com", "gsecret", "hsecret"} {
			if strings.Contains(e.logs.String(), secret) {
				t.Fatalf("log chứa %q:\n%s", secret, e.logs)
			}
		}
	}
}

func TestSecureOffOnLocalhost(t *testing.T) {
	for origin, want := range map[string]bool{"http://localhost:3000": false, "http://localhost": false, "https://x.app": true, "http://evil.test": true} {
		a := Mount(httpapi.NewRouter(), Deps{Config: Config{PublicOrigin: origin}})
		if a.secure != want {
			t.Errorf("%s secure=%v", origin, a.secure)
		}
	}
}

func TestStateFailures(t *testing.T) { // AC2
	e := newEnv(t)
	noSid := func(name string, w *httptest.ResponseRecorder) {
		t.Helper()
		if cookie(w, cookieName) != nil {
			t.Errorf("%s: không được đặt sid", name)
		}
	}
	state, bind, _ := e.start("google", "/")
	noSid("state sai", e.callback("google", "state=wrong&code=CODE1", bind))
	if w := e.callback("google", "state=wrong&code=CODE1", bind); w.Code != 400 {
		t.Errorf("state sai: %d", w.Code)
	}
	if w := e.callback("google", "code=CODE1", bind); w.Code != 400 {
		t.Errorf("thiếu state: %d", w.Code)
	}
	// state ở trên chưa bị dùng: thiếu cookie gắn trình duyệt vẫn bị từ chối, và state bị đốt.
	w := e.callback("google", "state="+state+"&code=CODE1")
	if w.Code != 400 || cookie(w, cookieName) != nil {
		t.Errorf("thiếu bind: %d", w.Code)
	}
	// Dùng lại lần hai.
	state, bind, _ = e.start("google", "/")
	if w := e.callback("google", "state="+state+"&code=CODE1", bind); w.Code != 302 || cookie(w, cookieName) == nil {
		t.Fatalf("lần 1: %d", w.Code)
	}
	w = e.callback("google", "state="+state+"&code=CODE1", bind)
	if w.Code != 400 {
		t.Errorf("dùng lại: %d", w.Code)
	}
	noSid("dùng lại", w)
	// state của google không dùng được ở github.
	state, bind, _ = e.start("google", "/")
	w = e.callback("github", "state="+state+"&code=CODE1", bind)
	if w.Code != 400 {
		t.Errorf("sai nhà cung cấp: %d", w.Code)
	}
	// Bind của người khác.
	state, _, _ = e.start("google", "/")
	_, other, _ := e.start("google", "/")
	if w := e.callback("google", "state="+state+"&code=CODE1", other); w.Code != 400 || cookie(w, cookieName) != nil {
		t.Errorf("bind lạ: %d", w.Code)
	}
	// Code verifier sai: nhà cung cấp từ chối, Gin không đăng nhập.
	e.badVerif.Store(true)
	state, bind, _ = e.start("github", "/lab")
	w = e.callback("github", "state="+state+"&code=CODE1", bind)
	noSid("verifier sai", w)
	if w.Code != 302 || !strings.Contains(w.Header().Get("Location"), "auth_error=failed") {
		t.Errorf("verifier sai: %d %s", w.Code, w.Header().Get("Location"))
	}
	e.badVerif.Store(false)
	// State hết hạn.
	state, bind, _ = e.start("google", "/")
	e.a.mu.Lock()
	p := e.a.states[state]
	p.exp = time.Now().Add(-time.Second)
	e.a.states[state] = p
	e.a.mu.Unlock()
	if w := e.callback("google", "state="+state+"&code=CODE1", bind); w.Code != 400 {
		t.Errorf("hết hạn: %d", w.Code)
	}
}

func TestCancelled(t *testing.T) { // ca biên: hủy ở trang đồng ý
	e := newEnv(t)
	state, bind, _ := e.start("github", "/vi/lab")
	w := e.callback("github", "state="+state+"&error=access_denied", bind)
	if w.Code != 302 || w.Header().Get("Location") != origin+"/vi/lab?auth_error=cancelled" || cookie(w, cookieName) != nil {
		t.Fatalf("%d %s", w.Code, w.Header().Get("Location"))
	}
}

func TestSafeNext(t *testing.T) { // AC3
	for _, bad := range []string{"https://evil.com", "//evil.com", `/\evil.com`, "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)", "evil.com", "", "/a\\b", "/" + strings.Repeat("a", 600)} {
		if got := safeNext(bad); got != "/" {
			t.Errorf("safeNext(%q) = %q", bad, got)
		}
	}
	for _, ok := range []string{"/", "/vi/lab", "/en/lab?q=1&r=2#h"} {
		if got := safeNext(ok); got != ok {
			t.Errorf("safeNext(%q) = %q", ok, got)
		}
	}
}

func TestNextEndToEnd(t *testing.T) { // AC3 qua cả vòng đăng nhập
	e := newEnv(t)
	for _, bad := range []string{"https://evil.com", "//evil.com", `/\evil.com`} {
		_, w := e.login("google", bad)
		if got := w.Header().Get("Location"); got != origin+"/" {
			t.Errorf("next=%q chuyển tới %q", bad, got)
		}
	}
}

func TestLogoutAndCSRF(t *testing.T) { // AC4
	e := newEnv(t)
	sid, _ := e.login("google", "/")
	for name, hdr := range map[string]map[string]string{"khác": {"Origin": "https://evil.com"}, "thiếu": nil, "null": {"Origin": "null"}, "gần đúng": {"Origin": origin + ".evil.com"}} {
		w := e.do("POST", "/auth/logout", hdr, sid)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "origin_mismatch") {
			t.Errorf("Origin %s: %d", name, w.Code)
		}
	}
	if w := e.do("GET", "/me", nil, sid); w.Code != 200 {
		t.Fatal("bị 403 phải không xóa phiên")
	}
	w := e.do("POST", "/auth/logout", map[string]string{"Origin": origin}, sid)
	if w.Code != 204 {
		t.Fatalf("logout %d", w.Code)
	}
	if c := cookie(w, cookieName); c == nil || c.MaxAge >= 0 || c.Value != "" {
		t.Fatalf("cookie chưa bị xóa: %+v", c)
	}
	if w := e.do("GET", "/me", nil, sid); w.Code != 401 || !strings.Contains(w.Body.String(), "auth_required") {
		t.Fatalf("sid cũ: %d %s", w.Code, w.Body)
	}
	// Mọi phương thức đổi trạng thái đều bị kiểm.
	for _, m := range []string{"PUT", "PATCH", "DELETE"} {
		if w := e.do(m, "/mysql/ping", map[string]string{"Origin": "https://evil.com"}); w.Code != 403 {
			t.Errorf("%s: %d", m, w.Code)
		}
	}
}

func TestMySQLGate(t *testing.T) { // AC5, AC7c
	e := newEnv(t)
	ok := map[string]string{"Origin": origin}
	if w := e.do("POST", "/mysql/ping", ok); w.Code != 401 || !strings.Contains(w.Body.String(), "auth_required") {
		t.Fatalf("chưa đăng nhập: %d %s", w.Code, w.Body)
	}
	if e.upstash.Load() != 0 {
		t.Fatal("chưa đăng nhập không được tốn lệnh Upstash")
	}
	// Cookie khác không tính là đăng nhập.
	if w := e.do("POST", "/mysql/ping", ok, &http.Cookie{Name: "session", Value: "x"}); w.Code != 401 {
		t.Fatalf("cookie lạ: %d", w.Code)
	}
	sid, _ := e.login("google", "/")
	// Upstash giả đếm chung: lệnh thứ 21 trở đi vượt hạn mức 20.
	for i := 1; i <= 30; i++ {
		w := e.do("POST", "/mysql/ping", ok, sid)
		want := 204
		if i > quota.MySQLSession.Limit {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("lần %d: %d %s", i, w.Code, w.Body)
		}
	}
	// Lần 31: giới hạn thô chặn trước, không tốn lệnh Upstash.
	before := e.upstash.Load()
	w := e.do("POST", "/mysql/ping", ok, sid)
	if w.Code != 429 || !strings.Contains(w.Body.String(), "rate_limited") || w.Header().Get("Retry-After") == "" {
		t.Fatalf("giới hạn thô: %d %s", w.Code, w.Body)
	}
	if e.upstash.Load() != before {
		t.Fatal("yêu cầu bị giới hạn thô vẫn gọi Upstash")
	}
}

func TestTwoTabs(t *testing.T) { // ca biên: hai tab cùng đăng nhập
	e := newEnv(t)
	s1, b1, _ := e.start("google", "/a")
	ch1 := e.challenge
	s2, b2, _ := e.start("google", "/b")
	w2 := e.callback("google", "state="+s2+"&code=CODE1", b1, b2)
	e.challenge = ch1 // nhà cung cấp giả chỉ nhớ một challenge: trả về challenge của tab 1
	w1 := e.callback("google", "state="+s1+"&code=CODE1", b1, b2)
	c1, c2 := cookie(w1, cookieName), cookie(w2, cookieName)
	if c1 == nil || c2 == nil || c1.Value == c2.Value {
		t.Fatal("hai phiên độc lập")
	}
	if w1.Header().Get("Location") != origin+"/a" || w2.Header().Get("Location") != origin+"/b" {
		t.Fatal("next lẫn giữa hai tab")
	}
	for _, c := range []*http.Cookie{c1, c2} {
		if w := e.do("GET", "/me", nil, c); w.Code != 200 {
			t.Fatalf("/me %d", w.Code)
		}
	}
}

func TestUnknownProvider(t *testing.T) {
	e := newEnv(t)
	if w := e.do("GET", "/auth/evil/start", nil); w.Code != 404 {
		t.Fatalf("%d", w.Code)
	}
}

// Route thử cho cổng đăng nhập và hạn mức; route MySQL thật nằm ở package mysql.
func gatedPing(r *gin.Engine, a *Auth) {
	r.Group("/mysql", a.Gate(quota.MySQLSession)...).POST("/ping", func(c *gin.Context) { c.Status(http.StatusNoContent) })
}

// Không cần Docker: thiếu cấu hình thì server vẫn chạy, route liên quan trả 503.
func TestNotConfigured(t *testing.T) {
	r := httpapi.NewRouter()
	gatedPing(r, Mount(r, Deps{}))
	do := func(m, p string, hdr map[string]string, c *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(m, p, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		if c != nil {
			req.AddCookie(c)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	sid := &http.Cookie{Name: "sid", Value: "x"}
	cases := []struct {
		m, p string
		c    *http.Cookie
		want int
	}{
		{"GET", "/healthz", nil, 200},
		{"GET", "/auth/google/start", nil, 503},
		{"GET", "/auth/github/callback?state=a", nil, 503},
		{"POST", "/auth/logout", nil, 503},
		{"GET", "/me", nil, 401},
		{"GET", "/me", sid, 503},
		{"POST", "/mysql/ping", nil, 503}, // Origin không kiểm được khi thiếu PUBLIC_ORIGIN
	}
	for _, c := range cases {
		if w := do(c.m, c.p, map[string]string{"Origin": origin}, c.c); w.Code != c.want {
			t.Errorf("%s %s: %d want %d", c.m, c.p, w.Code, c.want)
		}
	}
	if b, _ := io.ReadAll(do("GET", "/auth/google/start", nil, nil).Body); !strings.Contains(string(b), "not_configured") {
		t.Errorf("thiếu mã lỗi: %s", b)
	}
}

func TestNormalizeOrigin(t *testing.T) {
	for in, want := range map[string]string{"https://a.app": "https://a.app", "http://localhost:3000/": "http://localhost:3000",
		"": "", "a.app": "", "https://a.app/x": "", "https://u@a.app": "", "ftp://a.app": "", "https://a.app?x=1": ""} {
		if got := normalizeOrigin(in); got != want {
			t.Errorf("%q -> %q", in, got)
		}
	}
}

func TestRateLimiter(t *testing.T) {
	r := newRateLimiter(2, time.Hour)
	for i, want := range []bool{true, true, false} {
		if _, ok := r.allow("a"); ok != want {
			t.Errorf("lần %d: %v", i, ok)
		}
	}
	if _, ok := r.allow("b"); !ok {
		t.Error("khóa khác phải độc lập")
	}
}

func resetDB(t *testing.T, url string) {
	t.Helper()
	c, err := pgx.Connect(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(context.Background())
	if _, err := c.Exec(context.Background(), `DROP TABLE IF EXISTS sessions, identities, users, schema_migrations`); err != nil {
		t.Fatal(err)
	}
}
