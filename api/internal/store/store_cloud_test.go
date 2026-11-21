package store

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/haidepzai269/SQLLENS/api/migrations"
)

// Test cho Task149: migration 003 tạo 3 bảng cloud và role sqllens_app không phải owner.
// Cần Postgres thật: đặt T149_DATABASE_URL, ví dụ postgres://postgres:t149@localhost:54490/app
// Chạy: T149_DATABASE_URL=... go test -count=1 ./internal/store -run Cloud -v

const cloudRole = "sqllens_app"

var cloudTables = []string{"cloud_projects", "cloud_tabs", "cloud_project_members"}

// guardLocalOnly chặn mọi URL không trỏ đúng localhost, vì test xóa bảng thật.
// Phải so Hostname() đã parse chứ không dùng strings.Contains: URL
// "postgres://u:p@localhost:5432@db.invalid:5432/app" có chứa "@localhost:" nhưng
// thật sự trỏ tới db.invalid.
func guardLocalOnly(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("từ chối chạy: không đọc được URL kết nối (%v); test chỉ cho phép database ở localhost", err)
	}
	switch u.Scheme {
	case "postgres", "postgresql":
	default:
		return fmt.Errorf("từ chối chạy: URL phải dùng scheme postgres, nhận %q; test chỉ cho phép database ở localhost", u.Scheme)
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return nil
	}
	return fmt.Errorf("từ chối chạy: host %q không phải localhost; test xóa bảng nên chỉ cho phép database ở localhost", u.Hostname())
}

// openCloudURL kiểm URL rồi mới mở kết nối. Trả lỗi thay vì t.Fatal để test được chính
// đường từ chối (chứng minh bị chặn TRƯỚC khi thử kết nối).
func openCloudURL(raw string) (*Store, error) {
	if err := guardLocalOnly(raw); err != nil {
		return nil, err
	}
	return Open(context.Background(), raw)
}

// applyBaseline chạy 001 và 002 để có bảng users/sessions/identities cho 003 tham chiếu.
// Dùng cho test tự chạy riêng file 003 trong tình huống đặc biệt.
func applyBaseline(t *testing.T, s *Store) {
	t.Helper()
	for _, name := range []string{"001_init.sql", "002_add_user_roles.sql"} {
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			t.Fatalf("đọc %s: %v", name, err)
		}
		if _, err := s.pool.Exec(context.Background(), string(body)); err != nil {
			t.Fatalf("chạy %s: %v", name, err)
		}
	}
}

// newCloudStoreRaw dựng lại database sạch (không chạy migration nào).
func newCloudStoreRaw(t *testing.T) *Store {
	t.Helper()
	raw := os.Getenv("T149_DATABASE_URL")
	if raw == "" {
		t.Skip("bỏ qua: chưa đặt T149_DATABASE_URL (cần Postgres trong Docker)")
	}
	s, err := openCloudURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	resetCloud(t, s)
	// Dọn lại sau mỗi test để không để bảng cloud ở lại làm hỏng test khác trong package.
	t.Cleanup(func() { cleanupCloudTables(t, s) })
	return s
}

// newCloudStoreBare dựng database sạch rồi chạy 001+002 nhưng KHÔNG chạy 003, để test tự
// chạy nguyên văn file 003 trong tình huống riêng (ví dụ đổi role đang chạy).
func newCloudStoreBare(t *testing.T) *Store {
	t.Helper()
	s := newCloudStoreRaw(t)
	applyBaseline(t, s)
	return s
}

// newCloudStore dựng lại database sạch rồi chạy migration thật qua store.Migrate.
func newCloudStore(t *testing.T) *Store {
	t.Helper()
	s := newCloudStoreRaw(t)
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return s
}

// dropCloudRole xóa role sqllens_app. KHÔNG nuốt lỗi: role còn BYPASSRLS sót lại từ lần
// chạy trước sẽ làm test sau kiểm sai (AC3 báo FAIL vì role cũ, không phải vì migration).
func dropCloudRole(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, cloudRole).Scan(&exists); err != nil {
		t.Fatalf("kiểm role %s: %v", cloudRole, err)
	}
	if !exists {
		return
	}
	if _, err := s.pool.Exec(ctx, `DROP OWNED BY sqllens_app`); err != nil {
		t.Fatalf("dọn role: DROP OWNED BY sqllens_app lỗi: %v", err)
	}
	if _, err := s.pool.Exec(ctx, `DROP ROLE sqllens_app`); err != nil {
		// Role là đối tượng cấp CLUSTER, còn GRANT là cấp database: một database khác trên
		// cùng cluster còn cấp quyền cho role là đủ để DROP ROLE thất bại. Đây chính là lỗi
		// mà bản cũ nuốt mất nên test chạy tiếp trên role cũ có thể mang BYPASSRLS.
		t.Fatalf("dọn role: không xóa được role %s: %v\n"+
			"Nguyên nhân thường gặp: một database KHÁC trên cùng cluster còn GRANT cho role này "+
			"(role là cấp cluster, GRANT là cấp database). Xem bằng:\n"+
			"  SELECT datname FROM pg_database WHERE datistemplate = false;\n"+
			"rồi trong từng database chạy:\n"+
			"  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sqllens_app;\n"+
			"  DROP OWNED BY sqllens_app;\n"+
			"  DROP ROLE sqllens_app;", cloudRole, err)
	}
}

// cleanupCloudTables xóa các bảng cloud và role do test này tạo, trả database về trạng thái
// gần như trước khi chạy. Không đụng bảng của 001/002.
func cleanupCloudTables(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DROP TABLE IF EXISTS cloud_project_members, cloud_tabs, cloud_projects CASCADE`); err != nil {
		t.Errorf("dọn bảng cloud: %v", err)
	}
	dropCloudRole(t, s)
}

// resetCloud xóa mọi bảng của 001–003 và role sqllens_app để mỗi test bắt đầu từ database sạch.
// Chỉ dùng trên database localhost đã kiểm ở guardLocalOnly.
func resetCloud(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DROP TABLE IF EXISTS
		cloud_project_members, cloud_tabs, cloud_projects,
		user_vip_redemptions, vip_codes, sessions, identities, users, schema_migrations CASCADE`); err != nil {
		t.Fatalf("dọn bảng: %v", err)
	}
	dropCloudRole(t, s)
}

func cloudSQL(t *testing.T) string {
	t.Helper()
	body, err := migrations.FS.ReadFile("003_cloud_projects.sql")
	if err != nil {
		t.Fatalf("đọc file migration: %v", err)
	}
	return string(body)
}

// TestCloudMigrateCleanDatabase là AC1: database sạch, migration thật tạo đủ 3 bảng,
// đúng kiểu, đúng khóa ngoại ON DELETE CASCADE, đúng khóa chính, CHECK và index.
func TestCloudMigrateCleanDatabase(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()

	for _, tbl := range cloudTables {
		var n int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`, tbl).Scan(&n); err != nil || n != 1 {
			t.Fatalf("bảng %s: n=%d err=%v", tbl, n, err)
		}
	}

	// Kiểu cột và NOT NULL đúng hợp đồng trong task149.md.
	type col struct {
		name, typ string
		notNull   bool
		hasDef    bool
	}
	want := map[string][]col{
		"cloud_projects": {
			{"id", "uuid", true, true}, {"owner_id", "uuid", true, false},
			{"name", "text", true, false}, {"engine", "text", true, false},
			{"created_at", "timestamp with time zone", true, true},
			{"updated_at", "timestamp with time zone", true, true},
		},
		"cloud_tabs": {
			{"id", "uuid", true, true}, {"project_id", "uuid", true, false},
			{"name", "text", true, true}, {"sql", "text", true, true},
			{"position", "integer", true, true},
			{"updated_at", "timestamp with time zone", true, true},
		},
		"cloud_project_members": {
			{"project_id", "uuid", true, false}, {"user_id", "uuid", true, false},
			{"role", "text", true, true},
		},
	}
	for tbl, cols := range want {
		rows, err := s.pool.Query(ctx, `SELECT column_name, data_type, is_nullable, column_default IS NOT NULL
			FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, tbl)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]col{}
		for rows.Next() {
			var c col
			var nullable string
			if err := rows.Scan(&c.name, &c.typ, &nullable, &c.hasDef); err != nil {
				t.Fatal(err)
			}
			c.notNull = nullable == "NO"
			got[c.name] = c
		}
		rows.Close()
		for _, w := range cols {
			g, ok := got[w.name]
			if !ok {
				t.Fatalf("%s thiếu cột %s", tbl, w.name)
			}
			if g.typ != w.typ || g.notNull != w.notNull || g.hasDef != w.hasDef {
				t.Fatalf("%s.%s = %+v, mong đợi %+v", tbl, w.name, g, w)
			}
		}
	}

	// Khóa ngoại phải là ON DELETE CASCADE đúng bảng đích.
	fks := []struct{ tbl, col, ref string }{
		{"cloud_projects", "owner_id", "users"},
		{"cloud_tabs", "project_id", "cloud_projects"},
		{"cloud_project_members", "project_id", "cloud_projects"},
		{"cloud_project_members", "user_id", "users"},
	}
	for _, f := range fks {
		var n int
		err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_constraint k
			JOIN pg_class t ON t.oid = k.conrelid
			JOIN pg_namespace n ON n.oid = t.relnamespace
			JOIN pg_class rt ON rt.oid = k.confrelid
			WHERE n.nspname = 'public' AND t.relname = $1 AND k.contype = 'f'
			  AND k.confdeltype = 'c' AND rt.relname = $3
			  AND (SELECT array_agg(a.attname::text) FROM unnest(k.conkey) AS c(attnum)
			         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum) = ARRAY[$2]::text[]`,
			f.tbl, f.col, f.ref).Scan(&n)
		if err != nil || n != 1 {
			t.Fatalf("khóa ngoại %s(%s) -> %s ON DELETE CASCADE: n=%d err=%v", f.tbl, f.col, f.ref, n, err)
		}
	}

	// Khóa chính đúng cột.
	pks := []struct{ tbl, cols string }{
		{"cloud_projects", "id"},
		{"cloud_tabs", "id"},
		{"cloud_project_members", "project_id,user_id"},
	}
	for _, p := range pks {
		var got []string
		err := s.pool.QueryRow(ctx, `SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_constraint k
			JOIN pg_class t ON t.oid = k.conrelid
			JOIN pg_namespace n ON n.oid = t.relnamespace
			JOIN LATERAL unnest(k.conkey) AS c(attnum) ON true
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.attnum
			WHERE n.nspname = 'public' AND t.relname = $1 AND k.contype = 'p'`, p.tbl).Scan(&got)
		want := strings.Split(p.cols, ",")
		if err != nil || len(got) != len(want) {
			t.Fatalf("khóa chính %s: %v err=%v", p.tbl, got, err)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("khóa chính %s = %v, mong đợi %v", p.tbl, got, want)
			}
		}
	}

	// CHECK của engine và role phải chặn giá trị ngoài danh sách.
	var userID string
	if err := s.pool.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('A') RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'p', 'oracle')`, userID); err == nil {
		t.Fatal("engine ngoài danh sách phải bị CHECK chặn")
	}
	var projectID string
	if err := s.pool.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'p', 'postgres') RETURNING id::text`, userID).Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')`, projectID, userID); err == nil {
		t.Fatal("role thành viên ngoài danh sách phải bị CHECK chặn")
	}
	// Giá trị mặc định của name/sql/position/role đúng hợp đồng.
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id) VALUES ($1)`, projectID); err != nil {
		t.Fatal(err)
	}
	var name, sql string
	var position int
	if err := s.pool.QueryRow(ctx, `SELECT name, sql, position FROM cloud_tabs WHERE project_id = $1`, projectID).Scan(&name, &sql, &position); err != nil || name != "" || sql != "" || position != 0 {
		t.Fatalf("giá trị mặc định cloud_tabs = %q %q %d err=%v", name, sql, position, err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id) VALUES ($1, $2)`, projectID, userID); err != nil {
		t.Fatal(err)
	}
	var memberRole string
	if err := s.pool.QueryRow(ctx, `SELECT role FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`, projectID, userID).Scan(&memberRole); err != nil || memberRole != "viewer" {
		t.Fatalf("role mặc định = %q err=%v", memberRole, err)
	}

	// Index tối thiểu, đúng thứ tự cột.
	idxs := []struct{ name, tbl, cols string }{
		{"cloud_projects_owner_id_idx", "cloud_projects", "owner_id"},
		{"cloud_tabs_project_id_position_idx", "cloud_tabs", "project_id,position"},
		{"cloud_project_members_user_id_idx", "cloud_project_members", "user_id"},
	}
	for _, ix := range idxs {
		var got []string
		err := s.pool.QueryRow(ctx, `SELECT array_agg(a.attname::text ORDER BY k.ord)
			FROM pg_index i
			JOIN pg_class c ON c.oid = i.indexrelid
			JOIN pg_class t ON t.oid = i.indrelid
			JOIN pg_namespace n ON n.oid = t.relnamespace
			JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
			WHERE n.nspname = 'public' AND c.relname = $1 AND t.relname = $2`, ix.name, ix.tbl).Scan(&got)
		want := strings.Split(ix.cols, ",")
		if err != nil || strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("index %s = %v err=%v, mong đợi %v", ix.name, got, err, want)
		}
	}
}

// TestCloudTableOwnerNotApp là AC2: owner của 3 bảng khác sqllens_app và là role chạy migration.
func TestCloudTableOwnerNotApp(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	var current string
	if err := s.pool.QueryRow(ctx, `SELECT current_user`).Scan(&current); err != nil {
		t.Fatal(err)
	}
	for _, tbl := range cloudTables {
		var owner string
		if err := s.pool.QueryRow(ctx, `SELECT pg_get_userbyid(c.relowner) FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname = $1`, tbl).Scan(&owner); err != nil {
			t.Fatalf("%s: %v", tbl, err)
		}
		if owner == cloudRole {
			t.Fatalf("%s thuộc sở hữu %s: RLS sẽ bị owner bỏ qua", tbl, owner)
		}
		if owner != current {
			t.Fatalf("%s owner = %s, mong đợi role chạy migration %s", tbl, owner, current)
		}
	}
	// Role app không được là thành viên của role owner (nếu là member thì vẫn có thể làm owner kế thừa).
	var member bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM pg_auth_members m
		JOIN pg_roles r ON r.oid = m.member
		WHERE r.rolname = 'sqllens_app')`).Scan(&member); err != nil {
		t.Fatal(err)
	}
	if member {
		t.Fatal("sqllens_app không được là thành viên của role nào khác")
	}
}

// TestCloudRoleAttributes là AC3: rolsuper = false, rolbypassrls = false.
func TestCloudRoleAttributes(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	var super, bypass, canLogin bool
	if err := s.pool.QueryRow(ctx, `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, cloudRole).
		Scan(&super, &bypass, &canLogin); err != nil {
		t.Fatalf("role %s: %v", cloudRole, err)
	}
	if super {
		t.Fatal("rolsuper phải là false")
	}
	if bypass {
		t.Fatal("rolbypassrls phải là false")
	}
	if !canLogin {
		t.Fatal("role app phải LOGIN")
	}
}

// TestCloudPrivileges là AC4: không CREATE trên public, không quyền trên users/sessions/identities,
// trên 3 bảng cloud chỉ có đúng SELECT/INSERT/UPDATE/DELETE.
func TestCloudPrivileges(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()

	var create, usage bool
	if err := s.pool.QueryRow(ctx, `SELECT has_schema_privilege($1, 'public', 'CREATE'), has_schema_privilege($1, 'public', 'USAGE')`, cloudRole).
		Scan(&create, &usage); err != nil {
		t.Fatal(err)
	}
	if create {
		t.Fatal("sqllens_app không được có CREATE trên schema public")
	}
	if !usage {
		t.Fatal("sqllens_app phải có USAGE trên schema public")
	}

	for _, tbl := range []string{"users", "sessions", "identities", "vip_codes", "user_vip_redemptions"} {
		for _, priv := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
			var ok bool
			if err := s.pool.QueryRow(ctx, `SELECT has_table_privilege($1, $2, $3)`, cloudRole, "public."+tbl, priv).Scan(&ok); err != nil {
				t.Fatal(err)
			}
			if ok {
				t.Fatalf("sqllens_app không được có %s trên %s", priv, tbl)
			}
		}
	}

	for _, tbl := range cloudTables {
		var granted []string
		rows, err := s.pool.Query(ctx, `SELECT privilege_type FROM information_schema.role_table_grants
			WHERE grantee = $1 AND table_schema = 'public' AND table_name = $2 ORDER BY privilege_type`, cloudRole, tbl)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var p string
			if err := rows.Scan(&p); err != nil {
				t.Fatal(err)
			}
			granted = append(granted, p)
		}
		rows.Close()
		if got, want := strings.Join(granted, ","), "DELETE,INSERT,SELECT,UPDATE"; got != want {
			t.Fatalf("%s cấp %q, mong đợi %q (không TRUNCATE/REFERENCES/TRIGGER)", tbl, got, want)
		}
		for _, priv := range []string{"TRUNCATE", "REFERENCES", "TRIGGER"} {
			var ok bool
			if err := s.pool.QueryRow(ctx, `SELECT has_table_privilege($1, $2, $3)`, cloudRole, "public."+tbl, priv).Scan(&ok); err != nil {
				t.Fatal(err)
			}
			if ok {
				t.Fatalf("%s không được cấp %s", tbl, priv)
			}
		}
	}
}

// TestCloudMigrateTwice là AC5: chạy migration hai lần không lỗi, schema_migrations có đúng
// một dòng 003_cloud_projects.sql, dữ liệu cũ còn nguyên. Chạy thêm nguyên văn file SQL hai
// lần nữa để chứng minh bản thân file idempotent, không chỉ store.Migrate bỏ qua theo sổ.
func TestCloudMigrateTwice(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()

	var userID, projectID string
	if err := s.pool.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('A') RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'giữ nguyên', 'mysql') RETURNING id::text`, userID).Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id, name, sql, position) VALUES ($1, 'Tab 1', 'SELECT 1', 0)`, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`, projectID, userID); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := s.pool.QueryRow(ctx, `SELECT updated_at::text FROM cloud_projects WHERE id = $1`, projectID).Scan(&before); err != nil {
		t.Fatal(err)
	}

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("Migrate lần hai: %v", err)
	}
	body := cloudSQL(t)
	for i := 1; i <= 2; i++ {
		if _, err := s.pool.Exec(ctx, body); err != nil {
			t.Fatalf("chạy lại nguyên văn 003 lần %d: %v", i, err)
		}
	}

	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = '003_cloud_projects.sql'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("schema_migrations 003 = %d dòng, err=%v", n, err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil || n != 3 {
		t.Fatalf("schema_migrations = %d dòng, err=%v (mong đợi 3: 001, 002, 003)", n, err)
	}

	var name, engine, after, tabSQL, memberRole string
	if err := s.pool.QueryRow(ctx, `SELECT name, engine, updated_at::text FROM cloud_projects WHERE id = $1`, projectID).Scan(&name, &engine, &after); err != nil {
		t.Fatalf("dữ liệu project cũ mất: %v", err)
	}
	if name != "giữ nguyên" || engine != "mysql" || after != before {
		t.Fatalf("project cũ bị đổi: name=%q engine=%q updated_at %q -> %q", name, engine, before, after)
	}
	if err := s.pool.QueryRow(ctx, `SELECT sql FROM cloud_tabs WHERE project_id = $1`, projectID).Scan(&tabSQL); err != nil || tabSQL != "SELECT 1" {
		t.Fatalf("tab cũ = %q err=%v", tabSQL, err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT role FROM cloud_project_members WHERE project_id = $1`, projectID).Scan(&memberRole); err != nil || memberRole != "owner" {
		t.Fatalf("thành viên cũ = %q err=%v", memberRole, err)
	}

	// Owner vẫn không phải role app sau khi chạy lại.
	var owner string
	if err := s.pool.QueryRow(ctx, `SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'cloud_projects'`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner == cloudRole {
		t.Fatalf("sau khi chạy lại, owner = %s", owner)
	}
}

// TestCloudCascadeDelete kiểm ca biên xóa: xóa user xóa luôn dự án, tab, thành viên;
// xóa project xóa tab và thành viên.
func TestCloudCascadeDelete(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	newUser := func() string {
		var id string
		if err := s.pool.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('A') RETURNING id::text`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	owner, member := newUser(), newUser()
	var projectID string
	if err := s.pool.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'p', 'sqlite') RETURNING id::text`, owner).Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id) VALUES ($1)`, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id) VALUES ($1, $2)`, projectID, member); err != nil {
		t.Fatal(err)
	}
	// Xóa thành viên không xóa project.
	if _, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, member); err != nil {
		t.Fatal(err)
	}
	var tabs, members int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM cloud_tabs), (SELECT count(*) FROM cloud_project_members)`).Scan(&tabs, &members); err != nil {
		t.Fatal(err)
	}
	if tabs != 1 || members != 0 {
		t.Fatalf("xóa thành viên: tabs=%d members=%d", tabs, members)
	}
	// Xóa project xóa tab.
	if _, err := s.pool.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1`, projectID); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM cloud_tabs`).Scan(&tabs); err != nil || tabs != 0 {
		t.Fatalf("xóa project phải xóa tab: %d err=%v", tabs, err)
	}
	// Xóa chủ sở hữu xóa project rồi tab.
	var pid string
	if err := s.pool.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, 'p2', 'postgres') RETURNING id::text`, owner).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_tabs (project_id) VALUES ($1)`, pid); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, owner); err != nil {
		t.Fatal(err)
	}
	var projects int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM cloud_projects), (SELECT count(*) FROM cloud_tabs)`).Scan(&projects, &tabs); err != nil {
		t.Fatal(err)
	}
	if projects != 0 || tabs != 0 {
		t.Fatalf("xóa user phải xóa project và tab: projects=%d tabs=%d", projects, tabs)
	}
}

// TestCloudRoleAlreadyExists kiểm ca biên: role đã tồn tại thì không lỗi và không đổi mật khẩu.
func TestCloudRoleAlreadyExists(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	// Đặt mật khẩu mới rồi chạy lại nguyên văn 003, mật khẩu phải giữ nguyên.
	// Không skip khi lệnh này lỗi: chạy bằng role không đủ quyền thì chính là ca biên của
	// lỗi "ALTER ROLE im lặng thất bại" (xem TestCloudRoleWrongAttributesFails), không được
	// bỏ qua âm thầm.
	if _, err := s.pool.Exec(ctx, `ALTER ROLE sqllens_app PASSWORD 'mat-khau-thu'`); err != nil {
		t.Fatalf("đặt mật khẩu role: %v", err)
	}
	var before string
	if err := s.pool.QueryRow(ctx, `SELECT rolpassword FROM pg_authid WHERE rolname = $1`, cloudRole).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, cloudSQL(t)); err != nil {
		t.Fatalf("chạy lại 003 khi role đã tồn tại: %v", err)
	}
	var after string
	if err := s.pool.QueryRow(ctx, `SELECT rolpassword FROM pg_authid WHERE rolname = $1`, cloudRole).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("migration không được đổi mật khẩu của role đã có")
	}
	var super, bypass bool
	if err := s.pool.QueryRow(ctx, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, cloudRole).Scan(&super, &bypass); err != nil {
		t.Fatal(err)
	}
	if super || bypass {
		t.Fatalf("role đã có phải được siết về rolsuper=false, rolbypassrls=false: %v %v", super, bypass)
	}
}

// TestCloudLocalhostGuard là AC7: URL không phải localhost phải bị từ chối TRƯỚC khi kết nối.
// Ca "postgres://u:p@localhost:5432@db.invalid:5432/app" là lý do không dùng strings.Contains:
// chuỗi đó có "@localhost:" nhưng Hostname() thật là db.invalid.
func TestCloudLocalhostGuard(t *testing.T) {
	if os.Getenv("T149_DATABASE_URL") == "" {
		t.Skip("bỏ qua: chưa đặt T149_DATABASE_URL (cần Postgres trong Docker)")
	}
	refuse := []string{
		"postgres://u:p@localhost:5432@db.invalid:5432/app",
		"postgres://u:p@localhost:5432.evil.com/app",
		"postgres://u:p@db.invalid:5432/app",
		"postgres://u:p@127.0.0.1.evil.com:5432/app",
		"postgres://u:p@localhost.evil.com/app",
		"mysql://u:p@localhost:5432/app",
	}
	for _, raw := range refuse {
		if err := guardLocalOnly(raw); err == nil {
			t.Fatalf("phải từ chối URL %q", raw)
		}
		// Bị chặn trước khi thử kết nối: không có Store nào được tạo.
		if s, err := openCloudURL(raw); err == nil {
			s.Close()
			t.Fatalf("URL %q lọt qua guard và đã kết nối được", raw)
		}
	}
	for _, raw := range []string{
		"postgres://u:p@localhost:5432/app",
		"postgres://u:p@127.0.0.1:54490/app?sslmode=disable",
		"postgres://u:p@[::1]:5432/app",
	} {
		if err := guardLocalOnly(raw); err != nil {
			t.Fatalf("phải cho qua URL %q: %v", raw, err)
		}
	}
}

// TestCloudPreexistingTableMissingIndexedColumn là hồi quy cho lỗi thứ tự: 3 CREATE INDEX
// từng nằm TRƯỚC khối thêm cột, nên bảng cũ thiếu cột làm migration nổ
// `column "position" does not exist` trước khi cột kịp được thêm.
func TestCloudPreexistingTableMissingIndexedColumn(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()

	// Ca 1: cloud_tabs thiếu cột position (cột có trong index).
	if _, err := s.pool.Exec(ctx, `ALTER TABLE public.cloud_tabs DROP COLUMN position`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, cloudSQL(t)); err != nil {
		t.Fatalf("chạy lại 003 khi cloud_tabs thiếu cột position: %v", err)
	}
	var typ string
	if err := s.pool.QueryRow(ctx, `SELECT data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'cloud_tabs' AND column_name = 'position'`).Scan(&typ); err != nil {
		t.Fatalf("cột position không được thêm lại: %v", err)
	}
	if typ != "integer" {
		t.Fatalf("cột position kiểu %q, mong đợi integer", typ)
	}
	var idx int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes
		WHERE schemaname = 'public' AND indexname = 'cloud_tabs_project_id_position_idx'`).Scan(&idx); err != nil || idx != 1 {
		t.Fatalf("index cloud_tabs_project_id_position_idx = %d err=%v", idx, err)
	}

	// Ca 2: cloud_projects (bảng rỗng) thiếu cột owner_id và khóa ngoại của nó.
	if _, err := s.pool.Exec(ctx, `ALTER TABLE public.cloud_project_members DROP CONSTRAINT cloud_project_members_project_id_fkey`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `ALTER TABLE public.cloud_tabs DROP CONSTRAINT cloud_tabs_project_id_fkey`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `ALTER TABLE public.cloud_projects DROP CONSTRAINT cloud_projects_owner_id_fkey`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `ALTER TABLE public.cloud_projects DROP COLUMN owner_id`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, cloudSQL(t)); err != nil {
		t.Fatalf("chạy lại 003 khi cloud_projects thiếu cột owner_id: %v", err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'cloud_projects' AND column_name = 'owner_id'`).Scan(&typ); err != nil {
		t.Fatalf("cột owner_id không được thêm lại: %v", err)
	}
	if typ != "uuid" {
		t.Fatalf("cột owner_id kiểu %q, mong đợi uuid", typ)
	}
	var fk int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_constraint
		WHERE conrelid = 'public.cloud_projects'::regclass AND contype = 'f' AND confdeltype = 'c'`).Scan(&fk); err != nil || fk != 1 {
		t.Fatalf("khóa ngoại owner_id ON DELETE CASCADE = %d err=%v", fk, err)
	}
}

// makeMigratorRole tạo role chạy migration tối thiểu và cấp đúng quyền cần để 003 chạy được:
// CREATE trên schema public để tạo bảng, REFERENCES trên users để dựng khóa ngoại.
func makeMigratorRole(t *testing.T, s *Store, name string, createRole bool) {
	t.Helper()
	ctx := context.Background()
	opt := "NOCREATEROLE"
	if createRole {
		opt = "CREATEROLE"
	}
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`DO $$
	BEGIN
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%[1]s') THEN
			CREATE ROLE %[1]s LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB %[2]s NOREPLICATION;
		END IF;
	END $$;`, name, opt)); err != nil {
		t.Fatalf("tạo role %s: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), fmt.Sprintf(`DROP OWNED BY %s`, name))
		_, _ = s.pool.Exec(context.Background(), fmt.Sprintf(`DROP ROLE IF EXISTS %s`, name))
	})
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`GRANT CREATE, USAGE ON SCHEMA public TO %s`, name)); err != nil {
		t.Fatalf("cấp quyền schema cho %s: %v", name, err)
	}
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`GRANT REFERENCES ON TABLE public.users TO %s`, name)); err != nil {
		t.Fatalf("cấp REFERENCES trên users cho %s: %v", name, err)
	}
}

// TestCloudRoleWrongAttributesFails là hồi quy cho lỗi im lặng: role sqllens_app đã tồn tại
// mang BYPASSRLS, tài khoản chạy migration không phải superuser nên ALTER ROLE bị từ chối.
// Migration PHẢI báo lỗi nêu rõ thuộc tính sai, không được chỉ WARNING rồi đi tiếp (WARNING
// không hiện qua store.Migrate vì pgx không in NOTICE/WARNING).
func TestCloudRoleWrongAttributesFails(t *testing.T) {
	s := newCloudStoreBare(t)
	ctx := context.Background()

	// Tài khoản chạy migration: NOSUPERUSER + CREATEROLE, đúng kiểu chủ sở hữu database
	// trên Neon (xem _bmad-output/SP023/STR102/ghi-chu-role.md).
	var super bool
	if err := s.pool.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&super); err != nil {
		t.Fatal(err)
	}
	if !super {
		t.Skip("bỏ qua: cần kết nối bằng superuser để dựng role migrator")
	}
	makeMigratorRole(t, s, "t149_migrator_cr", true)
	// Role app đã có sẵn và mang BYPASSRLS.
	if _, err := s.pool.Exec(ctx, `CREATE ROLE sqllens_app LOGIN BYPASSRLS`); err != nil {
		t.Fatalf("tạo role sqllens_app mang BYPASSRLS: %v", err)
	}
	var bypass bool
	if err := s.pool.QueryRow(ctx, `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sqllens_app'`).Scan(&bypass); err != nil || !bypass {
		t.Fatalf("dựng cảnh: rolbypassrls=%v err=%v", bypass, err)
	}

	// Chạy 003 bằng role migrator (không phải superuser) trong MỘT transaction để không
	// để lại bảng dở dang, rồi đòi migration phải thất bại.
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE t149_migrator_cr`); err != nil {
		t.Fatalf("SET LOCAL ROLE t149_migrator_cr: %v", err)
	}
	_, err = tx.Exec(ctx, cloudSQL(t))
	if err == nil {
		t.Fatal("role sqllens_app còn rolbypassrls=true mà migration vẫn thành công: RLS ở Task151 sẽ bị bỏ qua")
	}
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "bypassrls") {
		t.Fatalf("lỗi phải nêu rõ thuộc tính sai (bypassrls), nhận: %v", err)
	}
	if !strings.Contains(err.Error(), cloudRole) {
		t.Fatalf("lỗi phải nêu tên role %s, nhận: %v", cloudRole, err)
	}
	_ = tx.Rollback(ctx)

	// Và role vẫn còn BYPASSRLS: chứng minh migration đã không âm thầm cho qua.
	if err := s.pool.QueryRow(ctx, `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'sqllens_app'`).Scan(&bypass); err != nil || !bypass {
		t.Fatalf("cảnh dựng sai: rolbypassrls=%v err=%v", bypass, err)
	}
}

// TestCloudRoleAbsentNoCreateRole: tài khoản không đủ quyền tạo role thì 3 bảng VẪN được tạo,
// phần role bị bỏ qua (đúng yêu cầu task149.md), không chặn cả migration.
func TestCloudRoleAbsentNoCreateRole(t *testing.T) {
	s := newCloudStoreBare(t)
	ctx := context.Background()

	var super bool
	if err := s.pool.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&super); err != nil {
		t.Fatal(err)
	}
	if !super {
		t.Skip("bỏ qua: cần kết nối bằng superuser để dựng role migrator")
	}
	// migrator NOCREATEROLE, và role app chưa tồn tại (resetCloud đã xóa).
	makeMigratorRole(t, s, "t149_migrator_nocr", false)

	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE t149_migrator_nocr`); err != nil {
		t.Fatalf("SET LOCAL ROLE t149_migrator_nocr: %v", err)
	}
	if _, err := tx.Exec(ctx, cloudSQL(t)); err != nil {
		t.Fatalf("không tạo được role nhưng 3 bảng vẫn phải được tạo, nhận lỗi: %v", err)
	}
	for _, tbl := range cloudTables {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`, tbl).Scan(&n); err != nil || n != 1 {
			t.Fatalf("bảng %s: n=%d err=%v", tbl, n, err)
		}
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, cloudRole).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatalf("tài khoản NOCREATEROLE không thể tạo role %s, nhưng role lại tồn tại", cloudRole)
	}
}

// TestCloudPublicCreatePrivilegeFails: quyền CREATE trên schema public cấp cho PUBLIC không
// thu hồi được bằng REVOKE ... FROM sqllens_app, nên migration phải ĐỌC LẠI
// has_schema_privilege và báo lỗi nêu nguyên nhân + cách sửa, không được im lặng cho qua.
func TestCloudPublicCreatePrivilegeFails(t *testing.T) {
	s := newCloudStoreBare(t)
	ctx := context.Background()

	var super bool
	if err := s.pool.QueryRow(ctx, `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&super); err != nil {
		t.Fatal(err)
	}
	if !super {
		t.Skipf("bỏ qua: cần kết nối bằng superuser để dựng cảnh PUBLIC có CREATE (đang là %s)", "non-superuser")
	}
	// Dựng cảnh: PUBLIC được cấp CREATE trên schema public (mặc định PostgreSQL < 15).
	if _, err := s.pool.Exec(ctx, `GRANT CREATE ON SCHEMA public TO PUBLIC`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.pool.Exec(context.Background(), `REVOKE CREATE ON SCHEMA public FROM PUBLIC`)
	})

	_, err := s.pool.Exec(ctx, cloudSQL(t))
	if err == nil {
		t.Fatal("PUBLIC có CREATE trên schema public mà migration vẫn thành công: sqllens_app tạo được bảng")
	}
	if !strings.Contains(err.Error(), "CREATE") || !strings.Contains(err.Error(), "PUBLIC") {
		t.Fatalf("lỗi phải nêu quyền CREATE và nguyên nhân từ PUBLIC, nhận: %v", err)
	}

	// Chứng minh lỗi là thật: quyền CREATE đến từ PUBLIC nên REVOKE ... FROM sqllens_app
	// (điều migration đã làm) không thu hồi được. Migration chạy trong một transaction nên
	// role sqllens_app đã quay lui; kiểm bằng một role trung tính bất kỳ.
	if _, err := s.pool.Exec(ctx, `CREATE ROLE t149_probe LOGIN NOSUPERUSER NOBYPASSRLS`); err != nil {
		t.Fatalf("tạo role t149_probe: %v", err)
	}
	defer func() { _, _ = s.pool.Exec(context.Background(), `DROP ROLE IF EXISTS t149_probe`) }()
	var create bool
	if err := s.pool.QueryRow(ctx, `SELECT has_schema_privilege('t149_probe', 'public', 'CREATE')`).Scan(&create); err != nil {
		t.Fatalf("kiểm quyền CREATE của role trung tính: %v", err)
	}
	if !create {
		t.Fatal("cảnh dựng sai: role bất kỳ phải có CREATE trên schema public để lỗi trên là thật")
	}
}

// TestCloudPreexistingPartialTable kiểm ca biên: database đã có bảng cùng tên từ bản thử
// nhưng thiếu cột. Migration phải báo lỗi rõ ràng, không DROP, không làm mất dữ liệu.
func TestCloudPreexistingPartialTable(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DROP TABLE cloud_project_members, cloud_tabs, cloud_projects CASCADE`); err != nil {
		t.Fatal(err)
	}
	var userID string
	if err := s.pool.QueryRow(ctx, `INSERT INTO users (display_name) VALUES ('A') RETURNING id::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	// Bảng của "bản thử": thiếu cột engine, updated_at và index.
	if _, err := s.pool.Exec(ctx, `CREATE TABLE cloud_projects (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		name text NOT NULL,
		created_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO cloud_projects (owner_id, name) VALUES ($1, 'du an cu')`, userID); err != nil {
		t.Fatal(err)
	}

	_, err := s.pool.Exec(ctx, cloudSQL(t))
	if err == nil {
		t.Fatal("bảng cũ thiếu cột NOT NULL không có default: migration phải báo lỗi rõ ràng, không được im lặng")
	}
	if !strings.Contains(err.Error(), "cloud_projects") {
		t.Fatalf("lỗi phải nêu tên bảng, nhận: %v", err)
	}

	// Không DROP, dữ liệu cũ còn nguyên.
	var name string
	if err := s.pool.QueryRow(ctx, `SELECT name FROM cloud_projects`).Scan(&name); err != nil || name != "du an cu" {
		t.Fatalf("dữ liệu cũ mất: %q err=%v", name, err)
	}
	// Và bảng không bị thay bằng bảng mới đủ cột.
	var cols int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'cloud_projects'`).Scan(&cols); err != nil || cols != 4 {
		t.Fatalf("số cột cloud_projects = %d err=%v (mong đợi giữ nguyên 4)", cols, err)
	}
}

// TestCloudPreexistingTableMissingCascade: bảng cũ đủ cột nhưng khóa ngoại không CASCADE
// thì phải báo lỗi rõ, không tự thêm khóa ngoại và không xóa dữ liệu.
func TestCloudPreexistingTableMissingCascade(t *testing.T) {
	s := newCloudStore(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DROP TABLE cloud_project_members, cloud_tabs, cloud_projects CASCADE`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `CREATE TABLE cloud_projects (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		owner_id uuid NOT NULL REFERENCES users (id),
		name text NOT NULL,
		engine text NOT NULL CHECK (engine IN ('postgres','mysql','sqlite')),
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	_, err := s.pool.Exec(ctx, cloudSQL(t))
	if err == nil || !strings.Contains(err.Error(), "CASCADE") {
		t.Fatalf("khóa ngoại thiếu CASCADE: phải báo lỗi rõ, nhận: %v", err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_class WHERE relname = 'cloud_projects'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("bảng cũ phải còn: %d err=%v", n, err)
	}
}
