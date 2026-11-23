package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/quota"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Test handler cloud CRUD (Task150). Cần Postgres thật:
//   T150_DATABASE_URL=postgres://postgres:t150@localhost:54491/app go test ./internal/httpapi -run Cloud -v

const cloudMark = "ZZTOPSECRET"

type cloudProjectResp struct {
	Project struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Engine    string `json:"engine"`
		TabCount  int    `json:"tabCount"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
		Tabs      []struct {
			Name     string `json:"name"`
			SQL      string `json:"sql"`
			Position int    `json:"position"`
		} `json:"tabs"`
	} `json:"project"`
	Projects []struct {
		ID       string `json:"id"`
		TabCount int    `json:"tabCount"`
	} `json:"projects"`
	Error struct {
		Code       string `json:"code"`
		MessageKey string `json:"messageKey"`
	} `json:"error"`
	Conflict struct {
		RemoteUpdatedAt string `json:"remoteUpdatedAt"`
	} `json:"conflict"`
}

type cloudEnv struct {
	r     *gin.Engine
	buf   *bytes.Buffer
	st    *store.Store
	raw   *pgxpool.Pool
	user  string // user A
	other string // user B
}

func newCloudEnv(t *testing.T, guards ...gin.HandlerFunc) *cloudEnv {
	t.Helper()
	url := os.Getenv("T150_DATABASE_URL")
	if url == "" {
		t.Skip("bỏ qua: chưa đặt T150_DATABASE_URL (cần Postgres trong Docker)")
	}
	// So Hostname() đã parse chứ không dùng strings.Contains: URL
	// `postgres://u:p@localhost:5432@db.invalid:5432/app` có chứa "@localhost:" nhưng thật sự
	// trỏ tới db.invalid. Cùng quy tắc với guardLocalOnly của package store.
	u, err := neturl.Parse(url)
	if err != nil {
		t.Fatalf("từ chối chạy: không đọc được URL kết nối (%v); test chỉ cho phép database ở localhost", err)
	}
	switch u.Scheme {
	case "postgres", "postgresql":
	default:
		t.Fatalf("từ chối chạy: URL phải dùng scheme postgres, nhận %q", u.Scheme)
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("từ chối chạy: host %q không phải localhost; test xóa bảng nên chỉ cho phép database ở localhost", u.Hostname())
	}
	ctx := context.Background()
	raw, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(raw.Close)
	if _, err := raw.Exec(ctx, `DROP TABLE IF EXISTS room_invite_tokens, room_baton,
		cloud_project_members, cloud_tabs, cloud_projects,
		user_vip_redemptions, vip_codes, sessions, identities, users, schema_migrations CASCADE`); err != nil {
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
	e := &cloudEnv{raw: raw, st: st}
	if err := raw.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('A') RETURNING id::text`).Scan(&e.user); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('B') RETURNING id::text`).Scan(&e.other); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	e.buf = &buf
	e.r = NewRouterWithLog(&buf)
	// Middleware đăng nhập giả: danh tính lấy từ header, chỉ tồn tại trong test.
	guard := func(c *gin.Context) {
		u := c.GetHeader("X-Test-User")
		if u == "" {
			Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
			return
		}
		c.Set("test.user", u)
		c.Next()
	}
	MountCloud(e.r, CloudConfig{Store: st, RequireUser: guard, Guards: guards, UID: func(c *gin.Context) string {
		v, _ := c.Get("test.user")
		s, _ := v.(string)
		return s
	}})
	return e
}

func (e *cloudEnv) do(t *testing.T, user, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

func (e *cloudEnv) body(t *testing.T, w *httptest.ResponseRecorder) cloudProjectResp {
	t.Helper()
	var out cloudProjectResp
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("body không phải JSON: %q (%v)", w.Body.String(), err)
	}
	return out
}

func cloudJSON(name, engine string, tabs ...[2]string) string {
	parts := make([]string, 0, len(tabs))
	for _, tb := range tabs {
		parts = append(parts, fmt.Sprintf(`{"name":%q,"sql":%q}`, tb[0], tb[1]))
	}
	return fmt.Sprintf(`{"name":%q,"engine":%q,"tabs":[%s]}`, name, engine, strings.Join(parts, ","))
}

// AC1: tạo kèm 3 tab rồi đọc lại đúng nội dung và thứ tự tab.
func TestCloudCreateReadOrder(t *testing.T) {
	e := newCloudEnv(t)
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("Dự án A", "postgres", [2]string{"tab1", "SELECT 1"}, [2]string{"tab2", "SELECT 2"}, [2]string{"tab3", "SELECT 3"}))
	if w.Code != http.StatusCreated {
		t.Fatalf("POST = %d %q", w.Code, w.Body.String())
	}
	created := e.body(t, w).Project
	if created.ID == "" || created.Name != "Dự án A" || created.Engine != "postgres" || created.TabCount != 3 {
		t.Fatalf("project = %+v", created)
	}

	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+created.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET = %d %q", w.Code, w.Body.String())
	}
	got := e.body(t, w).Project
	if len(got.Tabs) != 3 {
		t.Fatalf("tabs = %+v", got.Tabs)
	}
	for i, want := range [][2]string{{"tab1", "SELECT 1"}, {"tab2", "SELECT 2"}, {"tab3", "SELECT 3"}} {
		if got.Tabs[i].Name != want[0] || got.Tabs[i].SQL != want[1] || got.Tabs[i].Position != i {
			t.Fatalf("tab %d = %+v, mong đợi %v", i, got.Tabs[i], want)
		}
	}

	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects", "")
	if w.Code != http.StatusOK {
		t.Fatalf("LIST = %d %q", w.Code, w.Body.String())
	}
	list := e.body(t, w).Projects
	if len(list) != 1 || list[0].ID != created.ID || list[0].TabCount != 3 {
		t.Fatalf("list = %+v", list)
	}

	// PUT thay cả bộ tab và giữ đúng thứ tự mới.
	w = e.do(t, e.user, "PUT", "/api/v1/cloud/projects/"+created.ID,
		cloudJSON("Dự án A2", "mysql", [2]string{"x", "SELECT 'x'"}, [2]string{"y", "SELECT 'y'"}))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT = %d %q", w.Code, w.Body.String())
	}
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+created.ID, "")
	got = e.body(t, w).Project
	if got.Name != "Dự án A2" || got.Engine != "mysql" || len(got.Tabs) != 2 || got.Tabs[0].Name != "x" || got.Tabs[1].Name != "y" {
		t.Fatalf("sau PUT = %+v", got)
	}
}

// AC2: người khác dùng id của chủ nhận 404, không lộ dữ liệu, dự án của chủ còn nguyên.
func TestCloudCrossTenant(t *testing.T) {
	e := newCloudEnv(t)
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("Riêng tư", "postgres", [2]string{"t", "SELECT 'bí mật'"}))
	if w.Code != http.StatusCreated {
		t.Fatalf("POST = %d", w.Code)
	}
	id := e.body(t, w).Project.ID

	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/v1/cloud/projects/" + id, ""},
		{"PUT", "/api/v1/cloud/projects/" + id, cloudJSON("cướp", "postgres")},
		{"DELETE", "/api/v1/cloud/projects/" + id, ""},
	} {
		w := e.do(t, e.other, tc.method, tc.path, tc.body)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s của người khác = %d %q, mong đợi 404", tc.method, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "bí mật") {
			t.Fatalf("%s làm lộ nội dung: %q", tc.method, w.Body.String())
		}
	}

	// Dự án của chủ vẫn còn, tên không bị đổi.
	var name string
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT name FROM cloud_projects WHERE id = $1`, id).Scan(&name); err != nil {
		t.Fatalf("dự án của chủ biến mất: %v", err)
	}
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("tab của chủ: n=%d err=%v", n, err)
	}
	if name != "Riêng tư" {
		t.Fatalf("tên bị đổi thành %q", name)
	}

	// Danh sách của B rỗng.
	w = e.do(t, e.other, "GET", "/api/v1/cloud/projects", "")
	if len(e.body(t, w).Projects) != 0 {
		t.Fatalf("B thấy dự án của A: %q", w.Body.String())
	}
}

// Lỗi 3 của review: trần body 1MB toàn cục nhỏ hơn quota tab (100 × 512KB) nên hai tab 512KB
// đã bị 413 trước khi handler kịp chạy, và quota "100 tab" không bao giờ chạm tới. Sau khi sửa:
// route cloud có trần riêng đủ rộng, còn trần TỔNG 2MB/dự án trả 400 project_too_large.
func TestCloudBodyLimitPerProject(t *testing.T) {
	e := newCloudEnv(t)
	ctx := context.Background()

	// 1. Tab 600KB vẫn bị chặn bởi trần riêng của tab (không phải bởi trần body).
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("tab to", "postgres", [2]string{"t", strings.Repeat("a", 600*1024)}))
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudTabTooLarge {
		t.Fatalf("tab 600KB = %d %q", w.Code, w.Body.String())
	}

	// 2. Hai tab 512KB (body ~1MB): trước đây 413, nay phải lưu được.
	half := strings.Repeat("a", 512*1024)
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("hai tab lớn", "postgres", [2]string{"a", half}, [2]string{"b", half}))
	if w.Code != http.StatusCreated {
		t.Fatalf("hai tab 512KB = %d %q, mong đợi 201", w.Code, w.Body.String())
	}
	id := e.body(t, w).Project.ID
	var stored int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, id).Scan(&stored); err != nil || stored != 2 {
		t.Fatalf("hai tab 512KB đã lưu: n=%d err=%v", stored, err)
	}

	// 3. Dự án vượt trần tổng 2MB: 400 project_too_large (không phải 413) và KHÔNG ghi một phần.
	//    5 tab × 450KB = 2,25MB, mỗi tab vẫn dưới trần riêng 512KB.
	tabs := make([][2]string, 0, 5)
	for i := 0; i < 5; i++ {
		tabs = append(tabs, [2]string{fmt.Sprintf("t%d", i), strings.Repeat("a", 450*1024)})
	}
	before := countProjects(t, e)
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("quá tổng", "postgres", tabs...))
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudProjectTooBig {
		t.Fatalf("tổng 2,25MB = %d %q, mong đợi 400 %s", w.Code, w.Body.String(), codeCloudProjectTooBig)
	}
	if after := countProjects(t, e); after != before {
		t.Fatalf("đã ghi một phần: %d -> %d dự án", before, after)
	}

	// 4. Route khác vẫn giữ trần 1MB: không được nới rộng cả hệ thống vì route cloud.
	//    1,5MB nằm giữa hai trần nên phân biệt được hai chế độ.
	r, _ := testRouter()
	w = do(r, "POST", "/echo/1", strings.Repeat("a", 1536*1024))
	wantErr(t, w, http.StatusRequestEntityTooLarge, "payload_too_large", "error.payloadTooLarge")
}

// countProjects đếm dự án bằng role chủ để không phụ thuộc RLS của phiên.
func countProjects(t *testing.T, e *cloudEnv) int {
	t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM cloud_projects`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// AC3: vượt quota trả 400 kèm mã lỗi, và không ghi một phần.
func TestCloudQuota(t *testing.T) {
	e := newCloudEnv(t)
	ctx := context.Background()

	// 512KB/tab: 600KB bị từ chối, không tạo dự án nào.
	big := strings.Repeat("a", 600*1024)
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Quá lớn", "postgres", [2]string{"t", big}))
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudTabTooLarge {
		t.Fatalf("tab 600KB = %d %q", w.Code, w.Body.String())
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("đã ghi một phần: n=%d err=%v", n, err)
	}

	// 100 tab/dự án: 101 tab bị từ chối.
	tabs := make([][2]string, 0, store.MaxCloudTabs+1)
	for i := 0; i <= store.MaxCloudTabs; i++ {
		tabs = append(tabs, [2]string{fmt.Sprintf("t%d", i), "SELECT 1"})
	}
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Quá nhiều tab", "postgres", tabs...))
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudTooManyTabs {
		t.Fatalf("101 tab = %d %q", w.Code, w.Body.String())
	}

	// 50 dự án/user: dựng sẵn 49 rồi tạo 1 qua API (được), dự án thứ 51 phải bị chặn.
	if _, err := e.raw.Exec(ctx, `INSERT INTO cloud_projects (owner_id, name, engine)
		SELECT $1, 'p' || g, 'postgres' FROM generate_series(1, 49) g`, e.user); err != nil {
		t.Fatal(err)
	}
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("thứ 50", "postgres"))
	if w.Code != http.StatusCreated {
		t.Fatalf("dự án thứ 50 = %d %q", w.Code, w.Body.String())
	}
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("thứ 51", "postgres"))
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudTooManyProject {
		t.Fatalf("dự án thứ 51 = %d %q", w.Code, w.Body.String())
	}
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE owner_id = $1`, e.user).Scan(&n); err != nil || n != 50 {
		t.Fatalf("số dự án sau khi chặn = %d err=%v, mong đợi 50", n, err)
	}

	// Người khác không bị ảnh hưởng bởi quota của A.
	w = e.do(t, e.other, "POST", "/api/v1/cloud/projects", cloudJSON("của B", "sqlite"))
	if w.Code != http.StatusCreated {
		t.Fatalf("B tạo dự án = %d %q", w.Code, w.Body.String())
	}
}

// AC4: xóa dự án xóa luôn tab, trả 204.
func TestCloudDeleteCascade(t *testing.T) {
	e := newCloudEnv(t)
	ctx := context.Background()
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("Xóa", "postgres", [2]string{"a", "SELECT 1"}, [2]string{"b", "SELECT 2"}))
	id := e.body(t, w).Project.ID

	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id, "")
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Fatalf("DELETE = %d %q", w.Code, w.Body.String())
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("tab còn lại: n=%d err=%v", n, err)
	}
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE id = $1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("dự án còn lại: n=%d err=%v", n, err)
	}
	// Xóa lần hai: 404.
	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("xóa lần hai = %d %q", w.Code, w.Body.String())
	}
}

// AC5: log của handler không chứa nội dung SQL, kể cả ở nhánh 500.
func TestCloudLogsNoSQL(t *testing.T) {
	e := newCloudEnv(t)
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("Log "+cloudMark, "postgres", [2]string{"t", "SELECT '" + cloudMark + "'"}))
	if w.Code != http.StatusCreated {
		t.Fatalf("POST = %d %q", w.Code, w.Body.String())
	}
	id := e.body(t, w).Project.ID
	e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id, "")
	e.do(t, e.user, "PUT", "/api/v1/cloud/projects/"+id, cloudJSON("x", "postgres", [2]string{"t", "SELECT '" + cloudMark + "'"}))
	e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id, "")

	// Nhánh 500: đóng pool để mọi câu SQL hỏng, rồi gửi lại đúng SQL có dấu.
	e.st.Close()
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		cloudJSON("Log "+cloudMark, "postgres", [2]string{"t", "SELECT '" + cloudMark + "'"}))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("nhánh 500 = %d %q", w.Code, w.Body.String())
	}

	if e.buf.Len() == 0 {
		t.Fatal("không có dòng log nào: test không chứng minh được gì")
	}
	if strings.Contains(e.buf.String(), cloudMark) || strings.Contains(e.buf.String(), "SELECT") {
		t.Fatalf("log chứa nội dung SQL: %q", e.buf.String())
	}
	if !strings.Contains(e.buf.String(), "POST /api/v1/cloud/projects 500") {
		t.Fatalf("log thiếu dòng của request 500: %q", e.buf.String())
	}
}

// Task153: ghi có điều kiện bằng `baseUpdatedAt` — máy khác đã sửa thì 409 và không ghi đè.
func TestCloudUpdateConflict(t *testing.T) {
	e := newCloudEnv(t)
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Bản gốc", "postgres", [2]string{"t", "SELECT 1"}))
	if w.Code != http.StatusCreated {
		t.Fatalf("POST = %d %q", w.Code, w.Body.String())
	}
	created := e.body(t, w).Project
	base := created.UpdatedAt
	if base == "" {
		t.Fatal("response thiếu updatedAt")
	}

	put := func(name, base string) *httptest.ResponseRecorder {
		t.Helper()
		body := fmt.Sprintf(`{"name":%q,"engine":"postgres","tabs":[],"baseUpdatedAt":%q}`, name, base)
		return e.do(t, e.user, "PUT", "/api/v1/cloud/projects/"+created.ID, body)
	}

	// Đúng mốc: ghi được.
	w = put("Bản mới", base)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT đúng mốc = %d %q", w.Code, w.Body.String())
	}
	if e.body(t, w).Project.UpdatedAt == base {
		t.Fatal("updatedAt không đổi sau khi ghi")
	}

	// Mốc cũ: 409, kèm mốc hiện tại của server, và KHÔNG ghi đè.
	w = put("Bản cướp", base)
	if w.Code != http.StatusConflict {
		t.Fatalf("PUT mốc cũ = %d %q, mong đợi 409", w.Code, w.Body.String())
	}
	conflict := e.body(t, w)
	if conflict.Error.Code != "conflict" || conflict.Conflict.RemoteUpdatedAt == "" {
		t.Fatalf("payload 409 = %q", w.Body.String())
	}
	var name string
	if err := e.raw.QueryRow(context.Background(), `SELECT name FROM cloud_projects WHERE id = $1`, created.ID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Bản mới" {
		t.Fatalf("409 mà vẫn ghi đè: tên = %q", name)
	}

	// Không gửi baseUpdatedAt: giữ hành vi cũ của Task150.
	body := fmt.Sprintf(`{"name":"Không điều kiện","engine":"postgres","tabs":[]}`)
	w = e.do(t, e.user, "PUT", "/api/v1/cloud/projects/"+created.ID, body)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT không base = %d %q", w.Code, w.Body.String())
	}

	// Mốc không phải RFC3339: 400, không ghi gì.
	w = put("x", "không-phải-thời-gian")
	if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudInvalidBody {
		t.Fatalf("baseUpdatedAt rác = %d %q", w.Code, w.Body.String())
	}
}

// Ca biên: body thiếu trường, id không phải UUID, owner_id trong body bị bỏ qua.
func TestCloudEdgeCases(t *testing.T) {
	e := newCloudEnv(t)

	for _, tc := range []struct{ name, body, code string }{
		{"thiếu name", `{"engine":"postgres"}`, codeCloudInvalidBody},
		{"thiếu engine", `{"name":"x"}`, codeCloudInvalidEngine},
		{"engine lạ", `{"name":"x","engine":"oracle"}`, codeCloudInvalidEngine},
		{"thân rỗng", ``, codeCloudInvalidBody},
		{"JSON hỏng", `{"name":`, codeCloudInvalidBody},
	} {
		w := e.do(t, e.user, "POST", "/api/v1/cloud/projects", tc.body)
		if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != tc.code {
			t.Fatalf("%s: %d %q, mong đợi 400 %s", tc.name, w.Code, w.Body.String(), tc.code)
		}
	}

	for _, method := range []string{"GET", "PUT", "DELETE"} {
		w := e.do(t, e.user, method, "/api/v1/cloud/projects/khong-phai-uuid", `{"name":"x","engine":"postgres"}`)
		if w.Code != http.StatusBadRequest || e.body(t, w).Error.Code != codeCloudInvalidID {
			t.Fatalf("%s id rác = %d %q", method, w.Code, w.Body.String())
		}
	}

	// owner_id trong body không được dùng: dự án thuộc về người gọi, không thuộc người trong body.
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects",
		fmt.Sprintf(`{"name":"A","engine":"postgres","owner_id":%q,"tabs":[]}`, e.other))
	if w.Code != http.StatusCreated {
		t.Fatalf("POST = %d %q", w.Code, w.Body.String())
	}
	id := e.body(t, w).Project.ID
	var owner string
	if err := e.raw.QueryRow(context.Background(), `SELECT owner_id::text FROM cloud_projects WHERE id = $1`, id).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != e.user {
		t.Fatalf("owner trong DB = %s, mong đợi người gọi %s", owner, e.user)
	}

	// Chưa đăng nhập: 401.
	if w := e.do(t, "", "GET", "/api/v1/cloud/projects", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("không có session = %d %q", w.Code, w.Body.String())
	}
}

// SP999 (phát hiện F1 của cổng bảo mật Task155): route cloud phải trả 429 khi vượt hạn mức,
// và lớp chặn phải chạy TRƯỚC handler để request thừa không chạm store/Neon.
func TestCloudAppliesRateLimitGuard(t *testing.T) {
	var count atomic.Int64
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		// Như Redis thật: mỗi lệnh EVAL tăng bộ đếm rồi trả về giá trị mới.
		json.NewEncoder(w).Encode(map[string]any{"result": []int64{count.Add(1), 300000}})
	}))
	t.Cleanup(up.Close)

	guard := quota.New(up.URL, "tok", nil).Middleware(quota.CloudSync, func(c *gin.Context) (string, bool) {
		v, _ := c.Get("test.user")
		s, _ := v.(string)
		return s, s != ""
	})
	e := newCloudEnv(t, guard)

	count.Store(int64(quota.CloudSync.Limit)) // phép đếm kế tiếp = Limit+1 -> vượt
	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Quá hạn mức", "postgres"))
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("vượt hạn mức = %d %q, muốn 429", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "quota_exceeded") || w.Header().Get("Retry-After") == "" {
		t.Fatalf("429 thiếu mã/lệnh chờ: %q %q", w.Body.String(), w.Header().Get("Retry-After"))
	}
	if n := int(count.Load()); n != quota.CloudSync.Limit+1 {
		t.Fatalf("request bị chặn vẫn đi quá lớp quota (count=%d)", n)
	}

	// Dưới hạn mức: guard cho qua, handler tạo dự án bình thường (guard không chặn nhầm).
	count.Store(0)
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Trong hạn mức", "postgres"))
	if w.Code != http.StatusCreated {
		t.Fatalf("trong hạn mức = %d %q, muốn 201", w.Code, w.Body.String())
	}
}
