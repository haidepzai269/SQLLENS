package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	ErrTenantNoUser    = errors.New("store: WithTenant cần user id, không nhận chuỗi rỗng")
	ErrTenantBadUser   = errors.New("store: WithTenant nhận user id không phải UUID")
	ErrTenantBadInvite = errors.New("store: WithInvite cần đúng 32 byte sha256 của vé mời")
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
	return s.withTenant(ctx, userID, nil, fn)
}

// WithInvite như WithTenant nhưng đặt thêm `app.invite_hash` — băm SHA-256 của vé mời, dạng hex.
//
// Cần hàm riêng vì migration 006 chỉ cho chủ dự án đọc bảng `room_invite_tokens`; người chưa là
// thành viên phải đọc được đúng hàng vé của mình thì `POST /join` mới có đường chạy. Migration 007
// thêm hai policy CHỈ ĐỌC khoá theo GUC này: (a) hàng token có `token_hash = decode(app.invite_hash,
// 'hex')`; (b) dự án có vé khớp. Không policy ghi nào dựa vào GUC này, nên nó chỉ mở đúng hai câu
// đọc và không cấp quyền sửa gì.
//
// Vẫn dùng `set_config(..., true)`: giá trị chết cùng transaction. Đây là điểm quan trọng nhất của
// hàm — để `false` là vé mời còn dính trên connection trả về pool, và request sau của người khác
// đọc được hàng token đó.
func (s *Store) WithInvite(ctx context.Context, userID string, inviteHash []byte, fn func(tx pgx.Tx) error) error {
	if len(inviteHash) != sha256.Size {
		return ErrTenantBadInvite // từ chối trước khi mở transaction
	}
	return s.withTenant(ctx, userID, inviteHash, fn)
}

// withTenant là thân chung của WithTenant và WithInvite. inviteHash nil nghĩa là không đặt ngữ
// cảnh vé mời.
func (s *Store) withTenant(ctx context.Context, userID string, inviteHash []byte, fn func(tx pgx.Tx) error) error {
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
	// Vé mời đi vào GUC dưới dạng hex của băm, không phải token gốc: policy 007 giải mã rồi so
	// với `room_invite_tokens.token_hash`. Token gốc không bao giờ chạm database.
	if inviteHash != nil {
		if _, err := tx.Exec(ctx, `SELECT set_config('app.invite_hash', $1, true)`, hex.EncodeToString(inviteHash)); err != nil {
			return fmt.Errorf("store: tenant set invite hash: %w", err)
		}
	}
	if inviteHash == nil {
		// Lúc này policy cloud_projects mới thấy các dòng của user hiện tại (thành viên chưa có
		// ngữ cảnh nên chưa thấy gì), nên kết quả đúng là "dự án do user sở hữu".
		if _, err := tx.Exec(ctx, `SELECT set_config('app.owned_projects', COALESCE((
				SELECT string_agg(id::text, ',') FROM cloud_projects WHERE owner_id = $1), ''), true)`, userID); err != nil {
			return fmt.Errorf("store: tenant set owned projects: %w", err)
		}
	} else {
		// Nhánh join: `app.owned_projects` phải chứa thêm dự án mà vé mời trỏ tới, vì policy
		// INSERT của `cloud_project_members` (004_cloud_rls.sql:94-99) chỉ cho ghi hàng thành
		// viên khi `project_id = ANY(app.owned_projects)`. Đây là ý đã được duyệt ở sai lệch 2
		// của task161.md: "biết owner mà ghi thành viên bằng ngữ cảnh owner".
		//
		// Rủi ro và vì sao chấp nhận: trong đúng transaction này, ngữ cảnh chủ dự án của vé mở
		// luôn các policy owner-only khác của dự án đó (token, baton, tab). Transaction chỉ chạy
		// các câu cố định trong `store.JoinRoom`, không chạy SQL từ client, và giá trị GUC chết
		// cùng transaction (`set_config(..., true)`) nên request sau không thấy gì. Cách khác là
		// thêm một policy INSERT riêng cho `cloud_project_members` khoá theo `app.invite_hash`,
		// nhưng như vậy là thêm policy ghi vào 007 — trái sai lệch 2 đã duyệt.
		//
		// Câu đọc `room_invite_tokens` dưới đây chạy được vì policy chỉ-đọc của 007 vừa được mở
		// bằng `app.invite_hash` ở trên; vé sai hoặc đã hết hạn trả danh sách rỗng nên
		// `app.owned_projects` giữ nguyên phần dự án user sở hữu.
		if _, err := tx.Exec(ctx, `SELECT set_config('app.owned_projects', COALESCE((
				SELECT string_agg(id::text, ',') FROM cloud_projects
				 WHERE owner_id = $1
				    OR id IN (SELECT t.project_id FROM public.room_invite_tokens t
				               WHERE t.token_hash = decode(current_setting('app.invite_hash', true), 'hex'))), ''), true)`, userID); err != nil {
			return fmt.Errorf("store: tenant set owned projects: %w", err)
		}
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("store: tenant commit: %w", err)
	}
	return nil
}
