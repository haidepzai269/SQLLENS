package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haidepzai269/SQLLENS/api/internal/store"
	"github.com/haidepzai269/SQLLENS/api/migrations"
)

// Test signaling WebSocket (Task163). Cần Postgres thật:
//   $env:RLS_TEST_DSN="postgres://postgres:t152@localhost:54494/app163"; cd api
//   go test -p 1 ./internal/httpapi -run RoomSignal -v

const signalMark = "ZZSIGNALSQL"

// signalDSN lấy DSN từ biến môi trường của bộ test RLS (hoặc T149/T150 nếu phiên chạy đặt tên đó).
func signalDSN() string {
	for _, k := range []string{"RLS_TEST_DSN", "T149_DATABASE_URL", "T150_DATABASE_URL"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

// syncBuf là log writer an toàn cho -race: requestLog ghi từ goroutine của server, test đọc từ
// goroutine của test.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

type signalEnv struct {
	srv   *httptest.Server
	hub   *signalHub
	log   *syncBuf
	st    *store.Store
	user  string // chủ dự án
	peer  string // thành viên dự án
	other string // người ngoài
	room  string // dự án 1
	room2 string // dự án 2
}

// newSignalEnv dựng database thật, router thật và hub đo được, với hạn sống mặc định.
func newSignalEnv(t *testing.T) *signalEnv { return newSignalEnvLifetime(t, signalLifetime) }

// newSignalEnvLifetime như newSignalEnv nhưng tiêm hạn sống, để test T4 đo được trần thời gian
// sống mà không phải chờ 30 phút.
func newSignalEnvLifetime(t *testing.T, lifetime time.Duration) *signalEnv {
	t.Helper()
	url := signalDSN()
	if url == "" {
		t.Skip("bỏ qua: chưa đặt RLS_TEST_DSN (cần Postgres trong Docker)")
	}
	ctx := context.Background()
	raw, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(raw.Close)
	// Cùng danh sách bảng với newCloudEnv: hai bộ test trong một package dùng chung database.
	if _, err := raw.Exec(ctx, `DROP TABLE IF EXISTS `+migrations.DropAllTablesSQL+` CASCADE`); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	e := &signalEnv{st: st, log: &syncBuf{}, hub: newSignalHub()}
	// Gom cả log mặc định (log.Printf của handler) vào cùng buffer với log Gin. Không có bước
	// này thì AC4 chỉ soi được log Gin, còn một lời gọi log.Printf trong handler sẽ lọt lưới.
	prevLog, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(e.log)
	t.Cleanup(func() { log.SetOutput(prevLog); log.SetFlags(prevFlags) })
	for _, tc := range []struct {
		name string
		dst  *string
	}{
		{"chu-du-an", &e.user}, {"thanh-vien", &e.peer}, {"nguoi-ngoai", &e.other},
	} {
		if err := raw.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ($1) RETURNING id::text`, tc.name).Scan(tc.dst); err != nil {
			t.Fatal(err)
		}
	}
	// Dựng dự án bằng SQL thẳng: test này không kiểm handler cloud, chỉ cần hai phòng có thật.
	if err := raw.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine)
		VALUES ($1, 'Phòng 1', 'postgres') RETURNING id::text`, e.user).Scan(&e.room); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine)
		VALUES ($1, 'Phòng 2', 'postgres') RETURNING id::text`, e.user).Scan(&e.room2); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')`,
		e.room, e.peer); err != nil {
		t.Fatal(err)
	}

	r := NewRouterWithLog(e.log)
	guard := func(c *gin.Context) {
		u := c.GetHeader("X-Test-User")
		if u == "" {
			Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
			return
		}
		c.Set("test.user", u)
		c.Next()
	}
	mountRoomSignal(r, RoomSignalConfig{Store: st, RequireUser: guard, UID: func(c *gin.Context) string {
		v, _ := c.Get("test.user")
		s, _ := v.(string)
		return s
	}}, e.hub, lifetime)
	e.srv = httptest.NewServer(r)
	t.Cleanup(e.srv.Close)
	return e
}

// dial mở socket tới phòng của một người dùng; trả conn, phản hồi handshake và lỗi.
// Client đặt trần đọc riêng 1 MB: mặc định của coder/websocket là 32 KB, thấp hơn trần 64 KB của
// server, nên không đặt thì ca biên 60 KB sẽ chết ở phía client và test đo sai chỗ.
func (e *signalEnv) dial(t *testing.T, user, room string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	h := http.Header{}
	if user != "" {
		h.Set("X-Test-User", user)
	}
	url := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/api/v1/cloud/projects/" + room + "/signal"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: h})
	if c != nil {
		c.SetReadLimit(1 << 20)
	}
	return c, resp, err
}

// mustDial mở socket và đóng nó khi test xong.
func (e *signalEnv) mustDial(t *testing.T, user, room string) *websocket.Conn {
	t.Helper()
	c, resp, err := e.dial(t, user, room)
	if err != nil {
		code := 0
		if resp != nil {
			code = resp.StatusCode
		}
		t.Fatalf("dial %s phòng %s: %v (HTTP %d)", user, room, err, code)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	return c
}

func (e *signalEnv) write(t *testing.T, c *websocket.Conn, msg string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// read có hạn chờ: hết hạn trả lỗi để test âm tính khẳng định được "không nhận".
func readWithin(c *websocket.Conn, d time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	_, data, err := c.Read(ctx)
	return string(data), err
}

// waitPeers đo hub tới khi đúng số peer mong đợi, thay vì đoán.
func (e *signalEnv) waitPeers(t *testing.T, room string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got := e.hub.size(room)
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("hub phòng %s có %d peer, mong đợi %d", room, got, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// AC1: handshake 101 và nội dung đi qua socket đúng từng byte.
func TestRoomSignalHandshake(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)

	// Handshake phải là 101, không phải 200 hay 426.
	c, resp, err := e.dial(t, e.user, e.room)
	if err != nil {
		t.Fatalf("dial thứ ba: %v", err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("handshake = %d, mong đợi 101", resp.StatusCode)
	}

	msg := `{"type":"offer","sdp":"v=0\r\no=- 1 1 IN IP4 127.0.0.1"}`
	e.write(t, a, msg)
	got, err := readWithin(b, 5*time.Second)
	if err != nil {
		t.Fatalf("B không nhận được message: %v", err)
	}
	if got != msg {
		t.Fatalf("B nhận %q, mong đợi %q", got, msg)
	}
}

// AC2: A gửi thì B cùng phòng nhận, C phòng khác không nhận, và chính A không nhận lại
// (hợp đồng: chuyển tiếp cho các peer *khác*).
func TestRoomSignalRelay(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	c := e.mustDial(t, e.user, e.room2)
	e.waitPeers(t, e.room, 2)
	e.waitPeers(t, e.room2, 1)

	e.write(t, a, `{"type":"offer","sdp":"abc"}`)
	got, err := readWithin(b, 5*time.Second)
	if err != nil || !strings.Contains(got, `"sdp":"abc"`) {
		t.Fatalf("B cùng phòng phải nhận offer: %q (%v)", got, err)
	}

	// C ở phòng khác: hết hạn chờ mà không có gì. Đây là phép đo dương tính của "không nhận".
	if got, err := readWithin(c, 400*time.Millisecond); err == nil {
		t.Fatalf("C ở phòng khác nhận được message của phòng 1: %q", got)
	}

	// A là người gửi: không được nhận lại message của chính mình. Bỏ `p == from` trong relay thì
	// khẳng định này đỏ.
	if got, err := readWithin(a, 400*time.Millisecond); err == nil {
		t.Fatalf("A nhận lại message của chính mình: %q", got)
	}
}

// AC3: chưa đăng nhập 401; đã đăng nhập nhưng không phải thành viên 404; không có 101.
func TestRoomSignalRequiresAuth(t *testing.T) {
	e := newSignalEnv(t)

	_, resp, err := e.dial(t, "", e.room)
	if err == nil {
		t.Fatal("chưa đăng nhập mà vẫn mở được socket")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("không cookie: HTTP %v, mong đợi 401", resp)
	}

	_, resp, err = e.dial(t, e.other, e.room)
	if err == nil {
		t.Fatal("người ngoài phòng vẫn mở được socket")
	}
	if resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("người ngoài phòng: HTTP %v, mong đợi 404 (không lộ dự án tồn tại)", resp)
	}

	// Thành viên thật thì mở được — nếu không, 404 ở trên không chứng minh được gì.
	c := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 1)
	if err := c.Close(websocket.StatusNormalClosure, ""); err != nil {
		t.Logf("đóng socket: %v", err)
	}
}

// AC4 (Nguyên tắc 7): message chứa chuỗi giống SQL không được xuất hiện trong log Gin.
func TestRoomSignalZeroSQLInLog(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)

	e.write(t, a, `{"type":"chat","sql":"`+signalMark+` SELECT * FROM users"}`)
	if _, err := readWithin(b, 5*time.Second); err != nil {
		t.Fatalf("B phải nhận message: %v", err)
	}
	_ = a.Close(websocket.StatusNormalClosure, "")
	_ = b.Close(websocket.StatusNormalClosure, "")
	e.waitPeers(t, e.room, 0)

	// requestLog ghi sau khi handler trả về, nên phải chờ dòng log xuất hiện.
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(e.log.String(), "/api/v1/cloud/projects/:id/signal") {
		if time.Now().After(deadline) {
			t.Fatalf("không thấy dòng log của route trong %q", e.log.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if strings.Contains(e.log.String(), signalMark) {
		t.Fatalf("log chứa nội dung message (Nguyên tắc 7): %q", e.log.String())
	}
}

// AC5: đúng một route, không panic trùng handler, và đường dẫn khớp rule rewrite hẹp đọc từ
// web/next.config.ts (không chép tay chuỗi).
func TestRoomSignalRoutes(t *testing.T) {
	const path = "/api/v1/cloud/projects/:id/signal"
	r := NewRouterWithLog(&syncBuf{})
	mountRoomSignal(r, RoomSignalConfig{Store: nil, RequireUser: func(*gin.Context) {}}, newSignalHub(), signalLifetime)

	n := 0
	for _, rt := range r.Routes() {
		if rt.Path == path {
			n++
			if rt.Method != http.MethodGet {
				t.Fatalf("method = %s, mong đợi GET", rt.Method)
			}
		}
	}
	if n != 1 {
		t.Fatalf("có %d route %s, mong đợi đúng 1", n, path)
	}

	cfg, err := os.ReadFile("../../../web/next.config.ts")
	if err != nil {
		t.Fatalf("không đọc được web/next.config.ts: %v", err)
	}
	re := regexp.MustCompile(`source:\s*["']([^"']+)["']`)
	var rule string
	for _, m := range re.FindAllStringSubmatch(string(cfg), -1) {
		if strings.HasPrefix(m[1], "/api/v1/cloud/") && strings.HasSuffix(m[1], ":path*") {
			if rule != "" {
				t.Fatalf("có nhiều hơn một rule cloud: %q và %q", rule, m[1])
			}
			rule = m[1]
		}
	}
	if rule == "" {
		t.Fatal("không thấy rule rewrite hẹp /api/v1/cloud/:path* trong web/next.config.ts")
	}
	if !strings.HasPrefix(path, strings.TrimSuffix(rule, ":path*")) {
		t.Fatalf("route %s không khớp rule rewrite %s", path, rule)
	}
}

// AC6: peer ngắt kết nối bị xoá khỏi hub, và phòng rỗng bị xoá khỏi bản đồ (đo, không đoán).
func TestRoomSignalPeerCleanup(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)

	_ = a.Close(websocket.StatusNormalClosure, "")
	e.waitPeers(t, e.room, 1)
	_ = b.Close(websocket.StatusNormalClosure, "")
	e.waitPeers(t, e.room, 0)

	e.hub.mu.Lock()
	rooms := len(e.hub.rooms)
	e.hub.mu.Unlock()
	if rooms != 0 {
		t.Fatalf("hub còn %d phòng sau khi mọi peer rời, mong đợi 0", rooms)
	}
}

// Ca biên: message 65 KB bị đóng 1009, peer khác trong phòng vẫn sống.
func TestRoomSignalOversizeMessage(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	c := e.mustDial(t, e.user, e.room)
	e.waitPeers(t, e.room, 3)

	e.write(t, a, strings.Repeat("x", 65<<10))
	if _, err := readWithin(a, 5*time.Second); websocket.CloseStatus(err) != websocket.StatusMessageTooBig {
		t.Fatalf("peer gửi message 65 KB phải bị đóng 1009, nhận %v", err)
	}

	// Hub không sập: hai peer còn lại vẫn chuyển tiếp được.
	e.write(t, b, `{"type":"ice"}`)
	if got, err := readWithin(c, 5*time.Second); err != nil || !strings.Contains(got, `"ice"`) {
		t.Fatalf("peer khác phải sống sau khi peer kia bị đóng: %q (%v)", got, err)
	}
}

// Ca biên: message 60 KB (dưới trần 64 KB) phải qua nguyên vẹn. Ca này phân biệt trần 64 KB của
// server với trần mặc định 32 KB của coder/websocket: bỏ `SetReadLimit(maxSignalBytes)` thì
// message 60 KB chết trong khi ca 65 KB ở trên vẫn "đúng" vì cả hai mốc đều vượt.
func TestRoomSignalLargeMessagePasses(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)

	msg := `{"type":"offer","sdp":"` + strings.Repeat("y", 60<<10) + `"}`
	e.write(t, a, msg)
	got, err := readWithin(b, 10*time.Second)
	if err != nil {
		t.Fatalf("message 60 KB (dưới trần 64 KB) phải qua được: %v", err)
	}
	if len(got) != len(msg) {
		t.Fatalf("message 60 KB bị cắt: nhận %d byte, gửi %d byte", len(got), len(msg))
	}
}

// T1: đóng kết nối không được giữ khoá hub. `Conn.Close` chạy bắt tay đóng với hạn 5 giây, nên
// nếu leave giữ h.mu suốt lúc đó thì một client không đọc làm đứng signaling của mọi phòng.
// Đo trực tiếp: peer không đọc tự kích hoạt leave, rồi đo thời gian hub trả lời được.
func TestRoomSignalCloseDoesNotHoldLock(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room) // không bao giờ đọc: không trả lời bắt tay đóng
	e.waitPeers(t, e.room, 1)

	// JSON hỏng làm server rời vòng đọc rồi gọi leave. Client không đọc nên bắt tay đóng treo.
	e.write(t, a, `{not json`)

	start := time.Now()
	e.waitPeers(t, e.room, 0) // waitPeers lấy h.mu; giữ khoá khi đóng thì đây là chỗ chờ
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("hub bị khoá %v trong lúc đóng kết nối, mong đợi dưới 2s", d)
	}
}

// T4: kết nối có hạn sống. Tiêm hạn ngắn để đo được, không phải chờ 30 phút.
func TestRoomSignalLifetime(t *testing.T) {
	e := newSignalEnvLifetime(t, 500*time.Millisecond)
	a := e.mustDial(t, e.user, e.room)
	e.waitPeers(t, e.room, 1)

	_, err := readWithin(a, 5*time.Second)
	if err == nil {
		t.Fatal("socket vẫn sống sau khi hết hạn sống")
	}
	if code := websocket.CloseStatus(err); code != websocket.StatusGoingAway {
		t.Fatalf("hết hạn sống phải đóng 1001 Going Away, nhận %v", code)
	}
	e.waitPeers(t, e.room, 0) // và peer phải bị xoá khỏi hub
}

// D3: `to` so theo user id, nên hai tab của cùng một người đều nhận. Đây là hợp đồng có kiểm,
// không phải lỗi ngầm: payload là JSON tự do nên client phải mang id tab của chính nó và tab
// nhận tự lọc. Đổi sang peer id đòi server cấp id + kênh presence, thuộc task sau.
func TestRoomSignalTargetUserReachesAllTabs(t *testing.T) {
	e := newSignalEnv(t)
	tab1 := e.mustDial(t, e.user, e.room)
	tab2 := e.mustDial(t, e.user, e.room)
	sender := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 3)

	e.write(t, sender, `{"to":"`+e.user+`","type":"offer","tab":"t1"}`)
	for i, tab := range []*websocket.Conn{tab1, tab2} {
		got, err := readWithin(tab, 5*time.Second)
		if err != nil || !strings.Contains(got, `"tab":"t1"`) {
			t.Fatalf("tab %d của user đích phải nhận message có to trỏ user đó: %q (%v)", i+1, got, err)
		}
	}
}

// Ca biên: JSON hỏng bị đóng 1007, hub không panic, peer khác vẫn sống.
func TestRoomSignalMalformedJSON(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	c := e.mustDial(t, e.user, e.room)
	e.waitPeers(t, e.room, 3)

	e.write(t, a, `{not json`)
	if _, err := readWithin(a, 5*time.Second); websocket.CloseStatus(err) != websocket.StatusInvalidFramePayloadData {
		t.Fatalf("JSON hỏng phải bị đóng 1007, nhận %v", err)
	}
	e.write(t, b, `{"type":"ice"}`)
	if got, err := readWithin(c, 5*time.Second); err != nil || !strings.Contains(got, `"ice"`) {
		t.Fatalf("peer khác phải sống sau JSON hỏng: %q (%v)", got, err)
	}
}

// Ca biên: `to` trỏ peer không tồn tại thì bỏ qua, không lỗi, không tới peer khác.
func TestRoomSignalTargetMissing(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)

	e.write(t, a, `{"to":"00000000-0000-0000-0000-000000000000","type":"offer"}`)
	e.write(t, a, `{"type":"after"}`)
	got, err := readWithin(b, 5*time.Second)
	if err != nil {
		t.Fatalf("peer khác phải nhận message phát rộng sau đó: %v", err)
	}
	if !strings.Contains(got, `"after"`) {
		t.Fatalf("message có to trỏ peer không tồn tại bị phát nhầm cho người khác: %q", got)
	}
}

// Ca biên: peer vào sau không nhận lại message cũ (server không đệm lịch sử).
func TestRoomSignalNoHistory(t *testing.T) {
	e := newSignalEnv(t)
	a := e.mustDial(t, e.user, e.room)
	e.waitPeers(t, e.room, 1)

	e.write(t, a, `{"type":"offer","sdp":"cu"}`)
	time.Sleep(100 * time.Millisecond) // cho hub xử lý xong message của A

	b := e.mustDial(t, e.peer, e.room)
	e.waitPeers(t, e.room, 2)
	if got, err := readWithin(b, 400*time.Millisecond); err == nil {
		t.Fatalf("peer vào sau nhận được message cũ: %q", got)
	}
}

// Ca biên: phòng đầy thì peer thứ 17 bị từ chối 429, không mở socket.
func TestRoomSignalRoomFull(t *testing.T) {
	e := newSignalEnv(t)
	for i := 0; i < maxRoomPeers; i++ {
		e.mustDial(t, e.user, e.room)
	}
	e.waitPeers(t, e.room, maxRoomPeers)

	_, resp, err := e.dial(t, e.user, e.room)
	if err == nil {
		t.Fatal("phòng đầy mà vẫn mở được socket thứ 17")
	}
	if resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("phòng đầy: HTTP %v, mong đợi 429", resp)
	}
}

// Phòng là id dự án: id không phải UUID bị từ chối 400 trước khi mở socket.
func TestRoomSignalInvalidID(t *testing.T) {
	e := newSignalEnv(t)
	_, resp, err := e.dial(t, e.user, "khong-phai-uuid")
	if err == nil {
		t.Fatal("id không phải UUID mà vẫn mở được socket")
	}
	if resp == nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("id sai: HTTP %v, mong đợi 400", resp)
	}
}

func newSignalEnvWithNow(t *testing.T, now func() time.Time) *signalEnv {
	t.Helper()
	dsn := signalDSN()
	if dsn == "" {
		t.Skip("bỏ qua: chưa đặt RLS_TEST_DSN (cần Postgres trong Docker)")
	}
	ctx := context.Background()
	raw, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(raw.Close)
	if _, err := raw.Exec(ctx, `DROP TABLE IF EXISTS `+migrations.DropAllTablesSQL+` CASCADE`); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	e := &signalEnv{st: st, log: &syncBuf{}, hub: newSignalHub()}
	prevLog, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(e.log)
	t.Cleanup(func() { log.SetOutput(prevLog); log.SetFlags(prevFlags) })
	for _, tc := range []struct {
		name string
		dst  *string
	}{
		{"chu-du-an", &e.user}, {"thanh-vien", &e.peer}, {"nguoi-ngoai", &e.other},
	} {
		if err := raw.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ($1) RETURNING id::text`, tc.name).Scan(tc.dst); err != nil {
			t.Fatal(err)
		}
	}
	if err := raw.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine)
		VALUES ($1, 'Phòng 1', 'postgres') RETURNING id::text`, e.user).Scan(&e.room); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine)
		VALUES ($1, 'Phòng 2', 'postgres') RETURNING id::text`, e.user).Scan(&e.room2); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')`,
		e.room, e.peer); err != nil {
		t.Fatal(err)
	}

	r := NewRouterWithLog(e.log)
	guard := func(c *gin.Context) {
		u := c.GetHeader("X-Test-User")
		if u == "" {
			Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
			return
		}
		c.Set("test.user", u)
		c.Next()
	}
	mountRoomSignalWithNow(r, RoomSignalConfig{Store: st, RequireUser: guard, UID: func(c *gin.Context) string {
		v, _ := c.Get("test.user")
		s, _ := v.(string)
		return s
	}}, e.hub, signalLifetime, now)
	e.srv = httptest.NewServer(r)
	t.Cleanup(e.srv.Close)
	return e
}

func (e *signalEnv) requestTicket(t *testing.T, user, room string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/cloud/projects/"+room+"/signal-ticket", nil)
	if err != nil {
		t.Fatal(err)
	}
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		return resp, ""
	}
	var out struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expiresIn"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("json ticket: %v (%s)", err, body)
	}
	if out.Ticket == "" || out.ExpiresIn != 30 {
		t.Fatalf("payload ticket không hợp lệ: %+v", out)
	}
	return resp, out.Ticket
}

func (e *signalEnv) dialWithTicket(t *testing.T, room, ticket string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/api/v1/cloud/projects/" + room + "/signal?ticket=" + ticket
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, wsURL, nil)
	if conn != nil {
		conn.SetReadLimit(1 << 20)
		t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

// AC1: POST /signal-ticket trả 200 cho owner/member, 404 cho người ngoài, 401 chưa đăng nhập, 400 UUID sai.
func TestRoomSignalTicketIssue(t *testing.T) {
	e := newSignalEnv(t)

	if resp, tk := e.requestTicket(t, e.user, e.room); resp.StatusCode != http.StatusOK || tk == "" {
		t.Fatalf("owner xin ticket: HTTP %d, ticket=%q", resp.StatusCode, tk)
	}
	if resp, tk := e.requestTicket(t, e.peer, e.room); resp.StatusCode != http.StatusOK || tk == "" {
		t.Fatalf("member xin ticket: HTTP %d, ticket=%q", resp.StatusCode, tk)
	}
	if resp, _ := e.requestTicket(t, e.other, e.room); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("người ngoài xin ticket: HTTP %d, mong đợi 404", resp.StatusCode)
	}
	if resp, _ := e.requestTicket(t, "", e.room); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("chưa đăng nhập xin ticket: HTTP %d, mong đợi 401", resp.StatusCode)
	}
	if resp, _ := e.requestTicket(t, e.user, "khong-phai-uuid"); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("UUID sai xin ticket: HTTP %d, mong đợi 400", resp.StatusCode)
	}
}

// AC2 & AC3: mở WebSocket bằng ?ticket=... không cần cookie, dùng lại lần 2 -> 401, sai phòng -> 401, zero-log.
func TestRoomSignalTicketHandshakeAndOneTime(t *testing.T) {
	e := newSignalEnv(t)

	_, tkUser := e.requestTicket(t, e.user, e.room)
	_, tkPeer := e.requestTicket(t, e.peer, e.room)

	// Sai phòng: ticket phòng 1 dùng cho phòng 2 -> 401 (và ticket bị tiêu hủy luôn).
	_, respWrongRoom, err := e.dialWithTicket(t, e.room2, tkUser)
	if err == nil || respWrongRoom == nil || respWrongRoom.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ticket phòng 1 dùng cho phòng 2 phải bị 401, nhận err=%v resp=%v", err, respWrongRoom)
	}

	// Cấp lại ticket cho owner và mở socket không cần cookie/header.
	_, tkUser2 := e.requestTicket(t, e.user, e.room)
	a, respA, err := e.dialWithTicket(t, e.room, tkUser2)
	if err != nil {
		t.Fatalf("mở WS bằng ticket thất bại: %v (resp=%v)", err, respA)
	}
	b, respB, err := e.dialWithTicket(t, e.room, tkPeer)
	if err != nil {
		t.Fatalf("peer mở WS bằng ticket thất bại: %v (resp=%v)", err, respB)
	}
	e.waitPeers(t, e.room, 2)

	// Dùng lại ticket lần 2 -> 401.
	_, respReuse, err := e.dialWithTicket(t, e.room, tkUser2)
	if err == nil || respReuse == nil || respReuse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("dùng lại ticket lần 2 phải bị 401, nhận err=%v resp=%v", err, respReuse)
	}

	// Relay SDP/ICE giữa 2 peer vẫn hoạt động bình thường.
	e.write(t, a, `{"type":"offer","sdp":"`+signalMark+`"}`)
	got, err := readWithin(b, 5*time.Second)
	if err != nil || !strings.Contains(got, signalMark) {
		t.Fatalf("relay qua ticket thất bại: got=%q err=%v", got, err)
	}

	// AC3: Zero-Log Transit — log Gin không chứa giá trị ticket lẫn nội dung SQL.
	logs := e.log.String()
	for _, secret := range []string{tkUser, tkUser2, tkPeer, signalMark} {
		if strings.Contains(logs, secret) {
			t.Fatalf("log Gin làm lộ dữ liệu nhạy cảm %q:\n%s", secret, logs)
		}
	}
}

// AC2: ticket hết hạn sau 30 giây -> 401.
func TestRoomSignalTicketExpired(t *testing.T) {
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	e := newSignalEnvWithNow(t, func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return now
	})

	_, tk := e.requestTicket(t, e.user, e.room)

	mu.Lock()
	now = now.Add(30 * time.Second)
	mu.Unlock()

	_, resp, err := e.dialWithTicket(t, e.room, tk)
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ticket hết hạn 30s phải bị 401, nhận err=%v resp=%v", err, resp)
	}
}

// Kiểm tra trần 4096 và dọn rác hết hạn của signalTicketStore (không cần Postgres).
func TestSignalTicketStoreCapAndPrune(t *testing.T) {
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	st := newSignalTicketStore(func() time.Time { return now })

	for i := 0; i < maxSignalTickets; i++ {
		if _, err := st.issue("u1", "r1"); err != nil {
			t.Fatalf("issue thứ %d thất bại: %v", i, err)
		}
	}
	if _, err := st.issue("u1", "r1"); err == nil {
		t.Fatal("vượt trần 4096 ticket mà không bị từ chối")
	}

	now = now.Add(signalTicketTTL)
	if _, err := st.issue("u1", "r1"); err != nil {
		t.Fatalf("sau khi hết hạn phải dọn rác và cấp lại được: %v", err)
	}
}
