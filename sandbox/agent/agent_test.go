package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
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
	r := httptest.NewRequest(method, path, strings.NewReader(body))
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
	s, err := m.Get(c.ID)
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
