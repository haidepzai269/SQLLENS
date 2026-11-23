package store

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/haidepzai269/SQLLENS/api/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Test RLS + WithTenant (Task151). Cần Postgres thật:
//   T151_DATABASE_URL=postgres://postgres:t150@localhost:54491/app go test ./internal/store -run Tenant -v
//
// Test chạy thật bằng role `sqllens_app` (không superuser, không BYPASSRLS) để RLS có tác dụng:
// superuser luôn bỏ qua RLS nên chỉ kiểm bằng role app mới chứng minh được lớp bảo vệ.
// Tài khoản chạy test phải là superuser trên database localhost, vì test đặt mật khẩu cho role app.

const (
	tenantAppName = "sqllens_app"
	tenantAppPass = "t151"
)

type tenantEnv struct {
	super *Store
	app   *Store
	a, b  string // hai chủ dự án
	c     string // thành viên thứ hai
	pA    string // dự án của a
	pB    string // dự án của b, có a làm thành viên
}

func newTenantEnv(t *testing.T) *tenantEnv {
	t.Helper()
	raw := os.Getenv("T151_DATABASE_URL")
	if raw == "" {
		t.Skip("bỏ qua: chưa đặt T151_DATABASE_URL (cần Postgres trong Docker)")
	}
	if err := guardLocalOnly(raw); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	super, err := openCloudURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(super.Close)
	if _, err := super.pool.Exec(ctx, `DROP TABLE IF EXISTS `+migrations.DropAllTablesSQL+` CASCADE`); err != nil {
		t.Fatal(err)
	}
	if err := super.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	// Migration 003 cố ý không đặt mật khẩu. Test đặt mật khẩu rồi kết nối bằng đúng role app.
	if _, err := super.pool.Exec(ctx, `ALTER ROLE `+tenantAppName+` PASSWORD '`+tenantAppPass+`'`); err != nil {
		t.Fatalf("đặt mật khẩu role app (cần tài khoản superuser localhost): %v", err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(tenantAppName, tenantAppPass)
	app, err := Open(ctx, u.String())
	if err != nil {
		t.Fatalf("kết nối bằng role app: %v", err)
	}
	t.Cleanup(app.Close)

	e := &tenantEnv{super: super, app: app}
	for _, dst := range []*string{&e.a, &e.b, &e.c} {
		if err := super.pool.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('u') RETURNING id::text`).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	e.pA = e.insertProject(t, e.a, "P-A")
	e.pB = e.insertProject(t, e.b, "P-B")
	if _, err := super.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id, name, sql) VALUES ($1, 'bí mật', 'SELECT 42')`, e.pB); err != nil {
		t.Fatal(err)
	}
	if _, err := super.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id) VALUES ($1, $2)`, e.pB, e.a); err != nil {
		t.Fatal(err)
	}
	if _, err := super.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id) VALUES ($1, $2)`, e.pB, e.c); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e *tenantEnv) insertProject(t *testing.T, owner, name string) string {
	t.Helper()
	var id string
	if err := e.super.pool.QueryRow(context.Background(),
		`INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, $2, 'postgres') RETURNING id::text`,
		owner, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// AC1 + AC2 + AC3: đọc lại catalog thay vì tin file migration đã chạy đúng.
func TestTenantRLSCatalog(t *testing.T) {
	e := newTenantEnv(t)
	ctx := context.Background()

	for _, tbl := range cloudTables {
		var enabled, forced bool
		if err := e.super.pool.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
			WHERE relnamespace = 'public'::regnamespace AND relname = $1`, tbl).Scan(&enabled, &forced); err != nil {
			t.Fatalf("%s: %v", tbl, err)
		}
		if !enabled || !forced {
			t.Fatalf("%s: rls=%v force=%v, mong đợi cả hai true", tbl, enabled, forced)
		}
	}

	// AC2: không policy FOR ALL, mỗi lệnh một policy, lệnh ghi có WITH CHECK.
	rows, err := e.super.pool.Query(ctx, `SELECT c.relname, p.polname, p.polcmd::text, p.polwithcheck IS NOT NULL
		FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
		WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1) ORDER BY 1, 3`, cloudTables)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	perTable := map[string]map[string]bool{}
	for rows.Next() {
		var tbl, pol, cmd string
		var hasCheck bool
		if err := rows.Scan(&tbl, &pol, &cmd, &hasCheck); err != nil {
			t.Fatal(err)
		}
		if cmd == "*" {
			t.Fatalf("policy FOR ALL còn tồn tại: %s.%s", tbl, pol)
		}
		if cmd == "a" || cmd == "w" {
			if !hasCheck {
				t.Fatalf("policy ghi %s.%s (%s) thiếu WITH CHECK", tbl, pol, cmd)
			}
		}
		if perTable[tbl] == nil {
			perTable[tbl] = map[string]bool{}
		}
		perTable[tbl][cmd] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, tbl := range cloudTables {
		for _, cmd := range []string{"r", "a", "w", "d"} {
			if !perTable[tbl][cmd] {
				t.Fatalf("%s thiếu policy cho lệnh %q (đã có %v)", tbl, cmd, perTable[tbl])
			}
		}
	}
	// AC3: bảng members phải có policy, nếu không thì bật RLS là khóa sạch.
	if !perTable["cloud_project_members"]["r"] {
		t.Fatal("cloud_project_members bật RLS mà không có policy SELECT: bảng bị khóa sạch")
	}
}

// AC6: chạy migration 004 lần hai không lỗi và không nhân đôi policy.
func TestTenantMigrationTwice(t *testing.T) {
	e := newTenantEnv(t)
	ctx := context.Background()
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "004_cloud_rls.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.super.pool.Exec(ctx, string(body)); err != nil {
		t.Fatalf("chạy lại 004: %v", err)
	}
	var n int
	if err := e.super.pool.QueryRow(ctx, `SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
		WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)`, cloudTables).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 12 {
		t.Fatalf("số policy sau khi chạy lại = %d, mong đợi 12", n)
	}
}

// AC4: WithTenant là đường duy nhất đụng tới set_config/current_setting trong code Go.
func TestTenantOnlyHelperSetsContext(t *testing.T) {
	root := filepath.Join("..", "..")
	forbidden := []string{"set_config", "current_setting"}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		if filepath.Clean(path) == filepath.Join("..", "..", "internal", "store", "tenant.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, f := range forbidden {
			if strings.Contains(string(body), f) {
				t.Errorf("%s dùng %s ngoài internal/store/tenant.go; ngữ cảnh tenant chỉ được đặt qua WithTenant", path, f)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Cross-tenant thật bằng role app: chủ thấy của mình, thành viên thấy dự án được chia sẻ,
// người ngoài không thấy gì, và lệnh ghi vào dự án người khác không có tác dụng.
func TestTenantCrossTenantReads(t *testing.T) {
	e := newTenantEnv(t)
	ctx := context.Background()

	count := func(user, query string) int {
		t.Helper()
		var n int
		if err := e.app.WithTenant(ctx, user, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, query).Scan(&n)
		}); err != nil {
			t.Fatalf("WithTenant: %v", err)
		}
		return n
	}

	// A sở hữu pA và là thành viên của pB: thấy đúng 2 dự án, không thấy dự án của người ngoài.
	if n := count(e.a, `SELECT count(*) FROM cloud_projects`); n != 2 {
		t.Fatalf("A thấy %d dự án, mong đợi 2 (của mình + được chia sẻ)", n)
	}
	// B chỉ thấy pB.
	if n := count(e.b, `SELECT count(*) FROM cloud_projects`); n != 1 {
		t.Fatalf("B thấy %d dự án, mong đợi 1", n)
	}
	// C là thành viên pB, không sở hữu gì: thấy đúng pB.
	if n := count(e.c, `SELECT count(*) FROM cloud_projects`); n != 1 {
		t.Fatalf("C thấy %d dự án, mong đợi 1", n)
	}

	// A đọc được tab của dự án được chia sẻ, nhưng không đọc được tab trong dự án người ngoài
	// (pA không có tab; kiểm bằng cách đếm tab nhìn thấy = 1 của pB).
	var sqlText string
	if err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT sql FROM cloud_tabs`).Scan(&sqlText)
	}); err != nil || sqlText != "SELECT 42" {
		t.Fatalf("A đọc tab: %q err=%v", sqlText, err)
	}

	// Chủ dự án thấy mọi hàng thành viên; thành viên chỉ thấy hàng của mình.
	if n := count(e.b, `SELECT count(*) FROM cloud_project_members`); n != 2 {
		t.Fatalf("B (chủ) thấy %d hàng thành viên, mong đợi 2", n)
	}
	if n := count(e.a, `SELECT count(*) FROM cloud_project_members`); n != 1 {
		t.Fatalf("A (thành viên) thấy %d hàng thành viên, mong đợi 1", n)
	}

	// Ghi vào dự án người khác: không có tác dụng, không lỗi lộ dữ liệu.
	var affected int64
	if err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE cloud_projects SET name = 'cướp' WHERE id = $1`, e.pB)
		if err != nil {
			return err
		}
		affected = tag.RowsAffected()
		tag, err = tx.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1`, e.pB)
		if err != nil {
			return err
		}
		affected += tag.RowsAffected()
		return nil
	}); err != nil {
		t.Fatalf("ghi vào dự án người khác phải im lặng chứ không lỗi: %v", err)
	}
	if affected != 0 {
		t.Fatalf("A sửa/xóa được %d hàng của B", affected)
	}

	// Tạo dự án mang owner_id của người khác: RLS chặn bằng WITH CHECK.
	err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'x', 'postgres')`, e.b)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("INSERT owner_id của người khác: err=%v, mong đợi vi phạm row-level security", err)
	}

	// Dữ liệu của B còn nguyên.
	var name string
	if err := e.super.pool.QueryRow(ctx, `SELECT name FROM cloud_projects WHERE id = $1`, e.pB).Scan(&name); err != nil || name != "P-B" {
		t.Fatalf("dự án của B: name=%q err=%v", name, err)
	}
}

// AC5: hai request liên tiếp trên CÙNG connection không thấy dữ liệu của nhau.
func TestTenantContextLeak(t *testing.T) {
	e := newTenantEnv(t)
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

	run := func(user string) (pid int, n int) {
		t.Helper()
		if err := e.app.WithTenant(ctx, user, func(tx pgx.Tx) error {
			if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
				return err
			}
			return tx.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&n)
		}); err != nil {
			t.Fatalf("WithTenant: %v", err)
		}
		return pid, n
	}
	pidA, nA := run(e.a)
	pidB, nB := run(e.b)
	if pidA != pidB {
		t.Fatalf("hai lượt chạy trên connection khác nhau (%d, %d): test không chứng minh được rò ngữ cảnh", pidA, pidB)
	}
	if nA != 2 || nB != 1 {
		t.Fatalf("trong ngữ cảnh: A thấy %d, B thấy %d", nA, nB)
	}

	// Không còn ngữ cảnh: connection rảnh không mang danh tính ai, và bảng đóng lại.
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

// Xóa dự án của chính mình dưới RLS: tab đi theo nhờ khóa ngoại ON DELETE CASCADE (kiểm tra
// ràng buộc luôn bỏ qua RLS), còn dự án của người khác không bị đụng.
func TestTenantDeleteCascade(t *testing.T) {
	e := newTenantEnv(t)
	ctx := context.Background()
	if _, err := e.super.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id, name, sql) VALUES ($1, 't', 'SELECT 1')`, e.pA); err != nil {
		t.Fatal(err)
	}

	var affected int64
	if err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1`, e.pA)
		if err != nil {
			return err
		}
		affected = tag.RowsAffected()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if affected != 1 {
		t.Fatalf("A xóa dự án của mình: %d hàng, mong đợi 1", affected)
	}

	var tabs, projects int
	if err := e.super.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs WHERE project_id = $1`, e.pA).Scan(&tabs); err != nil {
		t.Fatal(err)
	}
	if err := e.super.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE id = $1`, e.pB).Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if tabs != 0 {
		t.Fatalf("tab của dự án đã xóa còn %d hàng", tabs)
	}
	if projects != 1 {
		t.Fatal("dự án của người khác bị xóa theo")
	}
}

// Ca biên: user id rỗng bị từ chối TRƯỚC khi mở transaction; hủy giữa đường thì rollback;
// bị xóa khỏi members thì mất quyền đọc ngay lượt sau.
func TestTenantEdgeCases(t *testing.T) {
	e := newTenantEnv(t)
	ctx := context.Background()

	if err := e.app.WithTenant(ctx, "", func(pgx.Tx) error {
		t.Fatal("không được chạy fn khi user id rỗng")
		return nil
	}); !errors.Is(err, ErrTenantNoUser) {
		t.Fatalf("user id rỗng: err=%v", err)
	}
	if err := e.app.WithTenant(ctx, "khong-phai-uuid", func(pgx.Tx) error {
		t.Fatal("không được chạy fn khi user id không phải UUID")
		return nil
	}); !errors.Is(err, ErrTenantBadUser) {
		t.Fatalf("user id không phải UUID: err=%v", err)
	}

	// Hủy giữa đường: không để lại dự án nào.
	boom := errors.New("hủy giữa đường")
	err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'nửa vời', 'postgres')`, e.a); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("lỗi giữa đường: %v", err)
	}
	var n int
	if err := e.super.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE name = 'nửa vời'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("transaction hủy mà vẫn ghi %d dòng (err=%v)", n, err)
	}

	// A bị xóa khỏi members của pB: lượt sau không còn thấy dự án đó.
	if _, err := e.super.pool.Exec(ctx, `DELETE FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`, e.pB, e.a); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err := e.app.WithTenant(ctx, e.a, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM cloud_projects`).Scan(&visible)
	}); err != nil {
		t.Fatal(err)
	}
	if visible != 1 {
		t.Fatalf("sau khi bị xóa khỏi members, A thấy %d dự án, mong đợi 1", visible)
	}
}
