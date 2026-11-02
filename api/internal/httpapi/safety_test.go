package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const mark = "SECRET_SQL_MARK"

func testRouter() (*gin.Engine, *bytes.Buffer) {
	var buf bytes.Buffer
	r := NewRouterWithLog(&buf)
	r.POST("/echo/:id", func(c *gin.Context) {
		if _, err := io.ReadAll(c.Request.Body); err != nil {
			c.Error(err)
			return
		}
		c.Status(200)
	})
	r.POST("/boom", func(c *gin.Context) {
		b, _ := io.ReadAll(c.Request.Body)
		panic(string(b))
	})
	return r, &buf
}

func do(r http.Handler, method, target, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, target, strings.NewReader(body)))
	return w
}

func wantErr(t *testing.T, w *httptest.ResponseRecorder, status int, code, key string) {
	t.Helper()
	want := `{"error":{"code":"` + code + `","messageKey":"` + key + `"}}`
	if w.Code != status || w.Body.String() != want {
		t.Fatalf("got %d %q want %d %q", w.Code, w.Body.String(), status, want)
	}
}

func TestAC1LogHasNoUserData(t *testing.T) {
	r, buf := testRouter()
	req := httptest.NewRequest("POST", "/echo/"+mark+"?q="+mark, strings.NewReader("SELECT "+mark))
	req.Header.Set("Authorization", "Bearer "+mark)
	req.Header.Set("Cookie", "s="+mark)
	r.ServeHTTP(httptest.NewRecorder(), req)
	do(r, "GET", "/nope/"+mark+"?q="+mark, "")
	do(r, mark, "/x", "") // custom method token
	if buf.Len() == 0 || strings.Contains(buf.String(), mark) {
		t.Fatalf("log: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "POST /echo/:id 200") || !strings.Contains(buf.String(), "GET unmatched 404") {
		t.Fatalf("log lacks route/status: %q", buf.String())
	}
}

func TestAC2PanicSafe(t *testing.T) {
	r, buf := testRouter()
	w := do(r, "POST", "/boom?q="+mark, "SELECT "+mark)
	wantErr(t, w, 500, "internal", "error.internal")
	if strings.Contains(w.Body.String(), mark) || strings.Contains(buf.String(), mark) {
		t.Fatalf("leak: %q %q", w.Body.String(), buf.String())
	}
	if !strings.Contains(buf.String(), "POST /boom 500") {
		t.Fatalf("log: %q", buf.String())
	}
}

func TestAC3NotFoundAndMethod(t *testing.T) {
	r, _ := testRouter()
	wantErr(t, do(r, "GET", "/khong-co", ""), 404, "not_found", "error.notFound")
	wantErr(t, do(r, "POST", "/healthz", ""), 405, "method_not_allowed", "error.methodNotAllowed")
	wantErr(t, do(r, "GET", "/healthz/", ""), 404, "not_found", "error.notFound")
}

func TestAC4BodyLimit(t *testing.T) {
	r, _ := testRouter()
	big := strings.Repeat("a", 2<<20)
	wantErr(t, do(r, "POST", "/echo/1", big), 413, "payload_too_large", "error.payloadTooLarge")
	// unknown length (chunked): caught while reading
	req := httptest.NewRequest("POST", "/echo/1", io.NopCloser(strings.NewReader(big)))
	req.ContentLength = -1
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	wantErr(t, w, 413, "payload_too_large", "error.payloadTooLarge")
	if w := do(r, "POST", "/echo/1", strings.Repeat("a", MaxBodyBytes)); w.Code != 200 {
		t.Fatalf("exact limit: %d", w.Code)
	}
}
