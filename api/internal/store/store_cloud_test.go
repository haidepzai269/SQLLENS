package store

import (
	"context"
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

// newCloudStore dựng lại database sạch rồi chạy migration thật qua store.Migrate.
func newCloudStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("T149_DATABASE_URL")
	if url == "" {
		t.Skip("bỏ qua: chưa đặt T149_DATABASE_URL (cần Postgres trong Docker)")
	}
	if !strings.Contains(url, "@localhost:") && !strings.Contains(url, "@127.0.0.1:") {
		t.Fatal("từ chối chạy: test xóa bảng, chỉ cho phép database ở localhost")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	resetCloud(t, s)
	// Dọn lại sau mỗi test để không để bảng cloud ở lại làm hỏng test khác trong package.
	t.Cleanup(func() { cleanupCloudTables(t, s) })
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return s
}

// cleanupCloudTables xóa các bảng cloud và role do test này tạo, trả database về trạng thái
// gần như trước khi chạy. Không đụng bảng của 001/002.
func cleanupCloudTables(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	_, _ = s.pool.Exec(ctx, `DROP TABLE IF EXISTS cloud_project_members, cloud_tabs, cloud_projects CASCADE`)
	_, _ = s.pool.Exec(ctx, `DO $$
	BEGIN
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
			BEGIN
				EXECUTE 'DROP OWNED BY sqllens_app';
				EXECUTE 'DROP ROLE sqllens_app';
			EXCEPTION WHEN others THEN
				NULL;
			END;
		END IF;
	END $$;`)
}

// resetCloud xóa mọi bảng của 001–003 và role sqllens_app để mỗi test bắt đầu từ database sạch.
// Chỉ dùng trên database localhost đã kiểm ở newCloudStore.
func resetCloud(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DROP TABLE IF EXISTS
		cloud_project_members, cloud_tabs, cloud_projects,
		user_vip_redemptions, vip_codes, sessions, identities, users, schema_migrations CASCADE`); err != nil {
		t.Fatalf("dọn bảng: %v", err)
	}
	// Role là đối tượng cấp cluster: xóa được thì tốt, không xóa được (còn grant ở database khác)
	// thì vẫn dùng role đang có, các AC về thuộc tính và quyền vẫn kiểm được.
	if _, err := s.pool.Exec(ctx, `DO $$
	BEGIN
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqllens_app') THEN
			BEGIN
				EXECUTE 'DROP OWNED BY sqllens_app';
				EXECUTE 'DROP ROLE sqllens_app';
			EXCEPTION WHEN others THEN
				RAISE NOTICE 'giữ nguyên role sqllens_app: %', SQLERRM;
			END;
		END IF;
	END $$;`); err != nil {
		t.Fatalf("dọn role: %v", err)
	}
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
	if _, err := s.pool.Exec(ctx, `ALTER ROLE sqllens_app PASSWORD 'mat-khau-thu'`); err != nil {
		t.Skipf("không đặt được mật khẩu role (cần quyền): %v", err)
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
