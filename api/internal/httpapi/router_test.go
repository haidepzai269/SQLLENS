package httpapi

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestHealthz(t *testing.T) {
	w := httptest.NewRecorder()
	NewRouter().ServeHTTP(w, httptest.NewRequest("GET", "/healthz", nil))
	if w.Code != 200 || w.Body.String() != `{"status":"ok"}` {
		t.Fatalf("got %d %q", w.Code, w.Body.String())
	}
}

func TestReleaseModeByDefault(t *testing.T) {
	t.Setenv("GIN_MODE", "")
	gin.SetMode(gin.DebugMode)
	NewRouter()
	if gin.Mode() != gin.ReleaseMode {
		t.Fatalf("mode %s", gin.Mode())
	}
}

// Shutdown waits for an in-flight request instead of killing it.
func TestServeGracefulShutdown(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	started := make(chan struct{})
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond)
		w.Write([]byte("done"))
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, ln, h, 5*time.Second) }()

	resp := make(chan string, 1)
	go func() {
		r, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			resp <- err.Error()
			return
		}
		defer r.Body.Close()
		b := make([]byte, 4)
		r.Body.Read(b)
		resp <- string(b)
	}()
	<-started
	cancel()
	if got := <-resp; got != "done" {
		t.Fatalf("in-flight request got %q", got)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
