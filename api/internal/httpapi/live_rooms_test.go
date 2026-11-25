package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Test handler phòng cộng tác (SP024 / STR116 / Task161). Cần Postgres thật:
//   T150_DATABASE_URL=postgres://postgres:t152@localhost:54495/app161 go test -p 1 ./internal/httpapi -run Room -v
//
// Dùng lại `newCloudEnv`/`e.do`/`e.body`/`cloudJSON` của `cloud_projects_test.go`: cùng package,
// cùng router, cùng hai user A và B. Không khai báo lại `do`/`wantErr` (đã có ở `safety_test.go`).

// roomResp là body của bốn endpoint trả JSON của Task161.
type roomResp struct {
	Token     string `json:"token"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expiresAt"`
	ProjectID string `json:"projectId"`
	// AlreadyMember là con trỏ để phân biệt "server không gửi trường này" với "server gửi false".
	AlreadyMember *bool   `json:"alreadyMember"`
	HolderID      *string `json:"holderId"`
	Step          *int    `json:"step"`
	UpdatedAt     *string `json:"updatedAt"`
	Error         struct {
		Code       string `json:"code"`
		MessageKey string `json:"messageKey"`
	} `json:"error"`
}

// roomJSON đọc body JSON của route phòng.
func roomJSON(t *testing.T, w interface{ Bytes() []byte }) roomResp {
	t.Helper()
	var out roomResp
	if err := json.Unmarshal(w.Bytes(), &out); err != nil {
		t.Fatalf("body không phải JSON: %q (%v)", string(w.Bytes()), err)
	}
	return out
}

// roomProject tạo một dự án của user rồi trả id của nó.
func roomProject(t *testing.T, e *cloudEnv, user, name string) string {
	t.Helper()
	w := e.do(t, user, "POST", "/api/v1/cloud/projects", cloudJSON(name, "postgres"))
	if w.Code != http.StatusCreated {
		t.Fatalf("tạo dự án %q = %d %q", name, w.Code, w.Body.String())
	}
	return e.body(t, w).Project.ID
}

// roomInvite phát một vé mời cho dự án và trả token.
func roomInvite(t *testing.T, e *cloudEnv, user, projectID string) roomResp {
	t.Helper()
	w := e.do(t, user, "POST", "/api/v1/cloud/projects/"+projectID+"/invite", "")
	if w.Code != http.StatusOK {
		t.Fatalf("POST /invite = %d %q", w.Code, w.Body.String())
	}
	got := roomJSON(t, w.Body)
	if got.Token == "" || got.Role == "" || got.ExpiresAt == "" {
		t.Fatalf("payload vé mời thiếu trường: %q", w.Body.String())
	}
	return got
}

// roomJoin gọi POST /join bằng token.
func roomJoin(t *testing.T, e *cloudEnv, user, token string) (roomResp, int) {
	t.Helper()
	w := e.do(t, user, "POST", "/api/v1/cloud/projects/join", `{"token":`+quote(token)+`}`)
	return roomJSON(t, w.Body), w.Code
}

// quote bọc chuỗi thành literal JSON. Dùng cho token và mọi giá trị test tự dựng.
func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// AC1 + AC4 (case 1 và 2): vé mời sống 24 giờ, join bằng vé hợp lệ vào được phòng, và vé hết hạn
// trả 410 `token_expired` chứ KHÔNG phải 404.
func TestRoomInviteAndJoin(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng của A")

	inv := roomInvite(t, e, e.user, id)
	if inv.Role != "editor" {
		t.Fatalf("vai trò vé = %q, mong đợi editor", inv.Role)
	}
	if len(inv.Token) != 43 {
		t.Fatalf("độ dài token = %d, mong đợi 43 (32 byte base64url không đệm)", len(inv.Token))
	}

	// B chưa là thành viên: đọc dự án phải 404 trước khi join.
	if w := e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id, ""); w.Code != http.StatusNotFound {
		t.Fatalf("B đọc dự án trước khi join = %d, mong đợi 404", w.Code)
	}

	got, code := roomJoin(t, e, e.other, inv.Token)
	if code != http.StatusOK {
		t.Fatalf("POST /join = %d, mong đợi 200", code)
	}
	if got.ProjectID != id || got.Role != "editor" {
		t.Fatalf("kết quả join = %+v, mong đợi dự án %s vai trò editor", got, id)
	}
	if got.AlreadyMember == nil || *got.AlreadyMember {
		t.Fatalf("lần join đầu phải có alreadyMember=false, nhận %v", got.AlreadyMember)
	}

	// AC2: vào rồi thì đọc được dự án (sai lệch 4 của task161.md).
	if w := e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id, ""); w.Code != http.StatusOK {
		t.Fatalf("B đọc dự án sau khi join = %d %q, mong đợi 200", w.Code, w.Body.String())
	}

	// Ca biên: vé hết hạn trả 410 token_expired. Hạn được đẩy về quá khứ bằng role chủ vì bảng vé
	// không có policy UPDATE nào (sai lệch 5: link dùng lại được tới hạn, không đánh dấu đã dùng).
	if _, err := e.raw.Exec(context.Background(),
		`UPDATE room_invite_tokens SET expires_at = now() - interval '1 minute' WHERE expires_at > now()`); err != nil {
		t.Fatal(err)
	}
	expired, code := roomJoin(t, e, e.other, inv.Token)
	if code != http.StatusGone {
		t.Fatalf("join bằng vé hết hạn = %d %+v, mong đợi 410", code, expired)
	}
	if expired.Error.Code != codeRoomTokenExpired {
		t.Fatalf("mã lỗi của vé hết hạn = %q, mong đợi %q", expired.Error.Code, codeRoomTokenExpired)
	}
}

// AC4 (case 2) + ca biên: token sai/không tồn tại trả 404, token rỗng trả 400, body hỏng trả 400.
func TestRoomJoinBadToken(t *testing.T) {
	e := newCloudEnv(t)
	roomProject(t, e, e.user, "Phòng")

	for _, tc := range []struct {
		name string
		body string
		code int
		want string
	}{
		{"vé bịa", `{"token":"khong-he-ton-tai"}`, http.StatusNotFound, codeCloudNotFound},
		{"token rỗng", `{"token":"   "}`, http.StatusBadRequest, codeRoomInvalidToken},
		{"thiếu trường token", `{}`, http.StatusBadRequest, codeRoomInvalidToken},
		{"body không phải JSON", `khong-phai-json`, http.StatusBadRequest, codeCloudInvalidBody},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.do(t, e.other, "POST", "/api/v1/cloud/projects/join", tc.body)
			if w.Code != tc.code {
				t.Fatalf("%s = %d %q, mong đợi %d", tc.name, w.Code, w.Body.String(), tc.code)
			}
			if got := roomJSON(t, w.Body).Error.Code; got != tc.want {
				t.Fatalf("%s trả mã %q, mong đợi %q", tc.name, got, tc.want)
			}
		})
	}
}

// Ca biên của task: người ngoài dùng vé của dự án khác vẫn vào được (đó là mục đích của vé),
// NHƯNG không đọc được vé của dự án khác. Kèm join lần hai idempotent `alreadyMember: true`.
func TestRoomJoinSecondTimeAndTokenIsolation(t *testing.T) {
	e := newCloudEnv(t)
	idA := roomProject(t, e, e.user, "Phòng A")
	idB := roomProject(t, e, e.other, "Phòng B")

	invA := roomInvite(t, e, e.user, idA)
	invB := roomInvite(t, e, e.other, idB)

	// B vào phòng của A bằng vé của A — đúng mục đích của tính năng.
	if got, code := roomJoin(t, e, e.other, invA.Token); code != http.StatusOK || got.ProjectID != idA {
		t.Fatalf("B join phòng A = %d %+v", code, got)
	}

	// Join lần hai: idempotent, không lỗi, alreadyMember=true, vai trò giữ nguyên.
	again, code := roomJoin(t, e, e.other, invA.Token)
	if code != http.StatusOK {
		t.Fatalf("join lần hai = %d", code)
	}
	if again.AlreadyMember == nil || !*again.AlreadyMember {
		t.Fatalf("join lần hai phải có alreadyMember=true, nhận %v", again.AlreadyMember)
	}
	if again.ProjectID != idA || again.Role != "editor" {
		t.Fatalf("join lần hai = %+v", again)
	}
	var members int
	if err := e.raw.QueryRow(context.Background(),
		`SELECT count(*) FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
		idA, e.other).Scan(&members); err != nil || members != 1 {
		t.Fatalf("join lần hai để lại %d hàng thành viên, err=%v", members, err)
	}

	// A vẫn vào phòng của B được bằng vé của B (vé không phải đặc quyền một chiều).
	if got, code := roomJoin(t, e, e.user, invB.Token); code != http.StatusOK || got.ProjectID != idB {
		t.Fatalf("A join phòng B = %d %+v", code, got)
	}

	// "Không đọc được token khác" ở tầng HTTP có đúng một nghĩa kiểm được: chỉ chủ dự án phát
	// được vé, nên thành viên không tự lấy thêm token của phòng. B vừa là thành viên phòng A.
	w := e.do(t, e.other, "POST", "/api/v1/cloud/projects/"+idA+"/invite", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("thành viên phát vé mời = %d %q, mong đợi 403", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token") {
		t.Fatalf("response 403 làm lộ token: %q", w.Body.String())
	}
	// Và vé của phòng kia vẫn không mở được phòng của mình: B đọc phòng B bằng vé A là vô nghĩa,
	// nhưng quan trọng hơn — B không đọc được hàng vé nào qua HTTP vì không có route nào trả vé
	// ngoài `POST /invite` của chủ. Tầng store đã có test riêng cho GUC vé
	// (`TestRoomInviteContextDiesWithTransaction`).
}

// AC4 (case 3) + AC2: `DELETE /members/:uid` trả 204 cho chủ, 403 cho người không phải chủ,
// 400 khi chủ tự xoá mình, 404 khi thành viên không tồn tại, và thành viên bị xoá đọc dự án = 404.
func TestRoomRemoveMember(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng có thành viên")
	inv := roomInvite(t, e, e.user, id)
	if _, code := roomJoin(t, e, e.other, inv.Token); code != http.StatusOK {
		t.Fatalf("B join = %d", code)
	}

	// AC2: người không phải chủ nhận 403. B là thành viên nên đọc được dự án, vì vậy 403 không lộ
	// thêm thông tin gì về sự tồn tại của dự án.
	w := e.do(t, e.other, "DELETE", "/api/v1/cloud/projects/"+id+"/members/"+e.user, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("thành viên xoá người khác = %d %q, mong đợi 403", w.Code, w.Body.String())
	}
	if got := roomJSON(t, w.Body).Error.Code; got != codeRoomForbidden {
		t.Fatalf("mã lỗi = %q, mong đợi %q", got, codeRoomForbidden)
	}

	// Ca biên: chủ tự xoá mình = 400, không phải 204 (dự án sẽ không còn ai quản lý).
	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id+"/members/"+e.user, "")
	if w.Code != http.StatusBadRequest || roomJSON(t, w.Body).Error.Code != codeRoomOwnerLeave {
		t.Fatalf("chủ tự xoá mình = %d %q, mong đợi 400 %s", w.Code, w.Body.String(), codeRoomOwnerLeave)
	}

	// Ca biên: thành viên không tồn tại = 404.
	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id+"/members/"+"99999999-0000-4000-8000-000000000099", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("xoá thành viên không tồn tại = %d %q, mong đợi 404", w.Code, w.Body.String())
	}

	// Ca biên: `:uid` không phải UUID = 400, không phải 500 do Postgres báo lỗi cú pháp.
	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id+"/members/khong-phai-uuid", "")
	if w.Code != http.StatusBadRequest || roomJSON(t, w.Body).Error.Code != codeCloudInvalidID {
		t.Fatalf("uid không phải UUID = %d %q, mong đợi 400 %s", w.Code, w.Body.String(), codeCloudInvalidID)
	}

	// Xoá thật: 204, rồi B đọc dự án = 404 (AC2).
	w = e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id+"/members/"+e.other, "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("chủ xoá thành viên = %d %q, mong đợi 204", w.Code, w.Body.String())
	}
	if w := e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id, ""); w.Code != http.StatusNotFound {
		t.Fatalf("thành viên bị xoá đọc dự án = %d, mong đợi 404", w.Code)
	}
}

// AC4 (case 4 và 5): `GET /baton` đọc được cho cả chủ và thành viên; `POST /baton/claim` chỉ chủ
// và trả đúng người giữ mới. Phòng chưa ai nhận thì holderId/updatedAt là null thật.
func TestRoomBaton(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng baton")

	// Chưa ai giữ: 200 với null, không phải 404 và không phải mốc thời gian giả.
	w := e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/baton", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /baton phòng trống = %d %q", w.Code, w.Body.String())
	}
	empty := roomJSON(t, w.Body)
	if empty.HolderID != nil || empty.UpdatedAt != nil || empty.Step == nil || *empty.Step != 0 {
		t.Fatalf("phòng chưa ai giữ phải là {null, 0, null}, nhận %q", w.Body.String())
	}

	// Chủ nhận Baton.
	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects/"+id+"/baton/claim", "")
	if w.Code != http.StatusOK {
		t.Fatalf("POST /baton/claim = %d %q", w.Code, w.Body.String())
	}
	claimed := roomJSON(t, w.Body)
	if claimed.HolderID == nil || *claimed.HolderID != e.user {
		t.Fatalf("người giữ sau claim = %v, mong đợi %s", claimed.HolderID, e.user)
	}
	if claimed.UpdatedAt == nil {
		t.Fatal("claim phải trả updatedAt")
	}

	// Thành viên đọc được trạng thái Baton nhưng không claim được.
	inv := roomInvite(t, e, e.user, id)
	if _, code := roomJoin(t, e, e.other, inv.Token); code != http.StatusOK {
		t.Fatalf("B join = %d", code)
	}
	w = e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id+"/baton", "")
	if w.Code != http.StatusOK {
		t.Fatalf("thành viên GET /baton = %d %q, mong đợi 200", w.Code, w.Body.String())
	}
	if got := roomJSON(t, w.Body); got.HolderID == nil || *got.HolderID != e.user {
		t.Fatalf("thành viên thấy người giữ %v, mong đợi %s", got.HolderID, e.user)
	}
	w = e.do(t, e.other, "POST", "/api/v1/cloud/projects/"+id+"/baton/claim", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("thành viên claim = %d %q, mong đợi 403", w.Code, w.Body.String())
	}

	// Ca biên: dự án của người khác khi chưa join = 404, không lộ tồn tại.
	otherID := roomProject(t, e, e.other, "Phòng của B")
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+otherID+"/baton", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("người ngoài GET /baton = %d %q, mong đợi 404", w.Code, w.Body.String())
	}
}

// AC4 (case 6): `POST /arena-step` chỉ chủ, `GET /arena-step` cho cả thành viên. Ca biên: step âm
// hoặc phi số = 400, thành viên POST = 403.
func TestRoomArenaStep(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng arena")

	// Mặc định 0 khi chưa ai đặt.
	w := e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/arena-step", "")
	if w.Code != http.StatusOK || roomJSON(t, w.Body).Step == nil || *roomJSON(t, w.Body).Step != 0 {
		t.Fatalf("GET /arena-step ban đầu = %d %q", w.Code, w.Body.String())
	}

	w = e.do(t, e.user, "POST", "/api/v1/cloud/projects/"+id+"/arena-step", `{"step":7}`)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /arena-step = %d %q", w.Code, w.Body.String())
	}
	if got := roomJSON(t, w.Body).Step; got == nil || *got != 7 {
		t.Fatalf("step sau khi ghi = %v, mong đợi 7", got)
	}
	// Bước 0 là giá trị hợp lệ, không phải "thiếu trường".
	if w := e.do(t, e.user, "POST", "/api/v1/cloud/projects/"+id+"/arena-step", `{"step":0}`); w.Code != http.StatusOK {
		t.Fatalf("POST step=0 = %d %q, mong đợi 200", w.Code, w.Body.String())
	}

	for _, tc := range []struct{ name, body string }{
		{"step âm", `{"step":-1}`},
		{"step phi số", `{"step":"ba"}`},
		{"thiếu trường step", `{}`},
		{"body không phải JSON", `khong-phai-json`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.do(t, e.user, "POST", "/api/v1/cloud/projects/"+id+"/arena-step", tc.body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s = %d %q, mong đợi 400", tc.name, w.Code, w.Body.String())
			}
		})
	}

	// Ca biên: thành viên POST = 403 nhưng GET = 200.
	inv := roomInvite(t, e, e.user, id)
	if _, code := roomJoin(t, e, e.other, inv.Token); code != http.StatusOK {
		t.Fatalf("B join = %d", code)
	}
	if w := e.do(t, e.other, "POST", "/api/v1/cloud/projects/"+id+"/arena-step", `{"step":9}`); w.Code != http.StatusForbidden {
		t.Fatalf("thành viên POST /arena-step = %d %q, mong đợi 403", w.Code, w.Body.String())
	}
	w = e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id+"/arena-step", "")
	if w.Code != http.StatusOK {
		t.Fatalf("thành viên GET /arena-step = %d %q, mong đợi 200", w.Code, w.Body.String())
	}
	// Giá trị thành viên đọc phải là giá trị chủ vừa ghi (0), không phải 9 bị từ chối.
	if got := roomJSON(t, w.Body).Step; got == nil || *got != 0 {
		t.Fatalf("thành viên đọc step = %v, mong đợi 0", got)
	}
}

// AC3: log của handler không chứa token, tên dự án hay nội dung SQL — kể cả ở nhánh 500.
//
// Cách làm theo `TestCloudLogsNoSQL` và `TestRoomSignalZeroSQLInLog`: đóng pool để mọi câu SQL
// hỏng, ép nhánh lỗi, rồi đọc buffer log của router. Dấu nhận dạng là một chuỗi duy nhất đặt trong
// cả tên dự án và body request; nếu nó xuất hiện trong log thì handler đã ghi dữ liệu người dùng.
func TestRoomLogsNoTokenOrSQL(t *testing.T) {
	e := newCloudEnv(t)
	const roomMark = "ZZROOMSECRET"

	w := e.do(t, e.user, "POST", "/api/v1/cloud/projects", cloudJSON("Phòng "+roomMark, "postgres"))
	if w.Code != http.StatusCreated {
		t.Fatalf("tạo dự án = %d %q", w.Code, w.Body.String())
	}
	id := e.body(t, w).Project.ID
	inv := roomInvite(t, e, e.user, id)

	// Lượt chạy bình thường: log có dòng route, không có token.
	e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/baton", "")
	e.do(t, e.other, "POST", "/api/v1/cloud/projects/join", `{"token":`+quote(inv.Token)+`}`)

	if e.buf.Len() == 0 {
		t.Fatal("không có dòng log nào: test không chứng minh được gì")
	}
	if strings.Contains(e.buf.String(), inv.Token) {
		t.Fatalf("log chứa token vé mời: %q", e.buf.String())
	}
	if strings.Contains(e.buf.String(), roomMark) {
		t.Fatalf("log chứa tên dự án: %q", e.buf.String())
	}

	// Nhánh 500: đóng pool để mọi câu SQL hỏng, rồi gọi lại đúng route với token thật.
	e.st.Close()
	w = e.do(t, e.other, "POST", "/api/v1/cloud/projects/join", `{"token":`+quote(inv.Token)+`}`)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("nhánh 500 = %d %q", w.Code, w.Body.String())
	}
	if strings.Contains(e.buf.String(), inv.Token) || strings.Contains(e.buf.String(), roomMark) {
		t.Fatalf("log nhánh 500 chứa dữ liệu người dùng: %q", e.buf.String())
	}
	if !strings.Contains(e.buf.String(), "POST /api/v1/cloud/projects/join 500") {
		t.Fatalf("log thiếu dòng của request 500: %q", e.buf.String())
	}
}

// Task162 (D1): `GET /members` trả chủ dự án + thành viên kèm vai trò cho chủ; thành viên thường
// nhận 403 (policy SELECT của 004 chỉ cho họ thấy hàng của chính mình, nên trả danh sách cụt là
// nói dối); người ngoài nhận 404 để không lộ dự án tồn tại; `:id` không phải UUID nhận 400.
func TestRoomListMembers(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng danh sách thành viên")

	// Chưa mời ai: chỉ có chủ, vai trò owner, không có hàng rỗng.
	w := e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/members", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /members phòng một người = %d %q", w.Code, w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, mong đợi no-store", cc)
	}
	var one struct {
		Members []struct {
			UserID    string  `json:"userId"`
			Name      string  `json:"name"`
			AvatarURL *string `json:"avatarUrl"`
			Role      string  `json:"role"`
		} `json:"members"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &one); err != nil {
		t.Fatalf("body không phải JSON: %q", w.Body.String())
	}
	if len(one.Members) != 1 || one.Members[0].UserID != e.user || one.Members[0].Role != "owner" || one.Members[0].Name != "A" {
		t.Fatalf("danh sách phòng một người = %q, mong đợi đúng chủ A vai trò owner", w.Body.String())
	}
	if one.Members[0].AvatarURL != nil {
		t.Fatalf("avatarUrl phải là null khi chưa có ảnh, nhận %q", w.Body.String())
	}

	// Mời B vào rồi đọc lại: chủ đứng đầu, B có vai trò editor.
	inv := roomInvite(t, e, e.user, id)
	if _, code := roomJoin(t, e, e.other, inv.Token); code != http.StatusOK {
		t.Fatalf("B join = %d", code)
	}
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/members", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /members = %d %q", w.Code, w.Body.String())
	}
	var two struct {
		Members []struct {
			UserID string `json:"userId"`
			Name   string `json:"name"`
			Role   string `json:"role"`
		} `json:"members"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &two); err != nil {
		t.Fatalf("body không phải JSON: %q", w.Body.String())
	}
	if len(two.Members) != 2 {
		t.Fatalf("danh sách có %d người, mong đợi 2: %q", len(two.Members), w.Body.String())
	}
	if two.Members[0].UserID != e.user || two.Members[0].Role != "owner" {
		t.Fatalf("phần tử đầu = %+v, mong đợi chủ dự án", two.Members[0])
	}
	if two.Members[1].UserID != e.other || two.Members[1].Role != "editor" || two.Members[1].Name != "B" {
		t.Fatalf("phần tử thứ hai = %+v, mong đợi B vai trò editor", two.Members[1])
	}

	// Chủ tự mở link mời của chính mình: `POST /join` chèn một hàng `cloud_project_members` cho chủ,
	// nhưng danh sách vẫn phải có chủ đúng MỘT lần. Hai hàng cùng `userId` làm React trùng key, và
	// hàng thành viên của chủ thì không xoá được (`ErrOwnerCannotLeave`) nên nó sẽ nằm lại mãi.
	if _, code := roomJoin(t, e, e.user, roomInvite(t, e, e.user, id).Token); code != http.StatusOK {
		t.Fatalf("chủ join bằng link của mình = %d, mong đợi 200", code)
	}
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/members", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /members sau khi chủ tự join = %d %q", w.Code, w.Body.String())
	}
	var selfJoin struct {
		Members []struct {
			UserID string `json:"userId"`
			Role   string `json:"role"`
		} `json:"members"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &selfJoin); err != nil {
		t.Fatalf("body sau khi chủ tự join không phải JSON: %q", w.Body.String())
	}
	owners := 0
	for _, m := range selfJoin.Members {
		if m.UserID == e.user {
			owners++
			if m.Role != "owner" {
				t.Fatalf("hàng của chủ mang vai trò %q, mong đợi owner", m.Role)
			}
		}
	}
	if owners != 1 || len(selfJoin.Members) != 2 {
		t.Fatalf("danh sách sau khi chủ tự join = %q, mong đợi chủ đúng một lần và đủ 2 người", w.Body.String())
	}

	// Thành viên thường (không phải chủ) nhận 403, không nhận danh sách cụt.
	w = e.do(t, e.other, "GET", "/api/v1/cloud/projects/"+id+"/members", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("thành viên GET /members = %d %q, mong đợi 403", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), e.user) || strings.Contains(w.Body.String(), "members") {
		t.Fatalf("403 làm lộ danh sách: %q", w.Body.String())
	}

	// Xoá thành viên rồi đọc lại: người đã bị xoá phải biến mất khỏi danh sách. Không có ca này
	// thì một câu JOIN sai vẫn trả người đã xoá mà mọi test khác đều xanh.
	if w := e.do(t, e.user, "DELETE", "/api/v1/cloud/projects/"+id+"/members/"+e.other, ""); w.Code != http.StatusNoContent {
		t.Fatalf("chủ xoá thành viên = %d %q, mong đợi 204", w.Code, w.Body.String())
	}
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/members", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /members sau khi xoá = %d %q", w.Code, w.Body.String())
	}
	var afterRemove struct {
		Members []struct {
			UserID string `json:"userId"`
		} `json:"members"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &afterRemove); err != nil {
		t.Fatalf("body sau khi xoá không phải JSON: %q", w.Body.String())
	}
	if len(afterRemove.Members) != 1 || afterRemove.Members[0].UserID != e.user {
		t.Fatalf("danh sách sau khi xoá = %q, mong đợi chỉ còn chủ", w.Body.String())
	}

	// Người ngoài: 404, không lộ dự án tồn tại.
	strangerID := roomProject(t, e, e.other, "Phòng của B")
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+strangerID+"/members", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("người ngoài GET /members = %d %q, mong đợi 404", w.Code, w.Body.String())
	}

	// `:id` không phải UUID = 400, không phải 500.
	w = e.do(t, e.user, "GET", "/api/v1/cloud/projects/khong-phai-uuid/members", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("id không phải UUID = %d %q, mong đợi 400", w.Code, w.Body.String())
	}
}

// AC5: `r.Routes()` không panic trùng handler và liệt kê đủ đường dẫn của hợp đồng
// (7 route của Task161 + `GET /:id/members` của Task162 = 8).
//
// Đây là test cho sai lệch 6 của task161.md: `POST /join` là đoạn tĩnh nằm cạnh tham số `:id`
// trong cùng nhóm route, và Gin có thể panic `':id' in new path conflicts with existing wildcard`.
// Đăng ký xong mà không panic thì `Routes()` liệt kê được; nếu panic thật thì test này đỏ ngay khi
// `newCloudEnv` chạy `MountCloud`.
func TestRoomRoutesRegistered(t *testing.T) {
	e := newCloudEnv(t)

	// Mong đợi: 6 mục hợp đồng, trong đó arena-step có hai method nên tổng 7 route.
	want := map[string]int{
		"POST /api/v1/cloud/projects/:id/invite":         1,
		"POST /api/v1/cloud/projects/join":               1,
		"GET /api/v1/cloud/projects/:id/members":         1,
		"DELETE /api/v1/cloud/projects/:id/members/:uid": 1,
		"GET /api/v1/cloud/projects/:id/baton":           1,
		"POST /api/v1/cloud/projects/:id/baton/claim":    1,
		"POST /api/v1/cloud/projects/:id/arena-step":     1,
		"GET /api/v1/cloud/projects/:id/arena-step":      1,
	}
	got := map[string]int{}
	for _, rt := range e.r.Routes() {
		got[rt.Method+" "+rt.Path]++
	}
	for key, n := range want {
		if got[key] != n {
			t.Fatalf("route %q đăng ký %d lần, mong đợi %d; toàn bộ route: %v", key, got[key], n, got)
		}
	}
	// Không có route phòng nào bị đăng ký hai lần (nếu có, Gin đã panic lúc mount, nhưng kiểm cả
	// trường hợp handler trùng tên mà đường dẫn khác).
	for key, n := range got {
		if strings.HasPrefix(key, "POST /api/v1/cloud/projects") && n > 1 {
			t.Fatalf("route %q đăng ký %d lần", key, n)
		}
	}
}

// TestRoomStoreIsWired kiểm nhanh rằng handler thật sự nối vào tầng store: ghi rồi đọc lại qua
// route khác phải thấy cùng giá trị. Nếu ai đó thay handler bằng stub trả hằng số, test này đỏ.
func TestRoomStoreIsWired(t *testing.T) {
	e := newCloudEnv(t)
	id := roomProject(t, e, e.user, "Phòng nối store")

	if w := e.do(t, e.user, "POST", "/api/v1/cloud/projects/"+id+"/arena-step", `{"step":42}`); w.Code != http.StatusOK {
		t.Fatalf("POST /arena-step = %d %q", w.Code, w.Body.String())
	}
	// Đọc qua route khác (GET /baton) — cùng một hàng `room_baton`, nên phải thấy 42.
	w := e.do(t, e.user, "GET", "/api/v1/cloud/projects/"+id+"/baton", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /baton = %d %q", w.Code, w.Body.String())
	}
	if got := roomJSON(t, w.Body).Step; got == nil || *got != 42 {
		t.Fatalf("GET /baton thấy step %v, mong đợi 42", got)
	}
	// Và ghi trong database thật sự có giá trị đó.
	var stored int
	if err := e.raw.QueryRow(context.Background(),
		`SELECT arena_step FROM room_baton WHERE project_id = $1`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 42 {
		t.Fatalf("arena_step trong database = %d, mong đợi 42", stored)
	}
}
