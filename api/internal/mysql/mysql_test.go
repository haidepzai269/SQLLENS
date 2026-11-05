package mysql

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/haidepzai269/SQLLENS/api/internal/httpapi"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
)

var tok = strings.Repeat("T", 40)

const sid = "0123456789abcdef0123456789abcd"

type fakeBudget struct {
	mu     sync.Mutex
	spent  time.Duration
	err    error
	added  []time.Duration
	addErr error
}

func (b *fakeBudget) Spent(context.Context, string) (time.Duration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.spent, b.err
}
func (b *fakeBudget) Add(_ context.Context, _ string, d time.Duration) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.added = append(b.added, d)
	return b.addErr
}

type rig struct {
	t      *testing.T
	agent  *httptest.Server
	hits   atomic.Int32
	auths  chan string
	users  chan string
	h      http.Handler
	budget *fakeBudget
	logs   *bytes.Buffer
	reply  func(w http.ResponseWriter, r *http.Request)
}

func pinOf(cert *x509.Certificate) string {
	s := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(s[:])
}

func newRig(t *testing.T, mutate func(*Config)) *rig {
	t.Helper()
	g := &rig{t: t, auths: make(chan string, 16), users: make(chan string, 16), budget: &fakeBudget{}, logs: &bytes.Buffer{}}
	g.reply = func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"ok":true}`)) }
	g.agent = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.hits.Add(1)
		io.Copy(io.Discard, r.Body) // net/http only notices a closed connection after the body is read
		g.auths <- r.Header.Get("Authorization")
		g.users <- r.Header.Get("X-Sandbox-User")
		w.Header().Set("Content-Type", "application/json")
		g.reply(w, r)
	}))
	t.Cleanup(g.agent.Close)
	cfg := Config{URL: g.agent.URL, Token: tok, CertSHA256: pinOf(g.agent.Certificate())}
	if mutate != nil {
		mutate(&cfg)
	}
	prev := log.Writer()
	log.SetOutput(g.logs)
	t.Cleanup(func() { log.SetOutput(prev) })
	r := httpapi.NewRouterWithLog(g.logs)
	gate := func(quota.Rule) []gin.HandlerFunc {
		return []gin.HandlerFunc{func(c *gin.Context) {
			if c.GetHeader("X-Test-User") == "" {
				httpapi.Abort(c, 401, "auth_required", "error.authRequired")
			}
		}}
	}
	var b Budget = g.budget
	routes(r, gate, &handler{c: newClient(cfg), budget: b, uid: func(c *gin.Context) string { return c.GetHeader("X-Test-User") }})
	g.h = r
	return g
}

func (g *rig) do(method, path, body string) *httptest.ResponseRecorder {
	return g.doCtx(context.Background(), method, path, body)
}

func (g *rig) doCtx(ctx context.Context, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(ctx)
	req.Header.Set("X-Test-User", "USERMARK-42")
	w := httptest.NewRecorder()
	g.h.ServeHTTP(w, req)
	return w
}

func TestForwardAndHeaders(t *testing.T) {
	g := newRig(t, nil)
	if w := g.do("POST", "/mysql/sessions", ""); w.Code != 200 || w.Body.String() != `{"ok":true}` {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	if a, u := <-g.auths, <-g.users; a != "Bearer "+tok || u != "USERMARK-42" {
		t.Fatalf("header agent nhận: %q %q", a, u)
	}
	for _, c := range []struct{ m, p, b string }{
		{"POST", "/mysql/sessions/" + sid + "/query", `{"sql":"select 1","connection":"b"}`},
		{"GET", "/mysql/sessions/" + sid + "/locks", ""},
		{"DELETE", "/mysql/sessions/" + sid, ""},
	} {
		if w := g.do(c.m, c.p, c.b); w.Code != 200 {
			t.Fatalf("%s %s: %d %s", c.m, c.p, w.Code, w.Body)
		}
	}
	if len(g.budget.added) != 1 || g.budget.added[0] <= 0 {
		t.Fatalf("thời gian câu lệnh chưa được tính: %v", g.budget.added)
	}
}

// AC1: sai vân tay, chứng chỉ hết hạn, máy chủ giả: bị từ chối và không có byte HTTP nào (nên không có token) tới máy chủ.
func TestPinRejects(t *testing.T) {
	g := newRig(t, func(c *Config) { c.CertSHA256 = strings.Repeat("ab", 32) })
	if w := g.do("POST", "/mysql/sessions", ""); w.Code != 502 || !strings.Contains(w.Body.String(), "sandbox_unreachable") {
		t.Fatalf("sai vân tay: %d %s", w.Code, w.Body)
	}
	if g.hits.Load() != 0 {
		t.Fatal("máy chủ nhận được yêu cầu dù sai vân tay")
	}

	// Máy chủ giả: cùng địa chỉ cổng khác, chứng chỉ khác với cái đã ghim.
	// httptest dùng chung một chứng chỉ cho mọi máy chủ, nên máy chủ giả phải tự sinh chứng chỉ khác.
	real := newRig(t, nil)
	var fh atomic.Int32
	fk, fd := selfSigned(time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	fsrv := startTLS(fk, fd, &fh)
	defer fsrv.Close()
	fake := newRig(t, func(c *Config) { c.URL, c.CertSHA256 = fsrv.URL, pinOf(real.agent.Certificate()) })
	if w := fake.do("POST", "/mysql/sessions", ""); w.Code != 502 || fh.Load() != 0 {
		t.Fatalf("máy chủ giả: %d hits=%d", w.Code, fh.Load())
	}

	// Chứng chỉ đúng vân tay nhưng đã hết hạn.
	k, der := selfSigned(time.Now().Add(-48*time.Hour), time.Now().Add(-time.Hour))
	var hits atomic.Int32
	srv := startTLS(k, der, &hits)
	defer srv.Close()
	sum := sha256.Sum256(der)
	exp := newRig(t, func(c *Config) { c.URL, c.CertSHA256 = srv.URL, hex.EncodeToString(sum[:]) })
	if w := exp.do("POST", "/mysql/sessions", ""); w.Code != 502 || hits.Load() != 0 {
		t.Fatalf("hết hạn: %d hits=%d", w.Code, hits.Load())
	}
}

func TestNotConfigured(t *testing.T) {
	for name, mut := range map[string]func(*Config){
		"thiếu url":        func(c *Config) { c.URL = "" },
		"thiếu token":      func(c *Config) { c.Token = "" },
		"token ngắn":       func(c *Config) { c.Token = "short" },
		"thiếu vân tay":    func(c *Config) { c.CertSHA256 = "" },
		"vân tay hỏng":     func(c *Config) { c.CertSHA256 = "zz" },
		"http thường":      func(c *Config) { c.URL = strings.Replace(c.URL, "https:", "http:", 1) },
		"url có user":      func(c *Config) { c.URL = strings.Replace(c.URL, "https://", "https://a:b@", 1) },
		"url có đường dẫn": func(c *Config) { c.URL += "/x" },
	} {
		g := newRig(t, mut)
		for _, p := range []struct{ m, u string }{{"POST", "/mysql/sessions"}, {"GET", "/mysql/sessions/" + sid + "/locks"}} {
			if w := g.do(p.m, p.u, ""); w.Code != 503 || !strings.Contains(w.Body.String(), "not_configured") {
				t.Errorf("%s %s: %d %s", name, p.u, w.Code, w.Body)
			}
		}
	}
	// Chưa cấu hình thì 503 trước cả cổng đăng nhập: không tốn hạn mức của ai.
	g := newRig(t, func(c *Config) { c.URL = "" })
	req := httptest.NewRequest("POST", "/mysql/sessions", nil)
	w := httptest.NewRecorder()
	g.h.ServeHTTP(w, req)
	if w.Code != 503 {
		t.Fatalf("chưa cấu hình: %d", w.Code)
	}
}

func TestQueryValidation(t *testing.T) {
	g := newRig(t, nil)
	q := "/mysql/sessions/" + sid + "/query"
	for name, c := range map[string]struct {
		path, body string
		want       int
	}{
		"id lạ":       {"/mysql/sessions/../query", `{"sql":"x"}`, 404},
		"id ký tự lạ": {"/mysql/sessions/" + strings.Repeat("g", 30) + "/query", `{"sql":"x"}`, 404},
		"id dài":      {"/mysql/sessions/" + strings.Repeat("a", 31) + "/query", `{"sql":"x"}`, 404},
		"json hỏng":   {q, `{`, 400},
		"sql rỗng":    {q, `{"sql":"  "}`, 400},
		"trường lạ":   {q, `{"sql":"x","user":"y"}`, 400},
		"kết nối lạ":  {q, `{"sql":"x","connection":"c"}`, 400},
		"hai json":    {q, `{"sql":"x"}{"sql":"y"}`, 400},
		"quá 1 MiB":   {q, `{"sql":"` + strings.Repeat("a", 1<<20) + `"}`, 413},
	} {
		if w := g.do("POST", c.path, c.body); w.Code != c.want {
			t.Errorf("%s: %d want %d (%s)", name, w.Code, c.want, w.Body)
		}
	}
	if g.hits.Load() != 0 {
		t.Fatal("yêu cầu không hợp lệ vẫn tới agent")
	}
	if len(g.budget.added) != 0 {
		t.Fatal("yêu cầu không hợp lệ vẫn bị tính giờ")
	}
}

// AC3: tổng thời gian mỗi ngày; Upstash lỗi thì từ chối.
func TestBudget(t *testing.T) {
	g := newRig(t, nil)
	q := "/mysql/sessions/" + sid + "/query"
	g.budget.spent = DailyBudget
	if w := g.do("POST", q, `{"sql":"x"}`); w.Code != 429 || !strings.Contains(w.Body.String(), "mysql_time_exhausted") {
		t.Fatalf("hết giờ: %d %s", w.Code, w.Body)
	}
	g.budget.spent, g.budget.err = 0, errors.New("upstash unreachable")
	if w := g.do("POST", q, `{"sql":"x"}`); w.Code != 503 || !strings.Contains(w.Body.String(), "quota_unavailable") {
		t.Fatalf("Upstash lỗi: %d %s", w.Code, w.Body)
	}
	if g.hits.Load() != 0 {
		t.Fatal("agent bị gọi khi chưa qua được hạn mức")
	}
	// Agent lỗi vẫn tính giờ.
	g.budget.err = nil
	g.reply = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":{"code":"internal"}}`))
	}
	if w := g.do("POST", q, `{"sql":"x"}`); w.Code != 500 || len(g.budget.added) != 1 {
		t.Fatalf("agent lỗi: %d added=%v", w.Code, g.budget.added)
	}
}

// AC5: trình duyệt ngắt thì yêu cầu tới agent bị hủy; agent treo thì trả 504 đúng hạn; kết quả quá lớn bị chặn.
func TestCancelTimeoutAndSize(t *testing.T) {
	g := newRig(t, nil)
	q := "/mysql/sessions/" + sid + "/query"
	agentSawCancel := make(chan struct{})
	g.reply = func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		close(agentSawCancel)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(100 * time.Millisecond); cancel() }()
	g.doCtx(ctx, "POST", q, `{"sql":"x"}`)
	select {
	case <-agentSawCancel:
	case <-time.After(3 * time.Second):
		t.Fatal("agent không thấy yêu cầu bị hủy")
	}
	if len(g.budget.added) != 1 {
		t.Fatalf("câu bị ngắt vẫn phải tính giờ: %v", g.budget.added)
	}

	old := queryTimeout
	queryTimeout = 150 * time.Millisecond
	defer func() { queryTimeout = old }()
	g.reply = func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }
	t0 := time.Now()
	if w := g.do("POST", q, `{"sql":"x"}`); w.Code != 504 || !strings.Contains(w.Body.String(), "sandbox_timeout") || time.Since(t0) > 2*time.Second {
		t.Fatalf("treo: %d %s %v", w.Code, w.Body, time.Since(t0))
	}

	g.reply = func(w http.ResponseWriter, r *http.Request) { w.Write(bytes.Repeat([]byte("a"), maxResp+10)) }
	if w := g.do("GET", "/mysql/sessions/"+sid+"/locks", ""); w.Code != 422 || !strings.Contains(w.Body.String(), "result_too_large") {
		t.Fatalf("quá lớn: %d", w.Code)
	}
}

func TestAgentAnswers(t *testing.T) {
	g := newRig(t, nil)
	for _, c := range []struct {
		name   string
		status int
		body   string
		want   int
		code   string
	}{
		{"429 giữ nguyên", 429, `{"error":{"code":"user_session_limit"}}`, 429, "user_session_limit"},
		{"404 giữ nguyên", 404, `{"error":{"code":"session_not_found"}}`, 404, "session_not_found"},
		{"422 giữ nguyên", 422, `{"error":{"code":"sql_error"},"detail":{}}`, 422, "sql_error"},
		{"503 giữ nguyên", 503, `{"error":{"code":"disk_low"}}`, 503, "disk_low"},
		{"agent từ chối token", 401, `{"error":{"code":"unauthorized"}}`, 502, "sandbox_bad_response"},
		{"không phải JSON", 200, `<html>`, 502, "sandbox_bad_response"},
		{"chuyển hướng", 302, ``, 502, "sandbox_bad_response"},
	} {
		g.reply = func(w http.ResponseWriter, r *http.Request) {
			if c.status == 302 {
				w.Header().Set("Location", "https://evil.example/")
			}
			w.WriteHeader(c.status)
			w.Write([]byte(c.body))
		}
		w := g.do("GET", "/mysql/sessions/"+sid+"/locks", "")
		if w.Code != c.want || !strings.Contains(w.Body.String(), c.code) {
			t.Errorf("%s: %d %s", c.name, w.Code, w.Body)
		}
	}
	g.agent.Close()
	if w := g.do("POST", "/mysql/sessions", ""); w.Code != 502 || !strings.Contains(w.Body.String(), "sandbox_unreachable") {
		t.Fatalf("agent tắt: %d %s", w.Code, w.Body)
	}
}

// AC4: không có SQL, kết quả, token, user id trong log (kể cả lúc lỗi).
func TestNoSecretsInLog(t *testing.T) {
	g := newRig(t, nil)
	q := "/mysql/sessions/" + sid + "/query"
	g.reply = func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"results":"RESULTMARK"}`)) }
	g.do("POST", q, `{"sql":"SELECT 'SQLMARK'"}`)
	g.reply = func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(302) }
	g.do("POST", q, `{"sql":"SELECT 'SQLMARK'"}`)
	g.budget.err = errors.New("USERMARK-42 " + tok)
	g.do("POST", q, `{"sql":"SELECT 'SQLMARK'"}`)
	g.agent.Close()
	g.budget.err = nil
	g.do("POST", q, `{"sql":"SELECT 'SQLMARK'"}`)
	for _, s := range []string{"SQLMARK", "RESULTMARK", "USERMARK", tok, g.agent.URL, "127.0.0.1"} {
		if strings.Contains(g.logs.String(), s) {
			t.Fatalf("log chứa %q:\n%s", s, g.logs.String())
		}
	}
}

func TestUpstashBudget(t *testing.T) {
	var mu sync.Mutex
	var last []any
	var reply string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		var cmd []any
		if err := decodeJSON(r, &cmd); err != nil || r.Header.Get("Authorization") != "Bearer UT" {
			w.WriteHeader(401)
			return
		}
		last = cmd
		fmt.Fprint(w, reply)
	}))
	defer up.Close()
	b := NewUpstashBudget(up.URL, "UT")
	ctx := context.Background()
	reply = `{"result":null}`
	if d, err := b.Spent(ctx, "u"); err != nil || d != 0 {
		t.Fatalf("null: %v %v", d, err)
	}
	reply = `{"result":"123000"}`
	if d, err := b.Spent(ctx, "u"); err != nil || d != 123*time.Second {
		t.Fatalf("123000: %v %v", d, err)
	}
	if key := last[1].(string); strings.Contains(key, "u") && len(key) < 20 {
		t.Fatalf("khóa phải là mã băm: %q", key)
	}
	for _, bad := range []string{`{"result":"x"}`, `{"result":"-5"}`, `{"error":"ERR"}`, `junk`} {
		reply = bad
		if _, err := b.Spent(ctx, "u"); err == nil {
			t.Errorf("%s phải lỗi", bad)
		}
	}
	reply = `{"result":5000}`
	if err := b.Add(ctx, "u", 5*time.Second); err != nil || last[0] != "EVAL" || last[4] != "5000" {
		t.Fatalf("add: %v %v", err, last)
	}
	up.Close()
	if _, err := b.Spent(ctx, "u"); err == nil {
		t.Fatal("Upstash tắt phải lỗi")
	}
}

func TestMain(m *testing.M) { gin.SetMode(gin.TestMode); os.Exit(m.Run()) }

func decodeJSON(r *http.Request, v any) error { return json.NewDecoder(r.Body).Decode(v) }

func selfSigned(from, to time.Time) (*ecdsa.PrivateKey, []byte) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "t"}, NotBefore: from, NotAfter: to}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	return k, der
}

func startTLS(k *ecdsa.PrivateKey, der []byte, hits *atomic.Int32) *httptest.Server {
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: k}}}
	srv.StartTLS()
	return srv
}
