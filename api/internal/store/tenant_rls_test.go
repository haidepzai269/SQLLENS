package store

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Test cross-tenant thật cho RLS (SP023 / Task152).
//
// Chạy: RLS_TEST_DSN=postgres://postgres:t150@localhost:54491/app go test ./internal/store -run RLS -v
//
// `RLS_TEST_DSN` phải là tài khoản **superuser trên database localhost** (Docker), vì test cần
// tạo role, đặt mật khẩu và chuyển quyền sở hữu bảng. Test KHÔNG mock database: mọi khẳng định
// đều chạy trên PostgreSQL thật, role app `sqllens_app` (NOSUPERUSER NOBYPASSRLS) là chủ thể bị
// RLS chặn. Thiếu biến môi trường thì skip rõ ràng, không âm thầm bỏ qua.

const (
	rlsDSNEnv    = "RLS_TEST_DSN"
	rlsAppName   = "sqllens_app"
	rlsAppPass   = "t152"
	rlsOwnerRole = "rls_test_owner"
	rlsOwnerPass = "t152owner"
)

// Id cố định, khớp `testdata/rls_fixtures.sql`.
const (
	rlsUserAn      = "aaaaaaaa-0000-4000-8000-000000000001"
	rlsUserBinh    = "bbbbbbbb-0000-4000-8000-000000000002"
	rlsUserChi     = "cccccccc-0000-4000-8000-000000000003"
	rlsUserAn2     = "dddddddd-0000-4000-8000-000000000004"
	rlsProjectAn   = "11111111-0000-4000-8000-000000000001"
	rlsProjectBinh = "22222222-0000-4000-8000-000000000002"
	rlsMissing     = "99999999-0000-4000-8000-000000000099"
)

type rlsEnv struct {
	dsn   string
	owner *Store // role của RLS_TEST_DSN: seeding, ALTER TABLE
	app   *Store // role sqllens_app: chủ thể bị RLS chặn
}

func openAs(t *testing.T, raw, user, pass string) *Store {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(user, pass)
	s, err := Open(context.Background(), u.String())
	if err != nil {
		t.Fatalf("kết nối bằng role %s: %v", user, err)
	}
	t.Cleanup(s.Close)
	return s
}

// newRLSEnv dựng database sạch, chạy migration 001–004 rồi nạp fixture.
func newRLSEnv(t *testing.T) *rlsEnv {
	t.Helper()
	raw := os.Getenv(rlsDSNEnv)
	if raw == "" {
		t.Skip("bỏ qua: chưa đặt RLS_TEST_DSN (cần Postgres trong Docker, tài khoản superuser localhost)")
	}
	if err := guardLocalOnly(raw); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	owner, err := openCloudURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.pool.Exec(ctx, `DROP TABLE IF EXISTS cloud_project_members, cloud_tabs, cloud_projects,
		user_vip_redemptions, vip_codes, sessions, identities, users, schema_migrations CASCADE`); err != nil {
		t.Fatal(err)
	}
	if err := owner.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "rls_fixtures.sql"))
	if err != nil {
		t.Fatalf("đọc fixture: %v", err)
	}
	if _, err := owner.pool.Exec(ctx, string(fixture)); err != nil {
		t.Fatalf("nạp fixture: %v", err)
	}
	// Migration 003 cố ý không đặt mật khẩu; test đặt rồi kết nối bằng đúng role app.
	if _, err := owner.pool.Exec(ctx, fmt.Sprintf(`ALTER ROLE %s PASSWORD '%s'`, rlsAppName, rlsAppPass)); err != nil {
		t.Fatalf("đặt mật khẩu role app (cần tài khoản superuser localhost): %v", err)
	}
	return &rlsEnv{dsn: raw, owner: owner, app: openAs(t, raw, rlsAppName, rlsAppPass)}
}

// query chạy một câu SELECT trong ngữ cảnh tenant của user, trả số đếm.
func (e *rlsEnv) query(t *testing.T, user, sql string, args ...any) int {
	t.Helper()
	ctx := context.Background()
	var n int
	if err := e.app.WithTenant(ctx, user, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, sql, args...).Scan(&n)
	}); err != nil {
		t.Fatalf("WithTenant(%s): %v", user, err)
	}
	return n
}

// exec chạy một câu ghi trong ngữ cảnh tenant và trả số hàng bị ảnh hưởng.
func (e *rlsEnv) exec(t *testing.T, user, sql string, args ...any) int64 {
	t.Helper()
	ctx := context.Background()
	var affected int64
	if err := e.app.WithTenant(ctx, user, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return err
		}
		affected = tag.RowsAffected()
		return nil
	}); err != nil {
		t.Fatalf("WithTenant(%s): %v", user, err)
	}
	return affected
}

// AC1: A không đọc được dự án của B, UPDATE/DELETE trả 0 hàng, và dữ liệu của B nguyên vẹn.
func TestRLSCrossTenantCannotReadOrWrite(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects`); n != 1 {
		t.Fatalf("An thấy %d dự án, mong đợi 1 (chỉ của mình)", n)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An đọc được dự án của Bình (%d dòng)", n)
	}
	// Tab của Bình cũng không đọc được.
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An đọc được tab trong dự án của Bình (%d dòng)", n)
	}

	if got := e.exec(t, rlsUserAn, `UPDATE cloud_projects SET name = 'cướp' WHERE id = $1`, rlsProjectBinh); got != 0 {
		t.Fatalf("An sửa được %d hàng của Bình", got)
	}
	if got := e.exec(t, rlsUserAn, `DELETE FROM cloud_projects WHERE id = $1`, rlsProjectBinh); got != 0 {
		t.Fatalf("An xóa được %d hàng của Bình", got)
	}

	// Kiểm bằng role chủ: dữ liệu của Bình không bị đụng.
	var name string
	var tabs int
	if err := e.owner.pool.QueryRow(ctx, `SELECT name FROM cloud_projects WHERE id = $1`, rlsProjectBinh).Scan(&name); err != nil {
		t.Fatalf("dự án của Bình biến mất: %v", err)
	}
	if name != "Dự án của Bình" {
		t.Fatalf("tên dự án của Bình bị đổi thành %q", name)
	}
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, rlsProjectBinh).Scan(&tabs); err != nil || tabs != 1 {
		t.Fatalf("tab của Bình: n=%d err=%v", tabs, err)
	}
}

// AC2: A không chèn được tab vào dự án của B — WITH CHECK của policy chặn.
func TestRLSCrossTenantInsertTabRejected(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()
	err := e.app.WithTenant(ctx, rlsUserAn, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO cloud_tabs (project_id, name, sql) VALUES ($1, 'x', 'SELECT 3')`, rlsProjectBinh)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("INSERT tab vào dự án của Bình: err=%v, mong đợi vi phạm row-level security", err)
	}
	var tabs int
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, rlsProjectBinh).Scan(&tabs); err != nil || tabs != 1 {
		t.Fatalf("tab lạ đã lọt vào dự án của Bình: n=%d err=%v", tabs, err)
	}
	// Chèn tab vào dự án của chính mình vẫn phải chạy được (không chặn nhầm).
	if got := e.exec(t, rlsUserAn, `INSERT INTO cloud_tabs (project_id, name, sql) VALUES ($1, 'mine', 'SELECT 4')`, rlsProjectAn); got != 1 {
		t.Fatalf("An chèn tab vào dự án của mình: %d hàng, mong đợi 1", got)
	}
}

// AC3: thành viên được mời đọc được dự án và tab của chủ, nhưng không xóa được dự án.
func TestRLSMemberReadsButCannotDelete(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	if n := e.query(t, rlsUserChi, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh); n != 1 {
		t.Fatalf("thành viên Chi đọc dự án được chia sẻ: %d dòng, mong đợi 1", n)
	}
	if n := e.query(t, rlsUserChi, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, rlsProjectBinh); n != 1 {
		t.Fatalf("thành viên Chi đọc tab của dự án được chia sẻ: %d dòng, mong đợi 1", n)
	}
	// Thành viên không sở hữu: mọi lệnh ghi vào dự án đều 0 hàng.
	if got := e.exec(t, rlsUserChi, `DELETE FROM cloud_projects WHERE id = $1`, rlsProjectBinh); got != 0 {
		t.Fatalf("thành viên xóa được dự án (%d hàng)", got)
	}
	if got := e.exec(t, rlsUserChi, `UPDATE cloud_projects SET name = 'x' WHERE id = $1`, rlsProjectBinh); got != 0 {
		t.Fatalf("thành viên sửa được dự án (%d hàng)", got)
	}
	var projects int
	if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh).Scan(&projects); err != nil || projects != 1 {
		t.Fatalf("dự án của Bình: n=%d err=%v", projects, err)
	}
}

// AC4: hai lượt WithTenant liên tiếp trên CÙNG connection không thấy dữ liệu của nhau.
func TestRLSContextLeakOnSamePool(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// Giữ 3/4 connection để hai lượt WithTenant buộc phải dùng chung connection còn lại.
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

	run := func(user string) (pid, n int) {
		t.Helper()
		if err := e.app.WithTenant(ctx, user, func(tx pgx.Tx) error {
			if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
				return err
			}
			return tx.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&n)
		}); err != nil {
			t.Fatalf("WithTenant(%s): %v", user, err)
		}
		return pid, n
	}
	pidAn, nAn := run(rlsUserAn)
	pidBinh, nBinh := run(rlsUserBinh)
	if pidAn != pidBinh {
		t.Fatalf("hai lượt chạy trên connection khác nhau (%d, %d): test không chứng minh được rò ngữ cảnh", pidAn, pidBinh)
	}
	if nAn != 1 || nBinh != 1 {
		t.Fatalf("trong ngữ cảnh: An thấy %d, Bình thấy %d (mong đợi 1 và 1)", nAn, nBinh)
	}
	// Bình không thấy dự án của An dù dùng lại connection vừa đặt ngữ cảnh của An.
	if n := e.query(t, rlsUserBinh, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectAn); n != 0 {
		t.Fatalf("Bình thấy dự án của An (%d dòng): ngữ cảnh bị rò", n)
	}

	// Connection rảnh không mang danh tính ai, và bảng đóng lại.
	var setting *string
	var visible int
	if err := e.app.pool.QueryRow(ctx, `SELECT NULLIF(current_setting('app.current_user_id', true), '')`).Scan(&setting); err != nil {
		t.Fatal(err)
	}
	if setting != nil {
		t.Fatalf("ngữ cảnh tenant còn sót trên connection: %q", *setting)
	}
	if err := e.app.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatalf("không có ngữ cảnh mà vẫn thấy %d dự án", visible)
	}
}

// AC5: tắt RLS thì truy vấn chéo THẤY dữ liệu — chứng minh test cross-tenant ở trên có tác dụng.
//
// ALTER TABLE giữ khóa ACCESS EXCLUSIVE tới khi transaction kết thúc, nên không để nó mở trong
// lúc role app truy vấn (role app sẽ chờ khóa). Vì vậy tắt/bật bằng autocommit và khôi phục
// trong Cleanup để test sau không chạy trên database đã tắt RLS.
func TestRLSDisabledShowsCrossData(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()
	restore := func() {
		for _, stmt := range []string{
			`ALTER TABLE public.cloud_projects ENABLE ROW LEVEL SECURITY`,
			`ALTER TABLE public.cloud_projects FORCE ROW LEVEL SECURITY`,
		} {
			if _, err := e.owner.pool.Exec(context.Background(), stmt); err != nil {
				t.Errorf("khôi phục RLS: %v", err)
			}
		}
	}
	t.Cleanup(restore)

	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("khi RLS bật: An thấy %d dòng của Bình, mong đợi 0", n)
	}
	if _, err := e.owner.pool.Exec(ctx, `ALTER TABLE public.cloud_projects DISABLE ROW LEVEL SECURITY`); err != nil {
		t.Fatalf("tắt RLS: %v", err)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh); n != 1 {
		t.Fatalf("khi RLS TẮT: An thấy %d dòng của Bình, mong đợi 1 — test cross-tenant không có tác dụng", n)
	}
	restore()
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("sau khi bật lại: An thấy %d dòng của Bình, mong đợi 0", n)
	}
}

// asNonSuperuserOwner dựng chân dung Neon: role chủ **không phải superuser**, không BYPASSRLS,
// sở hữu cả 3 bảng, rồi trả Store kết nối bằng chính role đó. Đây là ca duy nhất chứng minh
// `FORCE ROW LEVEL SECURITY` và các câu ghi có tác dụng với chính role chạy API: superuser luôn
// bỏ qua RLS nên test bằng superuser (như bộ test handler của Task150) không thấy gì.
func (e *rlsEnv) asNonSuperuserOwner(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()

	var exists bool
	if err := e.owner.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, rlsOwnerRole).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if !exists {
		if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`CREATE ROLE %s LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '%s'`, rlsOwnerRole, rlsOwnerPass)); err != nil {
			t.Fatalf("tạo role chủ: %v", err)
		}
	}
	if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`ALTER ROLE %s NOSUPERUSER NOBYPASSRLS PASSWORD '%s'`, rlsOwnerRole, rlsOwnerPass)); err != nil {
		t.Fatalf("đặt mật khẩu role chủ: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`GRANT CREATE, USAGE ON SCHEMA public TO %s`, rlsOwnerRole)); err != nil {
		t.Fatalf("cấp quyền schema cho role chủ: %v", err)
	}
	var dsnUser string
	if err := e.owner.pool.QueryRow(ctx, `SELECT current_user`).Scan(&dsnUser); err != nil {
		t.Fatal(err)
	}
	for _, tbl := range cloudTables {
		if _, err := e.owner.pool.Exec(ctx, fmt.Sprintf(`ALTER TABLE public.%s OWNER TO %s`, tbl, rlsOwnerRole)); err != nil {
			t.Fatalf("chuyển quyền sở hữu %s sang %s: %v", tbl, rlsOwnerRole, err)
		}
	}
	t.Cleanup(func() {
		// Trả quyền sở hữu rồi mới xóa role; DROP OWNED BY khi role còn sở hữu bảng sẽ xóa bảng.
		for _, tbl := range cloudTables {
			_, _ = e.owner.pool.Exec(context.Background(), fmt.Sprintf(`ALTER TABLE public.%s OWNER TO %s`, tbl, dsnUser))
		}
		_, _ = e.owner.pool.Exec(context.Background(), fmt.Sprintf(`DROP OWNED BY %s`, rlsOwnerRole))
		_, _ = e.owner.pool.Exec(context.Background(), fmt.Sprintf(`DROP ROLE IF EXISTS %s`, rlsOwnerRole))
	})
	// Đăng ký Cleanup đóng pool này SAU cleanup trả quyền sở hữu ở trên: LIFO nên Close chạy trước,
	// rồi mới tới DROP ROLE (không xóa được role còn connection đang mở).
	return openAs(t, e.dsn, rlsOwnerRole, rlsOwnerPass)
}

// Chân dung Neon: role chủ non-superuser vẫn bị policy chặn, và FORCE chính là thứ làm điều đó.
func TestRLSOwnerRoleStillBlocked(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()
	ownerStore := e.asNonSuperuserOwner(t)
	count := func() int {
		t.Helper()
		var n int
		if err := ownerStore.WithTenant(ctx, rlsUserAn, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&n)
		}); err != nil {
			t.Fatalf("WithTenant bằng role chủ: %v", err)
		}
		return n
	}

	if n := count(); n != 1 {
		t.Fatalf("role chủ thấy %d dự án, mong đợi 1 (FORCE RLS phải chặn owner)", n)
	}
	// Bỏ FORCE: owner bỏ qua policy, thấy cả dự án của người khác. Đây là lý do phải có FORCE.
	if _, err := ownerStore.pool.Exec(ctx, `ALTER TABLE public.cloud_projects NO FORCE ROW LEVEL SECURITY`); err != nil {
		t.Fatalf("bỏ FORCE: %v", err)
	}
	if n := count(); n != 2 {
		t.Fatalf("sau khi bỏ FORCE, role chủ thấy %d dự án, mong đợi 2 — FORCE không có tác dụng", n)
	}
	if _, err := ownerStore.pool.Exec(ctx, `ALTER TABLE public.cloud_projects FORCE ROW LEVEL SECURITY`); err != nil {
		t.Fatalf("bật lại FORCE: %v", err)
	}
	if n := count(); n != 1 {
		t.Fatalf("sau khi bật lại FORCE, role chủ thấy %d dự án, mong đợi 1", n)
	}
}

// Lỗi chặn phát hiện SAU bàn giao Task150: PostgreSQL từ chối `COPY FROM` trên bảng có RLS
// (`COPY FROM not supported with row-level security`) với mọi role bị RLS áp dụng, và superuser
// là role duy nhất không thấy lỗi — nên bộ test handler chạy bằng superuser đã che mất nó.
// Test này chạy đúng role chủ non-superuser của Neon: lưu dự án CÓ TAB phải thành công.
func TestRLSOwnerRoleCanWriteTabs(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()
	ownerStore := e.asNonSuperuserOwner(t)

	project, err := ownerStore.CreateCloudProject(ctx, rlsUserAn, "Dự án có tab", "postgres", []CloudTab{
		{Name: "01_init.sql", SQL: "SELECT 1"},
		{Name: "02_query.sql", SQL: "SELECT 2"},
	})
	if err != nil {
		t.Fatalf("tạo dự án có tab bằng role chủ non-superuser: %v", err)
	}
	if project.TabCount != 2 {
		t.Fatalf("TabCount = %d, mong đợi 2", project.TabCount)
	}
	got, err := ownerStore.GetCloudProject(ctx, rlsUserAn, project.ID)
	if err != nil {
		t.Fatalf("đọc lại dự án: %v", err)
	}
	if len(got.Tabs) != 2 || got.Tabs[0].Name != "01_init.sql" || got.Tabs[0].SQL != "SELECT 1" || got.Tabs[1].SQL != "SELECT 2" {
		t.Fatalf("tab đọc lại = %+v", got.Tabs)
	}

	// Ghi đè: xóa tab cũ và ghi 3 tab mới trong cùng transaction, vẫn bằng role chủ.
	if _, err := ownerStore.ReplaceCloudProject(ctx, rlsUserAn, project.ID, "Dự án có tab", "postgres", []CloudTab{
		{Name: "a", SQL: "SELECT 'a'"},
		{Name: "b", SQL: "SELECT 'b'"},
		{Name: "c", SQL: "SELECT 'c'"},
	}, nil); err != nil {
		t.Fatalf("ghi đè dự án có tab bằng role chủ non-superuser: %v", err)
	}
	got, err = ownerStore.GetCloudProject(ctx, rlsUserAn, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tabs) != 3 || got.Tabs[2].Name != "c" {
		t.Fatalf("tab sau khi ghi đè = %+v", got.Tabs)
	}

	// Đổi cơ chế ghi không được làm mất lớp bảo vệ: người ngoài vẫn không đọc được tab.
	if n := e.query(t, rlsUserBinh, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, project.ID); n != 0 {
		t.Fatalf("sau khi sửa, người ngoài đọc được %d tab của An", n)
	}
}

// Ca biên: user không tồn tại, project không tồn tại, members rỗng, hai user cùng tên.
func TestRLSEdgeCases(t *testing.T) {
	e := newRLSEnv(t)

	if n := e.query(t, rlsMissing, `SELECT count(*) FROM cloud_projects`); n != 0 {
		t.Fatalf("user không tồn tại thấy %d dự án, mong đợi 0", n)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects WHERE id = $1`, rlsMissing); n != 0 {
		t.Fatalf("project không tồn tại trả %d dòng, mong đợi 0", n)
	}
	// An thứ hai cùng tên hiển thị với An thật: policy so theo id nên không thấy gì.
	if n := e.query(t, rlsUserAn2, `SELECT count(*) FROM cloud_projects`); n != 0 {
		t.Fatalf("user cùng tên thấy %d dự án của An, mong đợi 0", n)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_projects`); n != 1 {
		t.Fatalf("An thật thấy %d dự án, mong đợi 1", n)
	}
	// members rỗng: An không là thành viên dự án nào; Chi thấy đúng hàng của mình.
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM cloud_project_members`); n != 0 {
		t.Fatalf("An thấy %d hàng thành viên, mong đợi 0", n)
	}
	if n := e.query(t, rlsUserChi, `SELECT count(*) FROM cloud_project_members`); n != 1 {
		t.Fatalf("Chi thấy %d hàng thành viên, mong đợi 1", n)
	}
}
