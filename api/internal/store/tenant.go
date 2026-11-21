package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Ngữ cảnh tenant cho RLS (SP023 / Task151).
//
// Đây là ĐƯỜNG DUY NHẤT được đặt `app.current_user_id` / `app.owned_projects`. `set_config`
// với tham số thứ ba `true` nghĩa là chỉ sống trong transaction: commit hoặc rollback là
// Postgres tự xóa, nên connection trả về pool không mang danh tính của request trước.
// Đây là lý do hai request liên tiếp trên cùng connection không thấy dữ liệu của nhau.
//
// Không dùng `SET ROLE` ở runtime: role app là chủ thể bị RLS chặn, đổi role sẽ đổi luôn
// chủ thể và vô hiệu hóa chính lớp bảo vệ này.

var (
	ErrTenantNoUser  = errors.New("store: WithTenant cần user id, không nhận chuỗi rỗng")
	ErrTenantBadUser = errors.New("store: WithTenant nhận user id không phải UUID")
)

var tenantUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// WithTenant mở transaction, đặt ngữ cảnh tenant, chạy fn, rồi commit; fn lỗi thì rollback.
//
// `app.owned_projects` được đọc từ chính database trong cùng transaction (authorization chỉ
// đến từ dữ liệu, không từ client). Lý do cần nó: policy `cloud_projects` phải đọc
// `cloud_project_members` để thành viên thấy dự án được chia sẻ; nếu policy của
// `cloud_project_members` lại đọc `cloud_projects` thì Postgres báo đệ quy policy. Danh sách
// này chỉ dùng ở policy của bảng members nên không tạo vòng.
func (s *Store) WithTenant(ctx context.Context, userID string, fn func(tx pgx.Tx) error) error {
	if strings.TrimSpace(userID) == "" {
		return ErrTenantNoUser // từ chối trước khi mở transaction
	}
	if !tenantUUIDRe.MatchString(userID) {
		return ErrTenantBadUser
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("store: tenant begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := tx.Exec(ctx, `SELECT set_config('app.current_user_id', $1, true)`, userID); err != nil {
		return fmt.Errorf("store: tenant set user: %w", err)
	}
	// Lúc này policy cloud_projects mới thấy các dòng của user hiện tại (thành viên chưa có
	// ngữ cảnh nên chưa thấy gì), nên kết quả đúng là "dự án do user sở hữu".
	if _, err := tx.Exec(ctx, `SELECT set_config('app.owned_projects', COALESCE((
			SELECT string_agg(id::text, ',') FROM cloud_projects WHERE owner_id = $1), ''), true)`, userID); err != nil {
		return fmt.Errorf("store: tenant set owned projects: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: tenant commit: %w", err)
	}
	return nil
}
