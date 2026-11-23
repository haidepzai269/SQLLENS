package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Dự án cloud của Task150 (SP023 / STR102). Không có `is_public`: share đã đi đường URL ở SP022.
//
// Toàn bộ thao tác của file này đi qua `cloudTx`, và Task151 đổi ruột hàm đó sang `WithTenant`
// để policy RLS luôn có `app.current_user_id` trước khi câu SQL chạm bảng. Không câu truy vấn
// nào ở đây tự mở transaction riêng, để không có đường đi vòng qua helper.
const (
	MaxCloudProjects = 50
	MaxCloudTabs     = 100
	MaxCloudTabBytes = 512 * 1024
	// MaxCloudProjectBytes là trần TỔNG của một dự án. Vì sao cần trần tổng: quota 100 tab ×
	// 512KB cho phép một dự án 50MB, vượt xa mọi trần body hợp lý, nên "100 tab" chỉ là con số
	// không bao giờ chạm tới. Trần tổng đặt giới hạn thật cho dung lượng một lần đồng bộ.
	MaxCloudProjectBytes = 2 * 1024 * 1024
)

var (
	ErrCloudTooManyProjects = errors.New("store: vượt giới hạn 50 dự án cloud")
	ErrCloudTooManyTabs     = errors.New("store: vượt giới hạn 100 tab mỗi dự án")
	ErrCloudTabTooLarge     = errors.New("store: một tab vượt giới hạn 512KB")
	ErrCloudProjectTooLarge = errors.New("store: tổng dung lượng tab của dự án vượt giới hạn 2MB")
	ErrCloudInvalidEngine   = errors.New("store: engine cloud không hợp lệ")
	ErrCloudInvalidName     = errors.New("store: tên dự án cloud không được rỗng")
)

// CloudConflictError: dự án đã bị sửa SAU mốc `baseUpdatedAt` client gửi, nên lần ghi bị từ chối
// thay vì ghi đè im lặng. Mang mốc hiện tại của server để client hiển thị hai bên.
type CloudConflictError struct{ RemoteUpdatedAt time.Time }

func (e *CloudConflictError) Error() string { return "store: cloud conflict" }

var cloudEngines = map[string]bool{"postgres": true, "mysql": true, "sqlite": true}

// CloudTab là một tab SQL được lưu kèm dự án. Không mang id: mỗi lần cập nhật là thay cả bộ tab,
// nên id tab phía cloud không có ý nghĩa với client (client đã có id tab cục bộ của mình).
type CloudTab struct {
	Name string
	SQL  string
}

type CloudProject struct {
	ID        string
	Name      string
	Engine    string
	TabCount  int
	CreatedAt time.Time
	UpdatedAt time.Time
	Tabs      []CloudTab // rỗng ở danh sách; đầy đủ và đúng thứ tự ở chi tiết
}

// ValidateCloudInput kiểm tra dữ liệu trước khi chạm database, để lỗi quota không bao giờ để lại
// một phần dự án đã ghi.
//
// Trần tổng tính cả `Name` chứ không chỉ `SQL`: tên tab cũng đi vào body và vào database, nên bỏ
// nó ra thì body thật vẫn vượt trần trong khi hàm nói "vừa".
func ValidateCloudInput(name, engine string, tabs []CloudTab) error {
	if strings.TrimSpace(name) == "" {
		return ErrCloudInvalidName
	}
	if !cloudEngines[engine] {
		return ErrCloudInvalidEngine
	}
	if len(tabs) > MaxCloudTabs {
		return ErrCloudTooManyTabs
	}
	total := 0
	for _, t := range tabs {
		if len(t.SQL) > MaxCloudTabBytes {
			return ErrCloudTabTooLarge
		}
		total += len(t.SQL) + len(t.Name)
	}
	if total > MaxCloudProjectBytes {
		return ErrCloudProjectTooLarge
	}
	return nil
}

// cloudTx là đường duy nhất mọi thao tác cloud đi qua. Task151 nối nó vào WithTenant để
// `app.current_user_id` có mặt trước câu SQL đầu tiên; nếu tự mở transaction riêng, FORCE RLS
// sẽ trả 0 dòng và mọi thao tác lặng lẽ thành "không tìm thấy".
func (s *Store) cloudTx(ctx context.Context, ownerID string, fn func(pgx.Tx) error) error {
	return s.WithTenant(ctx, ownerID, fn)
}

// lockOwnerProjects chặn hai lời gọi đồng thời cùng vượt quota: đếm và ghi nằm trong một
// transaction, nhưng hai transaction song song vẫn có thể cùng đọc thấy 49 dự án.
func lockOwnerProjects(ctx context.Context, tx pgx.Tx, ownerID string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "cloud_projects:"+ownerID); err != nil {
		return fmt.Errorf("store: cloud lock: %w", err)
	}
	return nil
}

// cleanCloudTabs chuẩn hóa đúng MỘT lần: giá trị đã ghi xuống database cũng là giá trị trả về
// cho client, nên response không bao giờ khác dữ liệu thật (ví dụ ký tự NUL bị bỏ).
func cleanCloudTabs(tabs []CloudTab) []CloudTab {
	out := make([]CloudTab, len(tabs))
	for i, t := range tabs {
		out[i] = CloudTab{Name: clean(t.Name), SQL: clean(t.SQL)}
	}
	return out
}

// insertCloudTabs ghi tab bằng MỘT câu INSERT nhiều dòng, KHÔNG dùng COPY FROM.
//
// PostgreSQL từ chối COPY FROM trên bảng có RLS (`COPY FROM not supported with row-level
// security`) với mọi role bị RLS áp dụng; superuser thì lọt nên test chạy bằng superuser không
// thấy gì. Trên Neon API chạy bằng role chủ non-superuser, nên nếu dùng COPY thì mọi lần lưu
// dự án CÓ TAB đều 500 — dự án rỗng vẫn lưu được, rất dễ chẩn đoán nhầm là lỗi frontend.
// INSERT nhiều dòng vẫn đi qua WITH CHECK của policy đúng như mong muốn.
func insertCloudTabs(ctx context.Context, tx pgx.Tx, projectID string, tabs []CloudTab) error {
	if len(tabs) == 0 {
		return nil
	}
	var b strings.Builder
	b.WriteString(`INSERT INTO cloud_tabs (project_id, name, sql, position) VALUES `)
	args := make([]any, 0, len(tabs)*4)
	for i, t := range tabs {
		if i > 0 {
			b.WriteString(", ")
		}
		n := i*4 + 1
		fmt.Fprintf(&b, "($%d, $%d, $%d, $%d)", n, n+1, n+2, n+3)
		args = append(args, projectID, t.Name, t.SQL, i)
	}
	if _, err := tx.Exec(ctx, b.String(), args...); err != nil {
		return fmt.Errorf("store: cloud tabs: %w", err)
	}
	return nil
}

// CreateCloudProject tạo dự án kèm tab trong MỘT transaction: vượt quota thì không ghi gì cả.
func (s *Store) CreateCloudProject(ctx context.Context, ownerID, name, engine string, tabs []CloudTab) (CloudProject, error) {
	if err := ValidateCloudInput(name, engine, tabs); err != nil {
		return CloudProject{}, err
	}
	tabs = cleanCloudTabs(tabs)
	out := CloudProject{Name: clean(name), Engine: engine, TabCount: len(tabs), Tabs: tabs}
	err := s.cloudTx(ctx, ownerID, func(tx pgx.Tx) error {
		if err := lockOwnerProjects(ctx, tx, ownerID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM cloud_projects WHERE owner_id = $1`, ownerID).Scan(&n); err != nil {
			return fmt.Errorf("store: cloud count: %w", err)
		}
		if n >= MaxCloudProjects {
			return ErrCloudTooManyProjects
		}
		if err := tx.QueryRow(ctx, `INSERT INTO cloud_projects (owner_id, name, engine) VALUES ($1, $2, $3)
			RETURNING id::text, created_at, updated_at`,
			ownerID, out.Name, engine).Scan(&out.ID, &out.CreatedAt, &out.UpdatedAt); err != nil {
			return fmt.Errorf("store: cloud create: %w", err)
		}
		return insertCloudTabs(ctx, tx, out.ID, tabs)
	})
	if err != nil {
		return CloudProject{}, err
	}
	return out, nil
}

// ListCloudProjects trả dự án của chính ownerID, mới cập nhật trước. Không kèm nội dung tab.
func (s *Store) ListCloudProjects(ctx context.Context, ownerID string) ([]CloudProject, error) {
	out := []CloudProject{}
	err := s.cloudTx(ctx, ownerID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT p.id::text, p.name, p.engine, p.created_at, p.updated_at,
				(SELECT count(*) FROM cloud_tabs t WHERE t.project_id = p.id)
			FROM cloud_projects p
			WHERE p.owner_id = $1
			ORDER BY p.updated_at DESC, p.id`, ownerID)
		if err != nil {
			return fmt.Errorf("store: cloud list: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var p CloudProject
			if err := rows.Scan(&p.ID, &p.Name, &p.Engine, &p.CreatedAt, &p.UpdatedAt, &p.TabCount); err != nil {
				return fmt.Errorf("store: cloud list: %w", err)
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetCloudProject trả dự án kèm tab theo đúng thứ tự position. Dự án của người khác trả ErrNotFound:
// không phân biệt "không có" với "không phải của bạn" để không lộ sự tồn tại.
//
// Người đọc được dự án là chủ dự án HOẶC thành viên (sai lệch 4 của task161.md): AC2 chỉ có nghĩa
// nếu trước khi bị xoá, thành viên đọc được dự án. Bản cũ chỉ lọc `owner_id = $2` nên thành viên
// luôn nhận 404 và AC2 vô nghĩa.
//
// Vì sao vẫn viết điều kiện thành viên ngay trong câu SQL thay vì để RLS quyết hoàn toàn: RLS là
// lớp bảo vệ thứ hai, nhưng nó chỉ có hiệu lực khi connection chạy bằng role bị RLS chặn. Bộ test
// của gói này nối thẳng bằng `postgres` (superuser), nên ở đó RLS không chặn gì; nếu bỏ hẳn điều
// kiện thì người ngoài đọc được dự án của người khác và `TestCloudCrossTenant` đỏ — đúng như đã
// tái hiện. Viết rõ quyền đọc trong câu SQL giữ được đẳng thức "không thấy = không tồn tại" ở mọi
// môi trường, còn RLS vẫn chặn độc lập ở môi trường thật.
//
// `ListCloudProjects` thì VẪN lọc `owner_id`: đó là danh sách dự án của chính mình để chọn, không
// phải danh sách phòng được chia sẻ.
func (s *Store) GetCloudProject(ctx context.Context, ownerID, id string) (CloudProject, error) {
	var out CloudProject
	err := s.cloudTx(ctx, ownerID, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id::text, name, engine, created_at, updated_at
			FROM cloud_projects
			WHERE id = $1
			  AND (owner_id = $2
			       OR EXISTS (SELECT 1 FROM cloud_project_members m
			                   WHERE m.project_id = cloud_projects.id AND m.user_id = $2))`, id, ownerID).
			Scan(&out.ID, &out.Name, &out.Engine, &out.CreatedAt, &out.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("store: cloud get: %w", err)
		}
		rows, err := tx.Query(ctx, `SELECT name, sql FROM cloud_tabs WHERE project_id = $1 ORDER BY position, id`, out.ID)
		if err != nil {
			return fmt.Errorf("store: cloud get tabs: %w", err)
		}
		defer rows.Close()
		out.Tabs = []CloudTab{}
		for rows.Next() {
			var t CloudTab
			if err := rows.Scan(&t.Name, &t.SQL); err != nil {
				return fmt.Errorf("store: cloud get tabs: %w", err)
			}
			out.Tabs = append(out.Tabs, t)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("store: cloud get tabs: %w", err)
		}
		out.TabCount = len(out.Tabs)
		return nil
	})
	if err != nil {
		return CloudProject{}, err
	}
	return out, nil
}

// ReplaceCloudProject thay tên, engine và toàn bộ tab trong MỘT transaction. Tab cũ bị xóa hết
// để thứ tự và tập tab đúng như client gửi; lỗi giữa đường thì cả dự án quay về trạng thái cũ.
//
// `baseUpdatedAt` khác nil là điều kiện ghi có kiểm: chỉ ghi khi dòng còn đúng mốc đó. Lệch mốc
// (máy khác đã sửa) trả *CloudConflictError và KHÔNG ghi gì; không truyền (nil) giữ hành vi cũ.
func (s *Store) ReplaceCloudProject(ctx context.Context, ownerID, id, name, engine string, tabs []CloudTab, baseUpdatedAt *time.Time) (CloudProject, error) {
	if err := ValidateCloudInput(name, engine, tabs); err != nil {
		return CloudProject{}, err
	}
	tabs = cleanCloudTabs(tabs)
	out := CloudProject{ID: id, Name: clean(name), Engine: engine, TabCount: len(tabs), Tabs: tabs}
	err := s.cloudTx(ctx, ownerID, func(tx pgx.Tx) error {
		if err := lockOwnerProjects(ctx, tx, ownerID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE cloud_projects SET name = $3, engine = $4, updated_at = now()
			WHERE id = $1 AND owner_id = $2
			  AND ($5::timestamptz IS NULL OR updated_at = $5::timestamptz)`, id, ownerID, out.Name, engine, baseUpdatedAt)
		if err != nil {
			return fmt.Errorf("store: cloud update: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// Không sửa được hàng nào: hoặc không có dự án, hoặc mốc đã lệch. Đọc lại mốc để
			// phân biệt, nhờ vậy client nhận 409 (có việc để hỏi người dùng) thay vì 404.
			var remote time.Time
			err := tx.QueryRow(ctx, `SELECT updated_at FROM cloud_projects WHERE id = $1 AND owner_id = $2`, id, ownerID).Scan(&remote)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return fmt.Errorf("store: cloud conflict probe: %w", err)
			}
			return &CloudConflictError{RemoteUpdatedAt: remote}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cloud_tabs WHERE project_id = $1`, id); err != nil {
			return fmt.Errorf("store: cloud clear tabs: %w", err)
		}
		if err := insertCloudTabs(ctx, tx, id, tabs); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT created_at, updated_at FROM cloud_projects WHERE id = $1`, id).
			Scan(&out.CreatedAt, &out.UpdatedAt); err != nil {
			return fmt.Errorf("store: cloud update reread: %w", err)
		}
		return nil
	})
	if err != nil {
		return CloudProject{}, err
	}
	return out, nil
}

// DeleteCloudProject xóa dự án; tab và thành viên đi theo nhờ khóa ngoại ON DELETE CASCADE.
// Xóa lần hai trả ErrNotFound.
func (s *Store) DeleteCloudProject(ctx context.Context, ownerID, id string) error {
	return s.cloudTx(ctx, ownerID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM cloud_projects WHERE id = $1 AND owner_id = $2`, id, ownerID)
		if err != nil {
			return fmt.Errorf("store: cloud delete: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}
