package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Test phòng cộng tác ở tầng store (SP024 / STR116 / Task161), chạy bằng role `sqllens_app`
// (NOSUPERUSER NOBYPASSRLS) nên RLS có tác dụng thật.
//
// Vì sao bắt buộc phải chạy bằng role bị RLS chặn, không dùng superuser như bộ test handler:
// `POST /join` chỉ có đường chạy nhờ hai policy CHỈ-ĐỌC của `007_room_api.sql` mở bằng GUC
// `app.invite_hash`, và bước ghi hàng thành viên chỉ qua được `WITH CHECK` của
// `004_cloud_rls.sql:94-99` khi `app.owned_projects` có dự án mà vé trỏ tới. Superuser bỏ qua cả
// policy lẫn `WITH CHECK`, nên một test chạy bằng superuser vẫn xanh khi gỡ hẳn
// `set_config('app.invite_hash', ...)` khỏi `WithInvite` — đúng phép đột biến mà `task161.md` đòi
// phải làm đỏ được. Bài học này đã ghi ở `AGENTS.md` từ Task150 (`COPY FROM` + RLS).
//
// Chạy:
//   RLS_TEST_DSN=postgres://postgres:t152@localhost:54495/app161 go test -p 1 ./internal/store -run Room -v

// TestRoomInviteJoinUnderRLS đi hết vòng đời một vé mời bằng role app: tạo vé, join, join lần hai,
// vé sai, vé hết hạn — và kiểm cả hai phía của quyền đọc (thành viên đọc được dự án, KHÔNG đọc
// được hàng vé).
func TestRoomInviteJoinUnderRLS(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// count đọc bằng role chủ (superuser): dùng để kiểm dữ liệu thật trong bảng, không phụ thuộc
	// ngữ cảnh tenant của phiên nào.
	count := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := e.owner.pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("đếm bằng role chủ: %v", err)
		}
		return n
	}

	inv, err := e.app.CreateInvite(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("CreateInvite bằng role app: %v", err)
	}
	if inv.Role != inviteRole {
		t.Fatalf("vai trò của vé = %q, mong đợi %q", inv.Role, inviteRole)
	}
	// 32 byte ngẫu nhiên mã hoá base64url không đệm ra đúng 43 ký tự, cùng khuôn `CreateSession`.
	if len(inv.Token) != 43 {
		t.Fatalf("độ dài token = %d, mong đợi 43", len(inv.Token))
	}
	if d := time.Until(inv.ExpiresAt); d < 23*time.Hour || d > 25*time.Hour {
		t.Fatalf("hạn vé còn %v, mong đợi khoảng 24 giờ", d)
	}

	// Database chỉ giữ băm: đúng một hàng, khoá đúng bằng sha256 của token vừa phát.
	if n := count(`SELECT count(*) FROM room_invite_tokens`); n != 1 {
		t.Fatalf("số hàng vé = %d, mong đợi 1", n)
	}
	if n := count(`SELECT count(*) FROM room_invite_tokens WHERE token_hash = $1`, hashToken(inv.Token)); n != 1 {
		t.Fatalf("không tìm thấy hàng vé theo băm sha256 của token (%d hàng)", n)
	}

	// Dũng chưa là thành viên dự án của An: đây đúng là ca mà 007 phải mở đường.
	res, err := e.app.JoinRoom(ctx, rlsUserDung, inv.Token)
	if err != nil {
		t.Fatalf("JoinRoom bằng role app: %v", err)
	}
	if res.ProjectID != rlsProjectAn || res.Role != inviteRole || res.AlreadyMember {
		t.Fatalf("kết quả join = %+v, mong đợi dự án %s vai trò %s và chưa là thành viên",
			res, rlsProjectAn, inviteRole)
	}
	var role string
	if err := e.owner.pool.QueryRow(ctx,
		`SELECT role FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
		rlsProjectAn, rlsUserDung).Scan(&role); err != nil {
		t.Fatalf("không có hàng thành viên sau khi join: %v", err)
	}
	if role != inviteRole {
		t.Fatalf("vai trò đã ghi = %q, mong đợi %q", role, inviteRole)
	}

	// Vào phòng rồi thì đọc được dự án — đây là tiền đề của AC2 (sai lệch 4 của task161.md).
	if n := e.query(t, rlsUserDung, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectAn); n != 1 {
		t.Fatalf("thành viên đọc được %d dòng của dự án vừa vào, mong đợi 1", n)
	}
	// Nhưng KHÔNG đọc được hàng vé: policy của 006 là owner-only, còn policy chỉ-đọc của 007 chỉ
	// mở khi có ngữ cảnh vé — thứ đã chết cùng transaction của lượt join.
	if n := e.query(t, rlsUserDung, `SELECT count(*) FROM room_invite_tokens`); n != 0 {
		t.Fatalf("thành viên đọc được %d hàng vé, mong đợi 0", n)
	}

	// Join lần hai idempotent: không ghi thêm hàng, không đổi vai trò.
	again, err := e.app.JoinRoom(ctx, rlsUserDung, inv.Token)
	if err != nil {
		t.Fatalf("JoinRoom lần hai: %v", err)
	}
	if !again.AlreadyMember || again.Role != inviteRole {
		t.Fatalf("join lần hai = %+v, mong đợi alreadyMember và vai trò %s", again, inviteRole)
	}
	if n := count(`SELECT count(*) FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
		rlsProjectAn, rlsUserDung); n != 1 {
		t.Fatalf("join lần hai để lại %d hàng thành viên, mong đợi 1", n)
	}

	// Vé không tồn tại: ErrInviteInvalid, không phải ErrInviteExpired.
	if _, err := e.app.JoinRoom(ctx, rlsUserChi, "khong-he-ton-tai"); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("vé bịa trả %v, mong đợi ErrInviteInvalid", err)
	}

	// Vé hết hạn: hàng vé có thật nhưng `expires_at` đã qua. Chèn bằng role chủ vì role app không
	// có policy UPDATE trên bảng này (sai lệch 5: link dùng lại được tới hạn, không đánh dấu dùng).
	expiredToken := "ve-da-het-han"
	if _, err := e.owner.pool.Exec(ctx,
		`INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		 VALUES ($1, $2, $3, now() - interval '1 hour')`,
		hashToken(expiredToken), rlsProjectAn, inviteRole); err != nil {
		t.Fatalf("chèn vé hết hạn: %v", err)
	}
	if _, err := e.app.JoinRoom(ctx, rlsUserChi, expiredToken); !errors.Is(err, ErrInviteExpired) {
		t.Fatalf("vé hết hạn trả %v, mong đợi ErrInviteExpired", err)
	}
	// Và vé hết hạn không thêm thành viên nào.
	if n := count(`SELECT count(*) FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
		rlsProjectAn, rlsUserChi); n != 0 {
		t.Fatalf("vé hết hạn vẫn thêm %d hàng thành viên", n)
	}
}

// TestRoomInviteContextDiesWithTransaction là phép chứng minh cho điểm cẩn trọng số 2 của task:
// `app.invite_hash` phải chết cùng transaction của lượt join, không được dính lại trên connection
// trả về pool. Đổi `set_config(..., true)` thành `false` trong `WithInvite` làm test này đỏ.
//
// Cách đo: giữ 3/4 connection của pool nên mọi lời gọi sau buộc dùng chung connection còn lại;
// đọc `pg_backend_pid()` để chắc chắn đúng là cùng một connection, rồi kiểm hai thứ — GUC không
// còn giá trị, và hệ quả thật là không đọc được hàng vé nào.
func TestRoomInviteContextDiesWithTransaction(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	kept := make([]*pgxpool.Conn, 0, 3)
	for i := 0; i < 3; i++ {
		conn, err := e.app.pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		kept = append(kept, conn)
	}
	defer func() {
		for _, c := range kept {
			c.Release()
		}
	}()

	pid := func() int {
		t.Helper()
		var p int
		if err := e.app.pool.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	pidBefore := pid()

	inv, err := e.app.CreateInvite(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("CreateInvite: %v", err)
	}
	if _, err := e.app.JoinRoom(ctx, rlsUserDung, inv.Token); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	if pidAfter := pid(); pidAfter != pidBefore {
		t.Fatalf("lượt join chạy trên connection khác (%d so với %d): test không chứng minh được rò ngữ cảnh",
			pidAfter, pidBefore)
	}

	var setting *string
	if err := e.app.pool.QueryRow(ctx,
		`SELECT NULLIF(current_setting('app.invite_hash', true), '')`).Scan(&setting); err != nil {
		t.Fatal(err)
	}
	if setting != nil {
		t.Fatalf("app.invite_hash còn sót trên connection sau khi join: %q", *setting)
	}

	// Hệ quả thật của việc rò: người vừa join, ở một ngữ cảnh KHÔNG có vé, đọc được hàng vé.
	if n := e.query(t, rlsUserDung, `SELECT count(*) FROM room_invite_tokens`); n != 0 {
		t.Fatalf("đọc được %d hàng vé khi không có ngữ cảnh vé: GUC đã rò sang request sau", n)
	}
}

// TestListMembersUnderRLS chứng minh ListMembers chạy dưới role không phải superuser
// (`rls_test_owner`, NOSUPERUSER NOBYPASSRLS + sở hữu 3 bảng cloud, chân dung Neon thật) đọc
// được đủ thành viên nhờ `app.owned_projects` + `FORCE ROW LEVEL SECURITY`, lọc bỏ hàng trùng
// của chủ nếu chủ tự join, đồng thời chặn thành viên thường (ErrNotOwner) và người ngoài
// (ErrNotFound).
//
// Lưu ý: migration 003 cố ý thu hồi quyền trên `users` khỏi `sqllens_app` (kiểm bằng
// `TestCloudRoleHasNoAuthPrivilege`), nên `sqllens_app` không join được bảng `users`; trên Neon
// API chạy bằng role chủ non-superuser có quyền đọc `users` nhưng vẫn bị `FORCE ROW LEVEL
// SECURITY` chặn trên 3 bảng cloud.
func TestListMembersUnderRLS(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	inv, err := e.app.CreateInvite(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("CreateInvite: %v", err)
	}
	if _, err := e.app.JoinRoom(ctx, rlsUserDung, inv.Token); err != nil {
		t.Fatalf("JoinRoom (Dũng): %v", err)
	}

	ownerStore := e.asNonSuperuserOwner(t)
	if _, err := e.owner.pool.Exec(ctx, `GRANT SELECT ON TABLE public.users TO `+rlsOwnerRole); err != nil {
		t.Fatalf("cấp quyền đọc users cho role chủ: %v", err)
	}

	members, err := ownerStore.ListMembers(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("ListMembers (chủ): %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("số thành viên = %d, mong đợi 2: %+v", len(members), members)
	}
	if members[0].UserID != rlsUserAn || members[0].Role != "owner" {
		t.Fatalf("members[0] = %+v, mong đợi chủ %s vai trò owner", members[0], rlsUserAn)
	}
	if members[1].UserID != rlsUserDung || members[1].Role != "editor" {
		t.Fatalf("members[1] = %+v, mong đợi thành viên %s vai trò editor", members[1], rlsUserDung)
	}

	// Chủ tự mở vé của chính mình: ListMembers vẫn chỉ trả 2 người, không lặp hàng chủ.
	if _, err := e.app.JoinRoom(ctx, rlsUserAn, inv.Token); err != nil {
		t.Fatalf("JoinRoom (chủ tự join): %v", err)
	}
	afterSelfJoin, err := ownerStore.ListMembers(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("ListMembers sau khi chủ tự join: %v", err)
	}
	if len(afterSelfJoin) != 2 {
		t.Fatalf("sau khi chủ tự join có %d người, mong đợi 2 (chủ không được lặp): %+v",
			len(afterSelfJoin), afterSelfJoin)
	}

	// Thành viên thường: ErrNotOwner (403).
	if _, err := ownerStore.ListMembers(ctx, rlsUserDung, rlsProjectAn); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("thành viên thường ListMembers trả %v, mong đợi ErrNotOwner", err)
	}

	// Người ngoài: ErrNotFound (404).
	if _, err := ownerStore.ListMembers(ctx, rlsUserChi, rlsProjectAn); !errors.Is(err, ErrNotFound) {
		t.Fatalf("người ngoài ListMembers trả %v, mong đợi ErrNotFound", err)
	}
}

// TestGetBatonUnderRLS xác minh owner, editor, viewer đều gọi được GetBaton dưới role
// non-superuser chịu FORCE ROW LEVEL SECURITY và nhận đúng myRole, ownerId, ownerName;
// đồng thời người ngoài vẫn nhận ErrNotFound.
func TestGetBatonUnderRLS(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	inv, err := e.app.CreateInvite(ctx, rlsUserAn, rlsProjectAn)
	if err != nil {
		t.Fatalf("CreateInvite: %v", err)
	}
	if _, err := e.app.JoinRoom(ctx, rlsUserDung, inv.Token); err != nil {
		t.Fatalf("JoinRoom (Dũng - editor): %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx,
		`INSERT INTO cloud_project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer')`,
		rlsProjectAn, rlsUserChi); err != nil {
		t.Fatalf("thêm viewer (Chi): %v", err)
	}

	ownerStore := e.asNonSuperuserOwner(t)
	if _, err := e.owner.pool.Exec(ctx, `GRANT SELECT ON TABLE public.users TO `+rlsOwnerRole); err != nil {
		t.Fatalf("cấp quyền đọc users cho role chủ: %v", err)
	}

	for _, tc := range []struct {
		name   string
		userID string
		want   string
	}{
		{name: "owner", userID: rlsUserAn, want: "owner"},
		{name: "editor", userID: rlsUserDung, want: "editor"},
		{name: "viewer", userID: rlsUserChi, want: "viewer"},
	} {
		b, err := ownerStore.GetBaton(ctx, tc.userID, rlsProjectAn)
		if err != nil {
			t.Fatalf("%s GetBaton: %v", tc.name, err)
		}
		if b.MyRole != tc.want || b.OwnerID != rlsUserAn || b.OwnerName == "" {
			t.Fatalf("%s GetBaton = %+v, mong đợi myRole=%s ownerId=%s ownerName!=empty",
				tc.name, b, tc.want, rlsUserAn)
		}
	}

	// Người ngoài không thấy dự án của Bình.
	if _, err := ownerStore.GetBaton(ctx, rlsUserAn, rlsProjectBinh); !errors.Is(err, ErrNotFound) {
		t.Fatalf("người ngoài GetBaton trả %v, mong đợi ErrNotFound", err)
	}
}
