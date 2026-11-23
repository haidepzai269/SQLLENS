package store

import (
	"context"
	"crypto/sha256"
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

// roomHash là giá trị duy nhất được phép nằm trong `room_invite_tokens.token_hash`: bảng chỉ
// giữ sha256 của vé, không giữ vé. Test cũng đi đúng đường đó để không dạy sai người sau.
func roomHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

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
	// AC5: `room_baton.holder_id` cũng là FK (`ON DELETE SET NULL`) nên cũng phải có index.
	// Đọc `pg_indexes`, không tin câu CREATE INDEX vừa chạy.
	var holderIdx string
	if err := e.owner.pool.QueryRow(ctx, `SELECT indexdef FROM pg_indexes
		WHERE schemaname = 'public' AND tablename = 'room_baton'
		  AND indexdef LIKE '%(holder_id)%'`).Scan(&holderIdx); err != nil {
		t.Fatalf("room_baton không có index trên holder_id: %v", err)
	}
	if !strings.Contains(holderIdx, "room_baton_holder_id_idx") {
		t.Fatalf("index trên holder_id tên lạ: %s", holderIdx)
	}

	// 5. AC4: `used_at` đã bị xoá (bảng không có policy UPDATE nên cột đó không role nào ghi
	//    được), và `token_hash` đúng khuôn sha256 như `sessions.token_hash`.
	var usedAt bool
	if err := e.owner.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'room_invite_tokens' AND column_name = 'used_at')`).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if usedAt {
		t.Fatal("room_invite_tokens vẫn còn cột used_at: không policy UPDATE nào ghi được cột này")
	}
	var tokenType, checkDef string
	if err := e.owner.pool.QueryRow(ctx, `SELECT data_type FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'room_invite_tokens' AND column_name = 'token_hash'`).Scan(&tokenType); err != nil {
		t.Fatalf("thiếu cột token_hash: %v", err)
	}
	if tokenType != "bytea" {
		t.Fatalf("token_hash kiểu %q, mong đợi bytea (không lưu vé thô)", tokenType)
	}
	if err := e.owner.pool.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conrelid = 'public.room_invite_tokens'::regclass AND contype = 'c'
		  AND pg_get_constraintdef(oid) LIKE '%octet_length%'`).Scan(&checkDef); err != nil {
		t.Fatalf("token_hash thiếu CHECK độ dài 32 byte: %v", err)
	}
	if !strings.Contains(checkDef, "32") {
		t.Fatalf("CHECK trên token_hash không phải 32 byte: %s", checkDef)
	}

	// 6. Ca biên: chạy lại nguyên file migration không lỗi và không nhân đôi policy.
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

// roomFKs đếm khóa ngoại của hai bảng mới bằng cách đọc catalog, không tin câu lệnh migration.
func roomFKs(t *testing.T, s *Store) []string {
	t.Helper()
	rows, err := s.pool.Query(context.Background(), `SELECT t.relname || ':' || k.conname
		FROM pg_constraint k
		JOIN pg_class t ON t.oid = k.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = 'public' AND t.relname = ANY($1) AND k.contype = 'f'
		ORDER BY 1`, roomTables)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// runMigration006 chạy nguyên văn file 006 như người vận hành sẽ chạy.
func runMigration006(t *testing.T, s *Store) error {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "..", "migrations", "006_live_rooms.sql"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(context.Background(), string(body))
	return err
}

// AC1: khóa ngoại phải sống sót qua vòng DROP + Migrate của helper dọn database. Đây là phép
// phản chứng cho L1: trước khi sửa, CASCADE xóa FK nhưng để lại hai bảng con, và
// `CREATE TABLE IF NOT EXISTS` không dựng lại FK — bảng sống thiếu ràng buộc mà test vẫn xanh.
func TestLiveRoom006FKSurvivesReset(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	if got := roomFKs(t, e.owner); len(got) != 3 {
		t.Fatalf("sau Migrate có %d khóa ngoại (%v), mong đợi 3", len(got), got)
	}
	// Dữ liệu mồ côi chỉ phát hiện được nếu FK còn: chèn một token rồi xoá dự án.
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash(roomTokenAn), rlsProjectAn); err != nil {
		t.Fatalf("chèn token: %v", err)
	}

	// Đúng đường đi của sáu helper cũ: DROP rồi Migrate lại.
	resetCloud(t, e.owner)
	if err := e.owner.Migrate(ctx); err != nil {
		t.Fatalf("Migrate lại sau resetCloud: %v", err)
	}

	if got := roomFKs(t, e.owner); len(got) != 3 {
		t.Fatalf("sau DROP + Migrate còn %d khóa ngoại (%v), mong đợi 3 — L1 chưa chết", len(got), got)
	}

	// Và FK phải thật sự thi hành: xoá dự án không được để lại hàng mồ côi ở bảng con nào.
	// resetCloud đã xoá cả `users` nên phải dựng lại người dùng trước khi tạo dự án.
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO users (id, display_name) VALUES ($1, 'Người tạm')`, roomTempUser); err != nil {
		t.Fatalf("tạo user tạm: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO cloud_projects (id, owner_id, name, engine)
		VALUES ($1, $2, 'Dự án tạm', 'postgres')`, roomTempProject, roomTempUser); err != nil {
		t.Fatalf("tạo dự án tạm: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash(roomTokenBinh), roomTempProject); err != nil {
		t.Fatalf("chèn token cho dự án tạm: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO room_baton (project_id, holder_id) VALUES ($1, $2)`, roomTempProject, roomTempUser); err != nil {
		t.Fatalf("chèn Baton cho dự án tạm: %v", err)
	}
	if _, err := e.owner.pool.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1`, roomTempProject); err != nil {
		t.Fatalf("xoá dự án tạm: %v", err)
	}
	for _, tbl := range roomTables {
		var n int
		if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM public.`+tbl+` WHERE project_id = $1`, roomTempProject).Scan(&n); err != nil {
			t.Fatalf("%s: %v", tbl, err)
		}
		if n != 0 {
			t.Fatalf("%s còn %d hàng mồ côi sau khi xoá dự án: khóa ngoại ON DELETE CASCADE không tồn tại", tbl, n)
		}
	}
}

// F1: mọi helper dọn database trong package này phải dọn ĐÚNG thứ nó nhận dọn. Trước khi sửa,
// năm helper DROP thiếu tên hai bảng room_*, nên `DROP ... CASCADE` chỉ xoá khoá ngoại còn bảng
// con sống sót, rồi `CREATE TABLE IF NOT EXISTS` ở lần Migrate sau bỏ qua nó: bảng vĩnh viễn mất
// khoá ngoại mà test vẫn xanh. Test này đi đúng từng đường dọn rồi đếm FK thật từ catalog.
//
// Bốn helper còn lại của cả repo nằm ở package khác (httpapi, auth) nên không gọi được từ đây;
// chúng dùng chung một hằng số với các đường dưới, và TestNoHandCopiedDropList canh việc đó.
func TestLiveRoom006FKSurvivesEveryResetHelper(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// Đường RESET: dọn sạch rồi dựng lại từ đầu, nên sau Migrate phải đủ 3 khoá ngoại.
	for _, c := range []struct {
		name string
		env  func(*testing.T) *Store
	}{
		{"newStore", newStore},
		{"newTenantEnv", func(t *testing.T) *Store { return newTenantEnv(t).super }},
		{"newRLSEnv", func(t *testing.T) *Store { return newRLSEnv(t).owner }},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := c.env(t)
			if got := roomFKs(t, s); len(got) != 3 {
				t.Fatalf("sau %s còn %d khóa ngoại (%v), mong đợi 3 — helper này DROP thiếu bảng nên bảng con sống sót mà mất FK", c.name, len(got), got)
			}
		})
	}

	// resetCloud: dọn sạch rồi Migrate lại ngay trên cùng kết nối.
	t.Run("resetCloud", func(t *testing.T) {
		resetCloud(t, e.owner)
		if err := e.owner.Migrate(ctx); err != nil {
			t.Fatalf("Migrate lại sau resetCloud: %v", err)
		}
		if got := roomFKs(t, e.owner); len(got) != 3 {
			t.Fatalf("sau resetCloud còn %d khóa ngoại (%v), mong đợi 3 — helper này DROP thiếu bảng nên bảng con sống sót mà mất FK", len(got), got)
		}
	})

	// cleanupCloudTables là TEARDOWN, không phải reset: nó cố ý giữ `schema_migrations` để lần
	// Migrate sau không chạy lại 001–006. Bất biến của nó là dọn SẠCH, không để lại bảng con mồ
	// côi — nếu DROP thiếu tên thì hai bảng room_* còn nguyên và mất FK, đúng lỗi L1.
	t.Run("cleanupCloudTables", func(t *testing.T) {
		cleanupCloudTables(t, e.owner)
		var con []string
		rows, err := e.owner.pool.Query(ctx, `SELECT c.relname FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)
			ORDER BY 1`, roomTables)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			con = append(con, name)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if len(con) != 0 {
			t.Fatalf("cleanupCloudTables để lại bảng %v: bảng con sống sót qua CASCADE và mất khóa ngoại (lỗi L1)", con)
		}
	})
}

// AC2: database đã thoái hóa (thiếu bảng nền) thì 006 phải nói rõ thiếu bảng nào, thay vì để
// policy `room_baton_select` nổ `relation ... does not exist`.
func TestLiveRoom006MissingPrerequisite(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// CASCADE vì policy room_baton_select phụ thuộc cloud_project_members.
	if _, err := e.owner.pool.Exec(ctx, `DROP TABLE public.cloud_project_members CASCADE`); err != nil {
		t.Fatalf("dựng cảnh xấu: %v", err)
	}
	err := runMigration006(t, e.owner)
	if err == nil {
		t.Fatal("006 chạy được trên schema thiếu cloud_project_members: phải RAISE EXCEPTION")
	}
	if !strings.Contains(err.Error(), "cloud_project_members") {
		t.Fatalf("lỗi phải nêu tên bảng nền thiếu, nhận: %v", err)
	}
	if strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("lỗi vẫn là lỗi thô của Postgres, không phải thông báo điều kiện tiên quyết: %v", err)
	}
}

// AC3: bảng dở dang cùng tên phải làm 006 thất bại và nêu tên cột thiếu. Đối chứng với 003:
// `TestCloudPreexistingPartialTable` chứng minh 003 đã từ chối bảng dở dang từ trước.
func TestLiveRoom006PreexistingPartialTable(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// Ca 1: bảng thiếu hẳn cột.
	t.Run("thieu_cot", func(t *testing.T) {
		if _, err := e.owner.pool.Exec(ctx, `DROP TABLE public.room_invite_tokens CASCADE`); err != nil {
			t.Fatalf("dựng cảnh xấu: %v", err)
		}
		if _, err := e.owner.pool.Exec(ctx, `CREATE TABLE public.room_invite_tokens (
			token text PRIMARY KEY,
			project_id uuid NOT NULL)`); err != nil {
			t.Fatalf("tạo bảng dở dang: %v", err)
		}
		err := runMigration006(t, e.owner)
		if err == nil {
			t.Fatal("006 nhận bảng dở dang rồi in NOTICE thành công: phải RAISE EXCEPTION")
		}
		for _, col := range []string{"token_hash", "role", "expires_at"} {
			if !strings.Contains(err.Error(), col) {
				t.Fatalf("lỗi phải nêu cột thiếu %q, nhận: %v", col, err)
			}
		}
		// Bảng dở dang phải còn nguyên: migration không được DROP để dựng lại.
		var cols int
		if err := e.owner.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'room_invite_tokens'`).Scan(&cols); err != nil {
			t.Fatal(err)
		}
		if cols != 2 {
			t.Fatalf("số cột room_invite_tokens = %d, mong đợi giữ nguyên 2 (không DROP dữ liệu)", cols)
		}
	})

	// Ca 2: bảng ĐỦ cột, ĐỦ ràng buộc, nhưng một cột sai kiểu. Đây là ca duy nhất mà khối 6g
	// (kiểm cột + kiểu) bắt được còn khối 6h (kiểm PK/FK/CHECK/NOT NULL) không bắt được — nhờ
	// vậy test này đỏ nếu ai xoá 6g. Xoá 6g thì 006 in NOTICE thành công trên bảng sai kiểu, và
	// `room_baton.updated_at` giữ kiểu text trong khi code Go đọc bằng time.Time.
	t.Run("sai_kieu_cot", func(t *testing.T) {
		// Ca trước để lại room_invite_tokens dở dang; xoá cả hai để 006 dựng lại bảng token cho
		// đúng, chỉ còn room_baton là bảng sai kiểu cần bắt.
		if _, err := e.owner.pool.Exec(ctx, `DROP TABLE public.room_invite_tokens, public.room_baton CASCADE`); err != nil {
			t.Fatalf("dựng cảnh xấu: %v", err)
		}
		if _, err := e.owner.pool.Exec(ctx, `CREATE TABLE public.room_baton (
			project_id uuid PRIMARY KEY REFERENCES public.cloud_projects (id) ON DELETE CASCADE,
			holder_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
			updated_at text NOT NULL)`); err != nil {
			t.Fatalf("tạo bảng sai kiểu: %v", err)
		}
		err := runMigration006(t, e.owner)
		if err == nil {
			t.Fatal("006 nhận bảng có cột updated_at kiểu text: phải RAISE EXCEPTION, không được in NOTICE thành công")
		}
		if !strings.Contains(err.Error(), "updated_at") || !strings.Contains(err.Error(), "timestamp with time zone") {
			t.Fatalf("lỗi phải nêu cột updated_at và kiểu mong đợi, nhận: %v", err)
		}
		// Không được sửa kiểu hộ: đổi kiểu text -> timestamptz có thể mất dữ liệu.
		var typ string
		if err := e.owner.pool.QueryRow(ctx, `SELECT data_type FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'room_baton' AND column_name = 'updated_at'`).Scan(&typ); err != nil {
			t.Fatal(err)
		}
		if typ != "text" {
			t.Fatalf("kiểu updated_at bị đổi thành %q, migration không được sửa kiểu cột có sẵn", typ)
		}
	})

	// Ca 3: bảng ĐỦ cột, ĐÚNG kiểu, nhưng khóa ngoại thiếu ON DELETE SET NULL. Chỉ khối 6h bắt
	// được ca này — 6g qua hết vì cột và kiểu đều đúng. Thiếu SET NULL nghĩa là xoá một user sẽ
	// bị Postgres chặn bởi khóa ngoại thay vì nhả Baton, đúng hành vi mà 006 muốn có.
	t.Run("fk_thieu_set_null", func(t *testing.T) {
		if _, err := e.owner.pool.Exec(ctx, `DROP TABLE IF EXISTS public.room_invite_tokens, public.room_baton CASCADE`); err != nil {
			t.Fatalf("dựng cảnh xấu: %v", err)
		}
		if _, err := e.owner.pool.Exec(ctx, `CREATE TABLE public.room_baton (
			project_id uuid PRIMARY KEY REFERENCES public.cloud_projects (id) ON DELETE CASCADE,
			holder_id uuid REFERENCES public.users (id),
			updated_at timestamptz NOT NULL DEFAULT now())`); err != nil {
			t.Fatalf("tạo bảng thiếu SET NULL: %v", err)
		}
		err := runMigration006(t, e.owner)
		if err == nil {
			t.Fatal("006 nhận khóa ngoại room_baton.holder_id thiếu ON DELETE SET NULL: phải RAISE EXCEPTION")
		}
		if !strings.Contains(err.Error(), "holder_id") || !strings.Contains(err.Error(), "SET NULL") {
			t.Fatalf("lỗi phải nêu khóa ngoại holder_id và ON DELETE SET NULL, nhận: %v", err)
		}
	})
}

// AC1 (+ ca biên): cross-tenant trên hai bảng mới, chạy bằng role `sqllens_app` (non-superuser).
//
// Mọi câu SELECT ở đây đều lọc `project_id` chứ KHÔNG lọc owner, nên chúng thật sự phụ thuộc
// RLS — cuối hàm có phép phản chứng tắt RLS để chứng minh điều đó.
func TestLiveRoom006Migration(t *testing.T) {
	e := newRLSEnv(t)
	ctx := context.Background()

	// 1. Owner tạo token cho dự án của mình: phải chạy được (không chặn nhầm người được phép).
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash(roomTokenAn), rlsProjectAn); n != 1 {
		t.Fatalf("An tạo token cho dự án của mình: %d hàng, mong đợi 1", n)
	}
	// 2. An không chèn được token vào dự án của Bình — WITH CHECK của policy chặn.
	if _, err := e.execErr(rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'editor', now() + interval '1 hour')`, roomHash(roomTokenBinh), rlsProjectBinh); err == nil || !strings.Contains(err.Error(), "row-level security") {
		t.Fatalf("An chèn token vào dự án của Bình: err=%v, mong đợi vi phạm row-level security", err)
	}
	// 3. An không đọc, sửa, xoá được token của Bình.
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens WHERE project_id = $1`, rlsProjectBinh); n != 0 {
		t.Fatalf("An đọc được %d token của Bình", n)
	}
	// Bảng không có policy UPDATE (vé dùng nhiều lần được, xem L4): UPDATE khớp 0 hàng vì RLS,
	// và cột `used_at` không còn tồn tại nên câu cũ `SET used_at` giờ là lỗi cú pháp.
	if n := e.exec(t, rlsUserAn, `UPDATE room_invite_tokens SET role = 'viewer' WHERE project_id = $1`, rlsProjectAn); n != 0 {
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
	if n := e.exec(t, rlsUserBinh, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'editor', now() + interval '1 hour')`, roomHash(roomTokenBinh), rlsProjectBinh); n != 1 {
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
	if _, err := e.execErr(rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'owner', now() + interval '1 hour')`, roomHash("inv-bad-role-000000000000000000000000000000000000"), rlsProjectAn); err == nil || !strings.Contains(err.Error(), "check") {
		t.Fatalf("role 'owner' trong token: err=%v, mong đợi vi phạm CHECK", err)
	}

	// 9. AC4: độ dài khoá phải đúng 32 byte. Vé 31 byte và 33 byte bị CHECK từ chối; vé 32 byte
	//    và NULL cũng bị (NULL vào PRIMARY KEY là NOT NULL).
	for _, c := range []struct {
		name string
		hash []byte
	}{
		{"31 byte", make([]byte, 31)},
		{"33 byte", make([]byte, 33)},
		{"NULL", nil},
	} {
		if _, err := e.execErr(rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
			VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, c.hash, rlsProjectAn); err == nil {
			t.Fatalf("token_hash %s: chèn được, mong đợi bị từ chối", c.name)
		}
	}
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, make([]byte, 32), rlsProjectAn); n != 1 {
		t.Fatalf("token_hash 32 byte: %d hàng, mong đợi 1", n)
	}

	// 10. Ca biên: DB KHÔNG kiểm hạn token — token hết hạn vẫn đọc được. Task161 phải tự kiểm
	//     `expires_at > now()`; RLS không làm hộ.
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() - interval '1 hour')`, roomHash(roomTokenAnOld), rlsProjectAn); n != 1 {
		t.Fatalf("chèn token hết hạn: %d hàng, mong đợi 1", n)
	}
	if n := e.query(t, rlsUserAn, `SELECT count(*) FROM room_invite_tokens
		WHERE token_hash = $1 AND expires_at < now()`, roomHash(roomTokenAnOld)); n != 1 {
		t.Fatalf("token hết hạn vẫn đọc được: %d hàng, mong đợi 1 (DB không kiểm hạn)", n)
	}

	// 11. ON DELETE CASCADE: xoá dự án thì token và Baton của nó biến mất.
	if _, err := e.owner.pool.Exec(ctx, `INSERT INTO cloud_projects (id, owner_id, name, engine)
		VALUES ($1, $2, 'Dự án tạm', 'postgres')`, roomTempProject, rlsUserAn); err != nil {
		t.Fatalf("tạo dự án tạm: %v", err)
	}
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash("inv-temp-000000000000000000000000000000000000"), roomTempProject); n != 1 {
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

	// 12. ON DELETE SET NULL: xoá user đang giữ Baton thì hàng Baton còn, holder_id về NULL.
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

	// 13. Phép phản chứng: tắt RLS thì cùng câu SELECT thấy token của người khác. Không có
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
	if n := e.exec(t, rlsUserAn, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash(roomTokenAn), rlsProjectAn); n != 1 {
		t.Fatal("không tạo được token của An")
	}
	if n := e.exec(t, rlsUserBinh, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
		VALUES ($1, $2, 'viewer', now() + interval '1 hour')`, roomHash(roomTokenBinh), rlsProjectBinh); n != 1 {
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
