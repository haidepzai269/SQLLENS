package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fake struct {
	mu          sync.Mutex
	destroyed   []string
	inflight    atomic.Int32
	maxFlight   atomic.Int32
	disk        atomic.Int64
	stale       []string
	failDestroy bool
}

func (f *fake) be() backend {
	return backend{
		create: func(ctx context.Context, id string) error {
			n := f.inflight.Add(1)
			defer f.inflight.Add(-1)
			if n > f.maxFlight.Load() {
				f.maxFlight.Store(n)
			}
			time.Sleep(80 * time.Millisecond)
			return nil
		},
		destroy: func(id string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.failDestroy {
				return errors.New("docker treo")
			}
			f.destroyed = append(f.destroyed, id)
			return nil
		},
		dirSize: func(string) int64 { return f.disk.Load() },
		list:    func() []string { return f.stale },
	}
}

func (f *fake) destroyedCount() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.destroyed) }

func testCfg() config {
	return config{MaxSessions: 2, IdleTTL: time.Minute, Tick: 10 * time.Millisecond, QueryTimeout: time.Second, KillGrace: 50 * time.Millisecond, DiskLimit: 1 << 20, MaxRows: 10000, MaxCellBytes: 1 << 20}
}

func newTest(t *testing.T, cfg config) (*fake, *manager, http.Handler) {
	f := &fake{}
	m := newManager(cfg, f.be())
	return f, m, (&server{m: m, token: sha256.Sum256([]byte(strings.Repeat("t", 40)))}).handler()
}

func do(h http.Handler, method, path, tok, body string) *httptest.ResponseRecorder {
	return doAs(h, "u1", method, path, tok, body)
}

func doAs(h http.Handler, user, method, path, tok, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		r.Header.Set(userHeader, user)
	}
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

var good = strings.Repeat("t", 40)

func TestAuthAndNoLeak(t *testing.T) {
	_, _, h := newTest(t, testCfg())
	w := do(h, "POST", "/sessions", good, "")
	var created struct{ ID string }
	json.Unmarshal(w.Body.Bytes(), &created)
	if w.Code != 201 || created.ID == "" {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	for _, tok := range []string{"", "sai", strings.Repeat("t", 39)} {
		for _, id := range []string{created.ID, strings.Repeat("0", 30)} { // phiên có thật và không có: cùng 401
			if w := do(h, "GET", "/sessions/"+id+"/locks", tok, ""); w.Code != 401 || strings.Contains(w.Body.String(), "session") {
				t.Fatalf("tok=%q id=%s: %d %s", tok, id, w.Code, w.Body)
			}
		}
	}
	// token đúng, id lạ hoặc sai dạng: cùng 404 và cùng thân
	a := do(h, "DELETE", "/sessions/"+strings.Repeat("0", 30), good, "")
	b := do(h, "DELETE", "/sessions/xyz", good, "")
	if a.Code != 404 || b.Code != 404 || a.Body.String() != b.Body.String() {
		t.Fatalf("404: %d %d", a.Code, b.Code)
	}
	if w := do(h, "GET", "/healthz", "", ""); w.Code != 200 || strings.Contains(w.Body.String(), "session") {
		t.Fatalf("healthz: %d %s", w.Code, w.Body)
	}
}

func TestCapacityAndSerialStart(t *testing.T) {
	f, _, h := newTest(t, testCfg())
	codes := make([]int, 3)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func() { defer wg.Done(); codes[i] = do(h, "POST", "/sessions", good, "").Code }()
	}
	wg.Wait()
	ok, full := 0, 0
	for _, c := range codes {
		switch c {
		case 201:
			ok++
		case 429:
			full++
		}
	}
	if ok != 2 || full != 1 {
		t.Fatalf("codes=%v", codes)
	}
	if f.maxFlight.Load() != 1 {
		t.Fatalf("khởi động chồng nhau: %d", f.maxFlight.Load())
	}
}

func TestExpiryAndDiskQuota(t *testing.T) {
	cfg := testCfg()
	cfg.IdleTTL = 60 * time.Millisecond
	f, m, h := newTest(t, cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.janitor(ctx)
	var c struct{ ID string }
	json.Unmarshal(do(h, "POST", "/sessions", good, "").Body.Bytes(), &c)
	time.Sleep(300 * time.Millisecond)
	if f.destroyedCount() != 1 || do(h, "DELETE", "/sessions/"+c.ID, good, "").Code != 404 {
		t.Fatal("phiên hết hạn chưa bị hủy")
	}
	// hạn mức đĩa
	cfg.IdleTTL = time.Hour
	f2, m2, h2 := newTest(t, cfg)
	go m2.janitor(ctx)
	json.Unmarshal(do(h2, "POST", "/sessions", good, "").Body.Bytes(), &c)
	f2.disk.Store(cfg.DiskLimit + 1)
	time.Sleep(200 * time.Millisecond)
	if f2.destroyedCount() != 1 {
		t.Fatal("phiên vượt đĩa chưa bị hủy")
	}
	// slot được trả sau khi hủy
	if w := do(h2, "POST", "/sessions", good, ""); w.Code != 201 {
		t.Fatalf("slot không được trả: %d", w.Code)
	}
}

func TestBodyLimitAndLogHasNoSQL(t *testing.T) {
	_, _, h := newTest(t, testCfg())
	var c struct{ ID string }
	json.Unmarshal(do(h, "POST", "/sessions", good, "").Body.Bytes(), &c)
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	big := `{"sql":"` + strings.Repeat("x", 1<<20+10) + `"}`
	if w := do(h, "POST", "/sessions/"+c.ID+"/query", good, big); w.Code != 413 {
		t.Fatalf("body lớn: %d", w.Code)
	}
	if w := do(h, "POST", "/sessions/"+c.ID+"/query", good, `{"sql":"SELECT secret_marker_42","connection":"c"}`); w.Code != 400 {
		t.Fatalf("connection sai: %d", w.Code)
	}
	if w := do(h, "POST", "/sessions/"+c.ID+"/query", good, `{"sql":"  "}`); w.Code != 400 {
		t.Fatalf("sql rỗng: %d", w.Code)
	}
	if strings.Contains(buf.String(), "secret_marker_42") || strings.Contains(buf.String(), c.ID) {
		t.Fatalf("log lộ SQL hoặc id đầy đủ:\n%s", buf.String())
	}
}

func TestCleanupStaleAndCell(t *testing.T) {
	f, m, _ := newTest(t, testCfg())
	f.stale = []string{"aaa", "bbb"}
	m.cleanupStale()
	if f.destroyedCount() != 2 {
		t.Fatal("không dọn phiên sót")
	}
	if cell(int64(1<<53+1)) != "9007199254740993" || cell([]byte("ok")) != "ok" || cell(int64(5)) != int64(5) {
		t.Fatal("cell")
	}
	if got := cell([]byte{0xff, 'a'}).(string); !strings.HasSuffix(got, "a") || strings.Contains(got, "\xff") {
		t.Fatal("utf8")
	}
}

func TestDirBytes(t *testing.T) {
	d := t.TempDir()
	if dirBytes(d) < 0 {
		t.Fatal()
	}
}

// M1: destroy lỗi thì không trả slot; sau khi sửa được, sweep dọn nốt rồi mới trả slot.
func TestDestroyFailureKeepsSlot(t *testing.T) {
	f, m, h := newTest(t, testCfg())
	var ids []string
	for i := 0; i < 2; i++ {
		var c struct{ ID string }
		json.Unmarshal(do(h, "POST", "/sessions", good, "").Body.Bytes(), &c)
		ids = append(ids, c.ID)
	}
	f.mu.Lock()
	f.failDestroy = true
	f.mu.Unlock()
	if w := do(h, "DELETE", "/sessions/"+ids[0], good, ""); w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
	if w := do(h, "POST", "/sessions", good, ""); w.Code != 429 {
		t.Fatalf("slot bị trả khi container còn: %d", w.Code)
	}
	f.mu.Lock()
	f.failDestroy = false
	f.mu.Unlock()
	m.sweep()
	time.Sleep(100 * time.Millisecond)
	if w := do(h, "POST", "/sessions", good, ""); w.Code != 201 {
		t.Fatalf("slot không được trả sau khi dọn xong: %d", w.Code)
	}
}

// N1/N3: phiên Create lỗi mà destroy lỗi, và phiên sót lúc khởi động mà destroy lỗi, đều được sweep dọn lại.
func TestStaleAndFailedCreateRetried(t *testing.T) {
	f, m, _ := newTest(t, testCfg())
	f.stale = []string{"old1"}
	f.mu.Lock()
	f.failDestroy = true
	f.mu.Unlock()
	m.cleanupStale()
	if len(m.s) != 1 {
		t.Fatal("phiên sót không được giữ lại")
	}
	f.mu.Lock()
	f.failDestroy = false
	f.mu.Unlock()
	m.sweep()
	time.Sleep(100 * time.Millisecond)
	if len(m.s) != 0 || f.destroyedCount() != 1 {
		t.Fatalf("sweep không dọn: %d %d", len(m.s), f.destroyedCount())
	}
	s := &session{id: "x", closed: true, cn: map[string]*userConn{}} // ready=false, closed=true
	m.s["x"] = s
	m.sweep()
	time.Sleep(100 * time.Millisecond)
	if len(m.s) != 0 {
		t.Fatal("phiên Create lỗi không được dọn")
	}
}

// Task037: câu không chịu dừng sau KILL QUERY thì phiên bị hủy; câu đã dừng thì phiên ở lại.
func TestEscalateStuckQuery(t *testing.T) {
	f, m, h := newTest(t, testCfg())
	var c struct{ ID string }
	json.Unmarshal(do(h, "POST", "/sessions", good, "").Body.Bytes(), &c)
	own, _ := ownerOf(func() *http.Request {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set(userHeader, "u1")
		return r
	}())
	s, err := m.Get(c.ID, own)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	close(done)
	m.escalate(s, done)
	if f.destroyedCount() != 0 {
		t.Fatal("câu đã xong mà phiên bị hủy")
	}
	m.escalate(s, make(chan struct{})) // không bao giờ xong
	if f.destroyedCount() != 1 {
		t.Fatal("câu kẹt mà phiên không bị hủy")
	}
}

// Task074 AC2: người dùng khác, kể cả khi đoán đúng id, nhận cùng 404 như phiên không tồn tại.
func TestOwnerIsolation(t *testing.T) {
	_, m, h := newTest(t, testCfg())
	var c struct{ ID string }
	json.Unmarshal(do(h, "POST", "/sessions", good, "").Body.Bytes(), &c)
	ghost := strings.Repeat("0", 30)
	for _, tc := range []struct{ method, suffix, body string }{
		{"POST", "/query", `{"sql":"select 1"}`}, {"GET", "/locks", ""}, {"DELETE", "", ""},
	} {
		a := doAs(h, "u2", tc.method, "/sessions/"+c.ID+tc.suffix, good, tc.body)
		b := doAs(h, "u2", tc.method, "/sessions/"+ghost+tc.suffix, good, tc.body)
		if a.Code != 404 || a.Code != b.Code || a.Body.String() != b.Body.String() {
			t.Fatalf("%s%s: %d %s vs %d %s", tc.method, tc.suffix, a.Code, a.Body, b.Code, b.Body)
		}
	}
	if len(m.s) != 1 {
		t.Fatal("người khác hủy được phiên")
	}
	// thiếu header user: 400, không phải 404
	if w := doAs(h, "", "GET", "/sessions/"+c.ID+"/locks", good, ""); w.Code != 400 {
		t.Fatalf("thiếu header: %d", w.Code)
	}
	if w := doAs(h, strings.Repeat("x", 129), "POST", "/sessions", good, ""); w.Code != 400 {
		t.Fatalf("header quá dài: %d", w.Code)
	}
	if o := m.s[c.ID].owner; strings.Contains(o, "u1") || len(o) != 64 {
		t.Fatalf("owner phải là mã băm: %q", o)
	}
}

// Task074 AC3: hai yêu cầu tạo phiên đồng thời của một người chỉ một cái lọt; người khác vẫn tạo được.
func TestPerOwnerLimit(t *testing.T) {
	cfg := testCfg()
	cfg.MaxPerOwner = 1
	_, _, h := newTest(t, cfg)
	codes := make([]int, 2)
	var wg sync.WaitGroup
	for i := range codes {
		wg.Add(1)
		go func() { defer wg.Done(); codes[i] = do(h, "POST", "/sessions", good, "").Code }()
	}
	wg.Wait()
	if !(codes[0] == 201 && codes[1] == 429 || codes[0] == 429 && codes[1] == 201) {
		t.Fatalf("codes=%v", codes)
	}
	if w := doAs(h, "u2", "POST", "/sessions", good, ""); w.Code != 201 {
		t.Fatalf("người khác: %d %s", w.Code, w.Body)
	}
}

// Task074 AC4: log không chứa user id gốc, token hay SQL.
func TestNoSecretsInLog(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)
	_, _, h := newTest(t, testCfg())
	var c struct{ ID string }
	doAs(h, "USERMARK-123", "POST", "/sessions", good, "")
	json.Unmarshal(doAs(h, "USERMARK-123", "POST", "/sessions", good, "").Body.Bytes(), &c)
	doAs(h, "USERMARK-123", "POST", "/sessions/"+c.ID+"/query", good, `{"sql":"SELECT 'SQLMARK'","connection":"z"}`)
	do(h, "GET", "/sessions/"+c.ID+"/locks", "TOKMARK", "")
	for _, s := range []string{"USERMARK", "SQLMARK", "TOKMARK", good} {
		if strings.Contains(buf.String(), s) {
			t.Fatalf("log chứa %q:\n%s", s, buf.String())
		}
	}
}

// Task074 AC6: chứng chỉ tự sinh, khóa 600, vân tay khớp chứng chỉ máy chủ trình ra qua TLS.
func TestTLSCertAndServe(t *testing.T) {
	dir := t.TempDir()
	if err := genCert(dir, false); err != nil {
		t.Fatal(err)
	}
	fp1, _ := fingerprint(dir)
	genCert(dir, false) // không ghi đè
	if fp2, _ := fingerprint(dir); fp1 != fp2 {
		t.Fatal("genCert ghi đè khi không rotate")
	}
	_, keyP := certPaths(dir)
	if runtime.GOOS == "linux" {
		if st, _ := os.Stat(keyP); st.Mode().Perm() != 0o600 {
			t.Fatalf("quyền khóa: %v", st.Mode().Perm())
		}
		os.Chmod(keyP, 0o644)
		if _, err := loadTLS(dir); err == nil {
			t.Fatal("khóa quyền rộng phải bị từ chối")
		}
		os.Chmod(keyP, 0o600)
	}
	tc, err := loadTLS(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, _, h := newTest(t, testCfg())
	ts := httptest.NewUnstartedServer(h)
	ts.TLS = tc
	ts.StartTLS()
	defer ts.Close()
	got := sha256.Sum256(ts.TLS.Certificates[0].Certificate[0])
	if hex.EncodeToString(got[:]) != fp1 {
		t.Fatal("vân tay không khớp")
	}
	if genCert(dir, true); func() string { f, _ := fingerprint(dir); return f }() == fp1 {
		t.Fatal("rotate phải đổi chứng chỉ")
	}
}
