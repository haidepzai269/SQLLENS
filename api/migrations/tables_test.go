package migrations_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/haidepzai269/SQLLENS/api/migrations"
)

// Canh L1 của Task171.
//
// Lỗi gốc: sáu helper dọn database trong test mỗi nơi chép tay một danh sách `DROP TABLE`, và
// danh sách thiếu `room_invite_tokens`/`room_baton`. `DROP ... CASCADE` chỉ xoá khoá ngoại của
// bảng ĐƯỢC NÊU TÊN, bảng con không tên sống sót, rồi `CREATE TABLE IF NOT EXISTS` ở lần
// Migrate sau bỏ qua nó — bảng vĩnh viễn mất khoá ngoại mà không có lỗi nào, test vẫn xanh.
//
// Cách chữa ở đây là bỏ hẳn khả năng lệch: danh sách chỉ còn MỘT chỗ
// (migrations.DropAllTablesSQL / DropCloudTablesSQL), sáu helper gọi cùng hằng số đó. Hai test
// dưới canh đúng hai cách phá bất biến ấy — thêm bảng vào migration mà quên thêm vào danh sách,
// và chép tay lại danh sách trong một helper.
//
// Vì sao không phải "một test gọi lần lượt sáu helper rồi đếm khoá ngoại": sáu helper nằm ở ba
// package khác nhau (store, httpapi, auth) và đều không export, nên không một test nào gọi được
// cả sáu. Sau khi gộp, chuỗi SQL của cả sáu là CÙNG một hằng số, nên kiểm hằng số một lần là
// kiểm cả sáu; cộng với test cấm chép tay thì không helper nào có thể lệch được nữa.

// createTableRe bắt `CREATE TABLE [IF NOT EXISTS] [public.]<tên>`.
var createTableRe = regexp.MustCompile(`(?i)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)`)

// dropTableRe bắt một câu `DROP TABLE ...` trong mã nguồn Go, cho tới `CASCADE`, `;`, hoặc dấu
// backtick đóng chuỗi raw. Viết bằng string thường vì mẫu phải chứa chính ký tự backtick.
var dropTableRe = regexp.MustCompile("(?is)DROP\\s+TABLE\\b[^;`]*?(?:CASCADE|;|`)")

// stripSQLComments bỏ comment `--` để regex không bắt chữ trong phần giải thích. Không cần xử
// lý `/* */`: các migration trong dự án chỉ dùng comment dòng.
func stripSQLComments(s string) string {
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

// TestDropAllTablesCoversEveryMigrationTable: mọi bảng do các file .sql tạo ra phải có tên trong
// DropAllTablesSQL. Thiếu một tên là đúng lỗi L1.
func TestDropAllTablesCoversEveryMigrationTable(t *testing.T) {
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		t.Fatalf("đọc thư mục migrations: %v", err)
	}
	var created []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		body, err := migrations.FS.ReadFile(e.Name())
		if err != nil {
			t.Fatalf("đọc %s: %v", e.Name(), err)
		}
		for _, m := range createTableRe.FindAllStringSubmatch(stripSQLComments(string(body)), -1) {
			created = append(created, m[1])
		}
	}
	if len(created) < 10 {
		t.Fatalf("chỉ thấy %d bảng trong các file .sql (%v), mong đợi ít nhất 10 — regex hỏng?", len(created), created)
	}

	var missing []string
	for _, tbl := range created {
		// So từ nguyên vẹn: `room_baton` không được coi là có mặt chỉ vì danh sách có
		// `room_baton_holder_id_idx`.
		if !regexp.MustCompile(`(^|[^a-z0-9_])` + regexp.QuoteMeta(tbl) + `([^a-z0-9_]|$)`).MatchString(migrations.DropAllTablesSQL) {
			missing = append(missing, tbl)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("DropAllTablesSQL thiếu bảng do migration tạo: %v. Thiếu tên ở đây nghĩa là bảng con sống sót qua CASCADE và mất khoá ngoại vĩnh viễn (lỗi L1 của Task171).", missing)
	}

	// schema_migrations do store.Migrate tạo bằng Go, không nằm trong file .sql, nhưng vẫn phải
	// có tên: thiếu nó thì lần Migrate sau tưởng database trắng và chạy lại từ 001.
	if !regexp.MustCompile(`(^|[^a-z0-9_])schema_migrations([^a-z0-9_]|$)`).MatchString(migrations.DropAllTablesSQL) {
		t.Fatal("DropAllTablesSQL thiếu schema_migrations")
	}

	// Con phải đứng trước cha, để thứ tự đọc được bằng mắt và không phụ thuộc CASCADE.
	cha := strings.Index(migrations.DropAllTablesSQL, "cloud_projects")
	for _, con := range []string{"room_invite_tokens", "room_baton", "cloud_tabs", "cloud_project_members"} {
		if i := strings.Index(migrations.DropAllTablesSQL, con); i < 0 || i > cha {
			t.Fatalf("%s phải đứng trước cloud_projects trong DropAllTablesSQL", con)
		}
	}
}

// TestNoHandCopiedDropList: không file test nào được chép tay một danh sách nhiều bảng. Chép tay
// là đúng cơ chế sinh ra L1 — sáu bản sao thì sáu cơ hội quên. Test đỏ ngay khi ai đó thay
// `migrations.DropAllTablesSQL` bằng danh sách viết cứng, kể cả khi danh sách đó đang đúng.
//
// Hai loại câu được phép, và đây là cách phân biệt: câu dựng cảnh xấu trong test ca biên luôn
// ghi tên đầy đủ `public.<bảng>` cho từng bảng, còn danh sách dọn database thì không (nó chạy
// trên `search_path` mặc định). Vì vậy chỉ câu nhiều bảng KHÔNG có `public.` mới bị coi là chép
// tay. Câu một bảng cũng được phép — test ca biên cần xoá đúng một bảng để dựng cảnh xấu.
func TestNoHandCopiedDropList(t *testing.T) {
	root := filepath.Join("..", "internal")
	var bad []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, "_test.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range dropTableRe.FindAllString(string(body), -1) {
			if strings.Contains(m, ",") && !strings.Contains(m, "migrations.Drop") && !strings.Contains(m, "public.") {
				bad = append(bad, path+": "+strings.Join(strings.Fields(m), " "))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("duyệt %s: %v", root, err)
	}
	if len(bad) > 0 {
		t.Fatalf("có danh sách DROP chép tay, phải dùng migrations.DropAllTablesSQL hoặc DropCloudTablesSQL:\n%s", strings.Join(bad, "\n"))
	}
}
