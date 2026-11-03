package quota

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// fakeUpstash implements only what quota uses: POST / with ["EVAL", script, "1", key, ttlMs]
// and replies {"result":[count,pttl]}, with a controllable clock for expiry.
type fakeUpstash struct {
	mu     sync.Mutex
	now    time.Time
	cnt    map[string]int64
	exp    map[string]time.Time
	calls  int
	keys   []string
	mode   string // "", "500", "hang", "garbage", "errfield"
	hangCh chan struct{}
}

func newFake() *fakeUpstash {
	return &fakeUpstash{now: time.Unix(1000, 0), cnt: map[string]int64{}, exp: map[string]time.Time{}, hangCh: make(chan struct{})}
}

func (f *fakeUpstash) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls++
	mode := f.mode
	f.mu.Unlock()
	switch mode {
	case "500":
		w.WriteHeader(500)
		return
	case "hang":
		select {
		case <-f.hangCh:
		case <-r.Context().Done():
		}
		return
	case "garbage":
		w.Write([]byte(`{"result":"oops"}`))
		return
	case "errfield":
		w.Write([]byte(`{"error":"ERR boom"}`))
		return
	}
	if r.Header.Get("Authorization") != "Bearer tok" {
		w.WriteHeader(401)
		return
	}
	var cmd []string
	if json.NewDecoder(r.Body).Decode(&cmd) != nil || len(cmd) != 5 || cmd[0] != "EVAL" || cmd[2] != "1" {
		w.WriteHeader(400)
		return
	}
	ms, _ := strconv.ParseInt(cmd[4], 10, 64)
	f.mu.Lock()
	defer f.mu.Unlock()
	k := cmd[3]
	f.keys = append(f.keys, k)
	if e, ok := f.exp[k]; ok && !f.now.Before(e) {
		delete(f.cnt, k)
		delete(f.exp, k)
	}
	f.cnt[k]++
	if f.cnt[k] == 1 {
		f.exp[k] = f.now.Add(time.Duration(ms) * time.Millisecond)
	}
	json.NewEncoder(w).Encode(map[string]any{"result": []int64{f.cnt[k], f.exp[k].Sub(f.now).Milliseconds()}})
}

func setup(t *testing.T, rules ...Rule) (*fakeUpstash, *gin.Engine) {
	gin.SetMode(gin.TestMode)
	f := newFake()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(f.hangCh) })
	l := New(srv.URL, "tok", nil)
	e := gin.New()
	uid := func(c *gin.Context) (string, bool) { u := c.GetHeader("X-U"); return u, u != "" }
	for _, r := range rules {
		e.GET("/"+r.Name, l.Middleware(r, uid), func(c *gin.Context) { c.Status(200) })
	}
	return f, e
}

func do(e *gin.Engine, path, user string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	if user != "" {
		req.Header.Set("X-U", user)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func TestLimitAndWindow(t *testing.T) { // AC1, AC6
	f, e := setup(t, Rule{"a", 3, time.Minute})
	for i := 1; i <= 3; i++ {
		if w := do(e, "/a", "u"); w.Code != 200 {
			t.Fatalf("req %d: %d", i, w.Code)
		}
	}
	w := do(e, "/a", "u")
	if w.Code != 429 || !strings.Contains(w.Body.String(), `"code":"quota_exceeded"`) {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if ra := w.Header().Get("Retry-After"); ra != "60" || w.Header().Get("X-Quota-Reset") == "" {
		t.Fatalf("Retry-After=%q", ra)
	}
	if f.calls != 4 {
		t.Fatalf("calls=%d, want 1 per request", f.calls)
	}
	f.mu.Lock()
	f.now = f.now.Add(time.Minute)
	f.mu.Unlock()
	if w := do(e, "/a", "u"); w.Code != 200 {
		t.Fatalf("new window: %d", w.Code)
	}
}

func TestConcurrent(t *testing.T) { // AC2
	_, e := setup(t, Rule{"a", 20, time.Hour})
	var mu sync.Mutex
	ok := 0
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if do(e, "/a", "u").Code == 200 {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if ok != 20 {
		t.Fatalf("passed %d, want 20", ok)
	}
}

func TestIsolation(t *testing.T) { // AC3
	f, e := setup(t, Rule{"a", 1, time.Hour}, Rule{"b", 1, time.Hour})
	if do(e, "/a", "u1").Code != 200 || do(e, "/a", "u1").Code != 429 {
		t.Fatal("u1/a")
	}
	if do(e, "/a", "u2").Code != 200 {
		t.Fatal("other user shares counter")
	}
	if do(e, "/b", "u1").Code != 200 {
		t.Fatal("other rule shares counter")
	}
	if len(f.cnt) != 3 {
		t.Fatalf("keys=%d", len(f.cnt))
	}
}

func TestFailClosed(t *testing.T) { // AC4
	for _, mode := range []string{"500", "garbage", "errfield", "hang"} {
		f, e := setup(t, Rule{"a", 5, time.Hour})
		f.mode = mode
		start := time.Now()
		w := do(e, "/a", "u")
		if w.Code != 503 || !strings.Contains(w.Body.String(), `"code":"quota_unavailable"`) {
			t.Fatalf("%s: %d %s", mode, w.Code, w.Body)
		}
		if mode == "hang" && time.Since(start) > 3*time.Second {
			t.Fatalf("timeout took %v", time.Since(start))
		}
	}
	l := New("http://127.0.0.1:1", "tok", nil)
	e := gin.New()
	e.GET("/", l.Middleware(Rule{"a", 5, time.Hour}, func(*gin.Context) (string, bool) { return "u", true }), func(c *gin.Context) { c.Status(200) })
	if w := do(e, "/", ""); w.Code != 503 {
		t.Fatalf("unreachable: %d", w.Code)
	}
}

func TestAuthRequired(t *testing.T) { // AC5
	f, e := setup(t, Rule{"a", 5, time.Hour})
	w := do(e, "/a", "")
	if w.Code != 401 || !strings.Contains(w.Body.String(), `"code":"auth_required"`) || f.calls != 0 {
		t.Fatalf("%d %s calls=%d", w.Code, w.Body, f.calls)
	}
}

func TestKeySafe(t *testing.T) {
	f, e := setup(t, Rule{"a", 5, time.Hour})
	do(e, "/a", "x DEL * ]"+strings.Repeat("A", 5000))
	if len(f.keys) != 1 || len(f.keys[0]) != len("quota:")+64 || strings.ContainsAny(f.keys[0], " *") {
		t.Fatalf("unsafe key %q", f.keys)
	}
}

func TestInvalidRulePanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("want panic")
		}
	}()
	New("http://x", "t", nil).Middleware(Rule{"a", 0, time.Hour}, nil)
}
