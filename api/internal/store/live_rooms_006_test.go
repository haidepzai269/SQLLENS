package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// Test cho migration 006 — schema phòng cộng tác (SP024 / STR116 / Task160).
//
// Chạy: RLS_TEST_DSN=postgres://postgres:t152@localhost:54492/app go test -p 1 ./internal/store -run LiveRoom006 -v
//
// `RLS_TEST_DSN` phải là superuser trên Postgres localhost (Docker): test cần tạo role và đổi
// chủ sở hữu bảng. Mọi khẳng định RLS chạy bằng role **bị RLS áp dụng** (`sqllens_app`, và một
// role chủ non-superuser dựng riêng ở cuối) — không khẳng định nào chạy bằng superuser, vì
// superuser bỏ qua cả policy lẫn FORCE và sẽ làm test xanh giả (bài học Task150).

// roomTables là hai bảng của migration 006, tách khỏi `cloudTables` (ba bảng của SP023).
var roomTables = []string{"room_invite_tokens", "room_baton"}

const (
	roomTokenAn     = "inv-an-0001-0000000000000000000000000000000000000000"
	roomTokenAnOld  = "inv-an-0002-0000000000000000000000000000000000000000"
	roomTokenBinh   = "inv-binh-01-0000000000000000000000000000000000000000"
	roomTempProject = "77777777-0000-4000-8000-000000000007"
	roomTempUser    = "88888888-0000-4000-8000-000000000008"
	roomOwnerRole   = "room_test_owner"
	roomOwnerPass   = "t160owner"
)

func (e *rlsEnv) queryErr(user, sql string, args ...any) (int, error) {
	var n int
	err := e.app.WithTenant(context.Background(), user, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), sql, args...).Scan(&n)
	})
	return n, err
}

func (e *rlsEnv) execErr(user, sql string, args ...any) (int64, error) {
	var n int64
	err := e.app.WithTenant(context.Background(), user, func(tx pgx.Tx) error {
		tag, err := tx.Exec(context.Background(), sql, args...)
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		return nil
	})
	return n, err
}

// AC2: đọc lại catalog thay vì tin lời khối DO trong migration.
// Kèm ca biên "chạy lại file migration không nhân đôi policy".
func TestLiveRoom006Catalog(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// 1. ENABLE + FORCE trên cả hai bảng.
	for _, tbl := range roomTables {
		var enabled, forced bool
		if err := e.owner.pool.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
			WHERE relnamespace = 'public'::regnamespace AND relname = $1`, tbl).Scan(&enabled, &forced); err != nil {
			t.Fatalf("%s: %v", tbl, err)
		}
		if !enabled || !forced {
			t.Fatalf("%s: rls=%v force=%v, mong đợi cả hai true", tbl, enabled, forced)
		}
	}

	// 2. Đủ 6 policy, không FOR ALL, lệnh ghi có WITH CHECK; đếm đúng theo từng lệnh.
	rows, err := e.owner.pool.Query(ctx, `SELECT c.relname, p.polname, p.polcmd::text, p.polwithcheck IS NOT NULL
		FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
		WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)`, roomTables)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	perTable := map[string]map[string]bool{}
	total := 0
	for rows.Next() {
		var tbl, pol, cmd string
		var hasCheck bool
		if err := rows.Scan(&tbl, &pol, &cmd, &hasCheck); err != nil {
			t.Fatal(err)
		}
		total++
		if cmd == "*" {
			t.Fatalf("policy FOR ALL còn tồn tại: %s.%s", tbl, pol)
		}
		if (cmd == "a" || cmd == "w") && !hasCheck {
			t.Fatalf("policy ghi %s.%s (%s) thiếu WITH CHECK", tbl, pol, cmd)
		}
		if perTable[tbl] == nil {
			perTable[tbl] = map[string]bool{}
		}
		perTable[tbl][cmd] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if total != 6 {
		t.Fatalf("có %d policy trên hai bảng mới, mong đợi đúng 6", total)
	}
	// Token: SELECT/INSERT/DELETE (không UPDATE — token dùng một lần). Baton: SELECT/INSERT/UPDATE.
	for _, cmd := range []string{"r", "a", "d"} {
		if !perTable["room_invite_tokens"][cmd] {
			t.Fatalf("room_invite_tokens thiếu policy lệnh %q (đã có %v)", cmd, perTable["room_invite_tokens"])
		}
	}
	for _, cmd := range []string{"r", "a", "w"} {
		if !perTable["room_baton"][cmd] {
			t.Fatalf("room_baton thiếu policy lệnh %q (đã có %v)", cmd, perTable["room_baton"])
		}
	}

	// 3. GRANT thật cho role app: thiếu quyền thì `permission denied`, không phải RLS chặn.
	for _, tbl := range roomTables {
		for _, priv := range []string{"SELECT", "INSERT"} {
			var ok bool
			if err := e.owner.pool.QueryRow(ctx, `SELECT has_table_privilege('sqllens_app', $1, $2)`, "public."+tbl, priv).Scan(&ok); err != nil {
				t.Fatal(err)
			}
			if !ok {
				t.Fatalf("sqllens_app thiếu %s trên %s", priv, tbl)
			}
		}
	}

	// 4. FK có ON DELETE CASCADE phải có index, nếu không mỗi lần xoá dự án là quét toàn bảng.
	var hasIndex bool
	if err := e.owner.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_indexes
		WHERE schemaname = 'public' AND tablename = 'room_invite_tokens'
		  AND indexdef LIKE '%(project_id)%')`).Scan(&hasIndex); err != nil {
		t.Fatal(err)
	}
	if !hasIndex {
		t.Fatal("room_invite_tokens không có index trên project_id")
	}

	// 5. Ca biên: chạy lại nguyên file migration không lỗi và không nhân đôi policy.
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "006_live_rooms.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.owner.pool.Exec(ctx, string(body)); err != nil {
		t.Fatalf("chạy lại 006: %v", err)
	}
	var after int
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM pg_policies
		WHERE schemaname = 'public' AND tablename = ANY($1)`, roomTables).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != 6 {
		t.Fatalf("sau khi chạy lại 006: %d policy, mong đợi 6", after)
	}
}

// AC1 (+ ca biên): cross-tenant trên hai bảng mới, chạy bằng role `sqllens_app` (non-superuser).
//
// Mọi câu SELECT ở đây đều lọc `project_id` chứ KHÔNG lọc owner, nên chúng thật sự phụ thuộc
// RLS — cuối hàm có phép phản chứng tắt RLS để chứng minh điều đó.
func TestLiveRoom006Migration(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// 1. Owner tạo token cho dự án của mình: phải chạy được (không chặn nhầm người được phép).
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomTokenAn, rlsProjectAn); n != 1 {
		t.Fatalf("An tạo token cho dự án của mình: %d hàng, mong đợi 1", n)
	}
	// 2. An không chèn được token vào dự án của Bình — WITH CHECK của policy chặn.
	if _, err := e.execErr(rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ($1, $2, 'editor', now() + interval '1 hour')`, roomTokenBinh, rlsProjectBinh); err == nil || !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("An chèn token vào dự án của Bình: err=%v, mong đợi vi phạm row-level security", err)
	}
	// 3. An không đọc, sửa, xoá được token của Bình.
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An đọc được %d token của Bình", n)
	}
	if n := e.exec(t, rlsUserAn, `UPDATE room_invite_tokens SET used_at = now() WHERE project_id = $1`, rlsProjectAn); n != 0 {
		t.Fatalf("An sửa được %d token (bảng không có policy UPDATE)", n)
	}
	if n := e.exec(t, rlsUserAn, `DELETE FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An xoá được %d token của Bình", n)
	}
	// 4. Token của An vẫn còn nguyên (không bị chính các lệnh trên đụng tới).
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectAn); n != 1 {
		t.Fatalf("An thấy %d token của mình, mong đợi 1", n)
	}

	// 5. Bình tạo token của Bình, rồi kiểm hai chiều: Bình không thấy token của An.
	if n := e.exec(t, rlsUserBinh, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ($1, $2, 'editor', now() + interval '1 hour')`, roomTokenBinh, rlsProjectBinh); n != 1 {
		t.Fatalf("Bình tạo token: %d hàng, mong đợi 1", n)
	}
	if n := e.query(t, rlsUserBinh, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectAn); n != 0 {
		t.Fatalf("Bình đọc được %d token của An", n)
	}

	// 6. Thành viên `viewer` (Chi) KHÔNG thấy danh sách token của dự án mình được mời:
	//    token là vé vào phòng, chỉ owner phát hành và quản lý.
	if n := e.query(t, rlsUserChi, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("thành viên viewer đọc được %d token của chủ dự án", n)
	}

	// 7. Baton: owner ghi được, thành viên chỉ đọc, người ngoài không thấy gì.
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_baton (project_id, holder_id) VALUES ($1, $2)`, rlsProjectAn, rlsUserAn); n != 1 {
		t.Fatalf("An tạo Baton cho dự án của mình: %d hàng, mong đợi 1", n)
	}
	if _, err := e.execErr(rlsUserAn, `INSERT INTO room_baton (project_id, holder_id) VALUES ($1, $2)`, rlsProjectBinh, rlsUserAn); err == nil || !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("An chèn Baton vào dự án của Bình: err=%v, mong đợi vi phạm row-level security", err)
	}
	if n := e.exec(t, rlsUserBinh, `INSERT INTO room_baton (project_id, holder_id) VALUES ($1, $2)`, rlsProjectBinh, rlsUserBinh); n != 1 {
		t.Fatalf("Bình tạo Baton: %d hàng, mong đợi 1", n)
	}
	if n := e.query(t, rlsUserChi, `SELECT count(*) FROM room_baton WHERE project_id = $1`, rlsProjectBinh); n != 1 {
		t.Fatalf("thành viên Chi đọc Baton của dự án được mời: %d hàng, mong đợi 1", n)
	}
	// Chi là thành viên, không phải owner: cầm gậy lái là quyết định của owner.
	if n := e.exec(t, rlsUserChi, `UPDATE room_baton SET holder_id = $1 WHERE project_id = $2`, rlsUserChi, rlsProjectBinh); n != 0 {
		t.Fatalf("thành viên Chi sửa được Baton: %d hàng, mong đợi 0", n)
	}
	if n := e.exec(t, rlsUserChi, `DELETE FROM room_baton WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("thành viên Chi xoá được Baton: %d hàng, mong đợi 0", n)
	}
	// Người ngoài cuộc (An) không thấy Baton của dự án Bình.
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_baton WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An đọc được %d hàng Baton của Bình", n)
	}
	// Owner cập nhật Baton được (chuyền gậy cho editor Dũng).
	if n := e.exec(t, rlsUserBinh, `UPDATE room_baton SET holder_id = $1, updated_at = now() WHERE project_id = $2`, rlsUserDung, rlsProjectBinh); n != 1 {
		t.Fatalf("chủ dự án chuyền Baton: %d hàng, mong đợi 1", n)
	}

	// 8. Ca biên: role ngoài ('owner') bị CHECK chặn ở tầng bảng.
	if _, err := e.execErr(rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ('inv-bad-role-000000000000000000000000000000000000', $1, 'owner', now() + interval '1 hour')`, rlsProjectAn); err == nil || !strings.Contains(err.Error(), "check") {
		t.Fatalf("role 'owner' trong token: err=%v, mong đợi vi phạm CHECK", err)
	}

	// 9. Ca biên: DB KHÔNG kiểm hạn token — token hết hạn vẫn đọc được. Task161 phải tự kiểm
	//    `expires_at > now()` và `used_at IS NULL`; RLS không làm hộ.
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at, used_at)
		VALUES ($1, $2, 'viewer', now() - interval '1 hour', now())`, roomTokenAnOld, rlsProjectAn); n != 1 {
		t.Fatalf("chèn token hết hạn: %d hàng, mong đợi 1", n)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens
		WHERE token = $1 AND expires_at < now() AND used_at IS NOT NULL`, roomTokenAnOld); n != 1 {
		t.Fatalf("token hết hạn/đã dùng vẫn đọc được: %d hàng, mong đợi 1 (DB không kiểm hạn)", n)
	}

	// 10. ON DELETE CASCADE: xoá dự án thì token và Baton của nó biến mất.
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO cloud_projects (id, owner_id, name, engine)
		VALUES ($1, $2, 'Dự án tạm', 'postgres')`, roomTempProject, rlsUserAn); err != nil {
		t.Fatalf("tạo dự án tạm: %v", err)
	}
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ('inv-temp-000000000000000000000000000000000000', $1, 'viewer', now() + interval '1 hour')`, roomTempProject); n != 1 {
		t.Fatal("không tạo được token cho dự án tạm")
	}
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_baton (project_id, holder_id) VALUES ($1, $2)`, roomTempProject, rlsUserAn); n != 1 {
		t.Fatal("không tạo được Baton cho dự án tạm")
	}
	if _, err := e.owner.pool.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1`, roomTempProject); err != nil {
		t.Fatalf("xoá dự án tạm: %v", err)
	}
	var tokensLeft, batonsLeft int
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, roomTempProject).Scan(&tokensLeft); err != nil {
		t.Fatal(err)
	}
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM room_baton WHERE project_id = $1`, roomTempProject).Scan(&batonsLeft); err != nil {
		t.Fatal(err)
	}
	if tokensLeft != 0 || batonsLeft != 0 {
		t.Fatalf("sau khi xoá dự án: %d token, %d Baton còn lại (mong đợi 0, 0)", tokensLeft, batonsLeft)
	}

	// 11. ON DELETE SET NULL: xoá user đang giữ Baton thì hàng Baton còn, holder_id về NULL.
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO users (id, display_name) VALUES ($1, 'Người tạm')`, roomTempUser); err != nil {
		t.Fatalf("tạo user tạm: %v", err)
	}
	if n := e.exec(t, rlsUserAn, `UPDATE room_baton SET holder_id = $1 WHERE project_id = $2`, roomTempUser, rlsProjectAn); n != 1 {
		t.Fatalf("gán Baton cho user tạm: %d hàng, mong đợi 1", n)
	}
	if _, err := e.owner.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, roomTempUser); err != nil {
		t.Fatalf("xoá user tạm: %v (Baton có thể đang chặn)", err)
	}
	var holder *string
	if err := e.owner.pool.QueryRow(ctx, `SELECT holder_id::text FROM room_baton WHERE project_id = $1`, rlsProjectAn).Scan(&holder); err != nil {
		t.Fatalf("Baton của An biến mất khi xoá user: %v", err)
	}
	if holder != nil {
		t.Fatalf("holder_id = %q sau khi xoá user, mong đợi NULL", *holder)
	}

	// 12. Phép phản chứng: tắt RLS thì cùng câu SELECT thấy token của người khác. Không có
	//     phép này thì toàn bộ test trên xanh cả khi RLS hỏng.
	restore := func() {
		for _, stmt := range []string{
			`ALTER TABLE public.room_invite_tokens ENABLE ROW LEVEL SECURITY`,
			`ALTER TABLE public.room_invite_tokens FORCE ROW LEVEL SECURITY`,
		} {
			if _, err := e.owner.pool.Exec(context.Background(), stmt); err != nil {
				t.Errorf("khôi phục RLS: %v", err)
			}
		}
	}
	t.Cleanup(restore)
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("khi RLS bật: An thấy %d token của Bình, mong đợi 0", n)
	}
	if _, err := e.owner.pool.Exec(ctx, `ALTER TABLE public.room_invite_tokens DISABLE ROW LEVEL SECURITY`); err != nil {
		t.Fatalf("tắt RLS: %v", err)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 1 {
		t.Fatalf("khi RLS TẮT: An thấy %d token của Bình, mong đợi 1 — test cross-tenant không có tác dụng", n)
	}
	restore()
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("sau khi bật lại RLS: An thấy %d token của Bình, mong đợi 0", n)
	}
}

// FORCE là thứ duy nhất bảo vệ role chủ của Neon (API chạy bằng role chủ). Test này dựng đúng
// chân dung đó cho hai bảng mới: role chủ non-superuser, NOSUPERUSER NOBYPASSRLS, rồi chứng minh
// bỏ FORCE là thấy dữ liệu chéo.
func TestLiveRoom006ForceBlocksNonSuperuserOwner(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// Dữ liệu: mỗi người một token trong dự án của mình (ghi bằng role app, ngữ cảnh từng owner).
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomTokenAn, rlsProjectAn); n != 1 {
		t.Fatal("không tạo được token của An")
	}
	if n := e.exec(t, rlsUserBinh, `INSERT INTO room_invite_tokens (token, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomTokenBinh, rlsProjectBinh); n != 1 {
		t.Fatal("không tạo được token của Bình")
	}

	ownerStore := e.roomOwnerStore(t)

	count := func(user string) int {
		t.Helper()
		var n int
		if err := ownerStore.WithTenant(ctx, user, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT count(*) FROM room_invite_tokens`).Scan(&n)
		}); err != nil {
			t.Fatalf("WithTenant(%s) bằng role chủ non-superuser: %v", user, err)
		}
		return n
	}

	// FORCE bật: role chủ cũng chỉ thấy token của chính ngữ cảnh tenant.
	if n := count(rlsUserAn); n != 1 {
		t.Fatalf("role chủ thấy %d token dưới ngữ cảnh An, mong đợi 1 (FORCE phải chặn owner)", n)
	}
	for _, stmt := range []string{
		`ALTER TABLE public.room_invite_tokens NO FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE public.room_baton NO FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := ownerStore.pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("bỏ FORCE: %v", err)
		}
	}
	if n := count(rlsUserAn); n != 2 {
		t.Fatalf("sau khi bỏ FORCE, role chủ thấy %d token, mong đợi 2 — FORCE không có tác dụng", n)
	}
	for _, stmt := range []string{
		`ALTER TABLE public.room_invite_tokens FORCE ROW LEVEL SECURITY`,
		`ALTER TABLE public.room_baton FORCE ROW LEVEL SECURITY`,
	} {
		if _, err := ownerStore.pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("bật lại FORCE: %v", err)
		}
	}
	if n := count(rlsUserAn); n != 1 {
		t.Fatalf("sau khi bật lại FORCE, role chủ thấy %d token, mong đợi 1", n)
	}
}

// roomOwnerStore dựng role chủ non-superuser sở hữu **cả năm** bảng (chân dung Neon: API chạy
// bằng role chủ) và trả Store kết nối bằng chính role đó. Phải sở hữu cả `cloud_projects` vì
// `WithTenant` đọc bảng đó để dựng `app.owned_projects`; thiếu quyền là lỗi `permission denied`
// chứ không phải RLS.
func (e *rlsEnv) roomOwnerStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()

	all := append(append([]string{}, cloudTables...), roomTables...)
	owners := map[string]string{}
	for _, tbl := range all {
		var owner string
		if err := e.owner.pool.QueryRow(ctx, `SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
			WHERE c.relnamespace = 'public'::regnamespace AND c.relname = $1`, tbl).Scan(&owner); err != nil {
			t.Fatalf("đọc chủ sở hữu %s: %v", tbl, err)
		}
		owners[tbl] = owner
	}
	if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`DO $$ BEGIN
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN
			CREATE ROLE %s LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '%s';
		END IF;
	END $$;`, roomOwnerRole, roomOwnerRole, roomOwnerPass)); err != nil {
		t.Fatalf("tạo role chủ cho bảng phòng: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`ALTER ROLE %s NOSUPERUSER NOBYPASSRLS PASSWORD '%s'`, roomOwnerRole, roomOwnerPass)); err != nil {
		t.Fatalf("siết role chủ: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`GRANT USAGE ON SCHEMA public TO %s`, roomOwnerRole)); err != nil {
		t.Fatalf("cấp USAGE cho role chủ: %v", err)
	}
	for _, tbl := range all {
		if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`ALTER TABLE public.%s OWNER TO %s`, tbl, roomOwnerRole)); err != nil {
			t.Fatalf("chuyển %s sang role chủ: %v", tbl, err)
		}
	}
	// Đăng ký cleanup TRƯỚC openAs để LIFO chạy Close trước DROP ROLE.
	t.Cleanup(func() {
		for _, tbl := range all {
			if _, err := e.owner.pool.Exec(context.Background(),
				fmt.Sprintf(`ALTER TABLE public.%s OWNER TO %s`, tbl, owners[tbl])); err != nil {
				t.Errorf("trả quyền sở hữu %s: %v", tbl, err)
			}
		}
		// Sau khi trả quyền, role không còn sở hữu gì: DROP OWNED không xoá bảng nào.
		if _, err := e.owner.pool.Exec(context.Background(), fmt.Sprintf(`DROP OWNED BY %s`, roomOwnerRole)); err != nil {
			t.Errorf("DROP OWNED BY role chủ: %v", err)
		}
		if _, err := e.owner.pool.Exec(context.Background(), `DROP ROLE IF EXISTS `+roomOwnerRole); err != nil {
			t.Errorf("xoá role chủ: %v", err)
		}
	})
	return openAs(t, e.dsn, roomOwnerRole, roomOwnerPass)
}
