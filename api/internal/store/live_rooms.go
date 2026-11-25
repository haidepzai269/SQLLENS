package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Tầng store của phòng cộng tác (SP024 / STR116 / Task161).
//
// Phòng KHÔNG phải thực thể mới: một phòng là một `cloud_projects` của SP023, chủ phòng là
// `cloud_projects.owner_id`, thành viên là hàng trong `cloud_project_members`. Nhờ vậy toàn bộ
// RLS, quota và API cloud sẵn có vẫn dùng nguyên, và task này chỉ thêm đúng ba thứ chưa có: vé
// mời, Baton, và bước Arena.
//
// Mọi hàm ở đây đi qua `WithTenant`/`WithInvite`, tức `app.current_user_id` luôn có mặt trước câu
// SQL đầu tiên. Không hàm nào tự mở transaction riêng: `FORCE ROW LEVEL SECURITY` sẽ trả 0 dòng
// và mọi thao tác lặng lẽ thành "không tìm thấy".

// InviteTTL là hạn sống của một vé mời. 24 giờ theo hợp đồng Task161.
const InviteTTL = 24 * time.Hour

var (
	// ErrInviteInvalid: không có hàng vé nào khớp băm. Gồm cả vé bịa và vé của dự án đã bị xoá
	// (khoá ngoại `ON DELETE CASCADE` xoá vé theo).
	ErrInviteInvalid = errors.New("store: vé mời không hợp lệ")
	// ErrInviteExpired tách khỏi ErrInviteInvalid vì hợp đồng AC1 đòi 410 `token_expired`, không
	// phải 404: người dùng cầm link cũ cần biết "xin link mới", không phải "link sai".
	ErrInviteExpired = errors.New("store: vé mời đã hết hạn")
	// ErrNotOwner: người gọi ĐỌC ĐƯỢC dự án nhưng không phải chủ. Chỉ dùng khi đã xác định được
	// dự án tồn tại và người gọi thấy nó, nếu không thì trả ErrNotFound để không lộ sự tồn tại.
	ErrNotOwner = errors.New("store: chỉ chủ dự án được làm việc này")
	// ErrOwnerCannotLeave: chủ dự án không thể tự thu hồi chính mình. Xoá chủ khỏi danh sách
	// thành viên sẽ để lại dự án không ai quản lý; muốn bỏ thì xoá cả dự án.
	ErrOwnerCannotLeave = errors.New("store: chủ dự án không thể tự xoá mình khỏi dự án")
	// ErrInvalidStep: bước Arena là số nguyên không âm. Số âm bị từ chối ở đây chứ không lưu,
	// để client đọc lại không phải đoán dữ liệu rác từ đâu ra.
	ErrInvalidStep = errors.New("store: bước Arena phải là số nguyên không âm")
)

// Invite là kết quả tạo vé mời. Token gốc chỉ tồn tại trong response này và trong RAM: database
// chỉ giữ băm SHA-256 (xem 006_live_rooms.sql:49-57).
type Invite struct {
	Token     string
	Role      string
	ExpiresAt time.Time
}

// JoinResult là kết quả gia nhập phòng. AlreadyMember báo lần join thứ hai không ghi gì, để
// client phân biệt "vừa vào" với "đã ở trong" mà không phải gọi thêm endpoint.
type JoinResult struct {
	ProjectID     string
	Role          string
	AlreadyMember bool
}

// Baton là trạng thái quyền Run của phòng. HolderID và UpdatedAt để con trỏ vì dự án chưa ai
// nhận Baton thì hai giá trị đó là NULL thật, không phải mốc thời gian giả.
//
// Trạng thái này là TẠM THỜI: nó nằm trong PostgreSQL nên sống qua lần khởi động lại Gin, nhưng
// khi phòng bị bỏ thì hàng bị xoá theo dự án (`ON DELETE CASCADE`). Chủ phòng lấy lại quyền Run
// bằng `POST /baton/claim` sau khi mất kết nối.
type Baton struct {
	HolderID  *string
	Step      int
	UpdatedAt *time.Time
}

// inviteRole là vai trò mà vé mời cấp. Cố định `editor`: người được mời phải chạy được câu SQL
// của phòng và xin Baton được (BAN_NHAP_STORY_SP024.md dòng 335), còn `viewer` chỉ đọc. Vé mời
// KHÔNG BAO GIỜ cấp `owner` — cột `role` của 006 chỉ cho `('editor','viewer')`, nên chủ phòng
// không thể vô tình trao quyền quản lý qua một link.
//
// shortcut: vé mời chỉ có một vai trò cố định, nâng cấp khi Task162 cần chọn viewer/editor lúc
// mời — lúc đó thêm trường `role` vào body của POST /invite.
const inviteRole = "editor"

// projectOwner trả `owner_id` của dự án, hoặc ErrNotFound khi người gọi không đọc được dự án.
//
// "Không đọc được" gộp hai trường hợp có chủ ý: dự án không tồn tại và dự án của người khác mà
// mình chưa là thành viên. Policy SELECT của 004 (dòng 37-43) quyết định việc này, nên đây là
// cùng một câu SQL cho cả hai và không có nhánh nào lộ sự tồn tại.
func projectOwner(ctx context.Context, tx pgx.Tx, projectID string) (string, error) {
	var owner string
	err := tx.QueryRow(ctx, `SELECT owner_id::text FROM cloud_projects WHERE id = $1`, projectID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("store: room project owner: %w", err)
	}
	return owner, nil
}

// requireOwner chặn mọi thao tác chỉ chủ phòng được làm. Thứ tự hai bước là quan trọng: kiểm
// "thấy dự án" trước (404) rồi mới kiểm "là chủ" (403), nếu không thì người ngoài phân biệt được
// dự án có tồn tại hay không qua mã lỗi.
func requireOwner(ctx context.Context, tx pgx.Tx, userID, projectID string) error {
	owner, err := projectOwner(ctx, tx, projectID)
	if err != nil {
		return err
	}
	if owner != userID {
		return ErrNotOwner
	}
	return nil
}

// requireReader chặn người ngoài đọc trạng thái phòng: chỉ chủ và thành viên đi tiếp, ai khác nhận
// ErrNotFound (404, không phải 403) để không lộ dự án có tồn tại.
//
// Vì sao phải kiểm bằng SQL thay vì tin RLS: bộ test handler chạy bằng superuser `postgres`, mà
// superuser bỏ qua policy, nên một hàm chỉ dựa vào RLS vẫn trả 200 cho người ngoài — đúng lỗi đã
// tái hiện ở `GET /baton` (xem ghi chú cùng loại trong `cloud.go:GetCloudProject`).
func requireReader(ctx context.Context, tx pgx.Tx, userID, projectID string) error {
	var one int
	err := tx.QueryRow(ctx, `SELECT 1 FROM cloud_projects p
		WHERE p.id = $1
		  AND (p.owner_id = $2
		       OR EXISTS (SELECT 1 FROM cloud_project_members m
		                   WHERE m.project_id = p.id AND m.user_id = $2))`, projectID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: room read check: %w", err)
	}
	return nil
}

// CreateInvite tạo vé mời 24 giờ cho một dự án của chính ownerID.
//
// Token sinh 32 byte ngẫu nhiên mã hoá base64url, đúng khuôn `CreateSession` (store.go:209-223):
// cùng nguồn ngẫu nhiên, cùng độ dài, cùng cách chỉ lưu băm. Vé mời KHÔNG bị đánh dấu "đã dùng"
// sau khi join — link dùng chung được cho cả nhóm tới `expires_at` (sai lệch 5 của task161.md).
func (s *Store) CreateInvite(ctx context.Context, ownerID, projectID string) (Invite, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Invite{}, fmt.Errorf("store: tạo vé mời: %w", err)
	}
	out := Invite{Token: base64.RawURLEncoding.EncodeToString(raw), Role: inviteRole}
	err := s.WithTenant(ctx, ownerID, func(tx pgx.Tx) error {
		if err := requireOwner(ctx, tx, ownerID, projectID); err != nil {
			return err
		}
		// Hạn tính bằng `now()` của database, không bằng đồng hồ Go: giờ máy Render và giờ Neon
		// lệch nhau vài giây là đủ để vé "còn hạn" theo Go nhưng hết hạn theo Postgres.
		return tx.QueryRow(ctx, `INSERT INTO room_invite_tokens (token_hash, project_id, role, expires_at)
			VALUES ($1, $2, $3, now() + $4::interval)
			RETURNING expires_at`,
			hashToken(out.Token), projectID, out.Role,
			fmt.Sprintf("%d microseconds", InviteTTL.Microseconds())).Scan(&out.ExpiresAt)
	})
	if err != nil {
		return Invite{}, err
	}
	return out, nil
}

// JoinRoom thêm userID vào phòng mà vé mời trỏ tới, rồi trả dự án + vai trò.
//
// Đây là lời gọi DUY NHẤT dùng `WithInvite`. Vé đi vào GUC dưới dạng hex của băm SHA-256, và
// policy chỉ-đọc của 007 mới là thứ cho phép đọc hàng vé khi chưa là thành viên. `WithInvite` đặt
// ngữ cảnh vé ở phạm vi transaction nên nó chết cùng transaction: request sau trên cùng connection
// không đọc được hàng vé nào.
func (s *Store) JoinRoom(ctx context.Context, userID, token string) (JoinResult, error) {
	var out JoinResult
	err := s.WithInvite(ctx, userID, hashToken(token), func(tx pgx.Tx) error {
		var expired bool
		err := tx.QueryRow(ctx, `SELECT t.project_id::text, t.role, t.expires_at <= now()
			FROM room_invite_tokens t WHERE t.token_hash = $1`, hashToken(token)).
			Scan(&out.ProjectID, &out.Role, &expired)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInviteInvalid
		}
		if err != nil {
			return fmt.Errorf("store: room join token: %w", err)
		}
		if expired {
			return ErrInviteExpired
		}

		// Join lần hai phải idempotent (ca biên của task161.md): trả vai trò đang có trong
		// `cloud_project_members`, không ghi đè bằng vai trò của vé. Ghi đè sẽ cho phép một vé
		// `editor` nâng một `viewer` lên — đúng thứ người mời không định làm.
		var current string
		err = tx.QueryRow(ctx, `SELECT role FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
			out.ProjectID, userID).Scan(&current)
		switch {
		case err == nil:
			out.Role = current
			out.AlreadyMember = true
			return nil
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return fmt.Errorf("store: room join membership: %w", err)
		}

		// `ON CONFLICT DO NOTHING` cho hai lời gọi join đồng thời của cùng một người: bên thua
		// không nhận lỗi khoá chính, và `RowsAffected` cho biết ai là người thật sự được thêm.
		tag, err := tx.Exec(ctx, `INSERT INTO cloud_project_members (project_id, user_id, role)
			VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING`,
			out.ProjectID, userID, out.Role)
		if err != nil {
			return fmt.Errorf("store: room join insert: %w", err)
		}
		out.AlreadyMember = tag.RowsAffected() == 0
		return nil
	})
	if err != nil {
		return JoinResult{}, err
	}
	return out, nil
}

// RemoveMember thu hồi quyền của một thành viên. Xoá hàng thành viên là đủ: mọi quyền đọc/ghi
// của thành viên đều suy ra từ hàng đó, nên request kế tiếp của họ nhận 404 y như dự án của
// người lạ.
func (s *Store) RemoveMember(ctx context.Context, ownerID, projectID, memberID string) error {
	return s.WithTenant(ctx, ownerID, func(tx pgx.Tx) error {
		if err := requireOwner(ctx, tx, ownerID, projectID); err != nil {
			return err
		}
		if ownerID == memberID {
			return ErrOwnerCannotLeave
		}
		tag, err := tx.Exec(ctx, `DELETE FROM cloud_project_members WHERE project_id = $1 AND user_id = $2`,
			projectID, memberID)
		if err != nil {
			return fmt.Errorf("store: room remove member: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// Không phải thành viên, hoặc user id không tồn tại: cùng một câu trả lời, vì phân
			// biệt hai trường hợp là nói cho người gọi biết user id nào có thật trên hệ thống.
			return ErrNotFound
		}
		return nil
	})
}

// RoomMember là một dòng trong danh sách thành viên phòng (SP024 / STR113 / Task162).
//
// Chủ dự án không có hàng trong `cloud_project_members` — chủ phòng là `cloud_projects.owner_id`
// — nên hàm đọc dựng chủ thành phần tử đầu tiên với vai trò `owner` thay vì bịa một hàng.
// AvatarURL là con trỏ vì cột `users.avatar_url` cho phép NULL thật.
type RoomMember struct {
	UserID    string
	Name      string
	AvatarURL *string
	Role      string
}

// ListMembers trả danh sách thành viên của phòng, chủ dự án đứng đầu.
//
// CHỈ chủ dự án đọc được. Lý do nằm ở policy SELECT của `cloud_project_members` (migration 004):
// mỗi thành viên chỉ thấy hàng của chính mình, chủ thấy mọi hàng của dự án mình. Trả danh sách
// cụt cho thành viên thường là nói dối người dùng (họ sẽ tưởng phòng chỉ có mình), nên hàm chặn
// bằng `requireOwner` — người ngoài nhận ErrNotFound (404), thành viên không phải chủ nhận
// ErrNotOwner (403).
func (s *Store) ListMembers(ctx context.Context, userID, projectID string) ([]RoomMember, error) {
	var out []RoomMember
	err := s.WithTenant(ctx, userID, func(tx pgx.Tx) error {
		// `requireReader` phải chạy TRƯỚC `requireOwner`: bộ test handler chạy bằng superuser, mà
		// superuser bỏ qua RLS, nên nếu chỉ dựa vào policy thì người ngoài nhận 403 (đã biết có dự
		// án) thay vì 404 — đúng lỗi đã tái hiện ở `GET /baton`.
		if err := requireReader(ctx, tx, userID, projectID); err != nil {
			return err
		}
		if err := requireOwner(ctx, tx, userID, projectID); err != nil {
			return err
		}

		owner := RoomMember{Role: "owner"}
		if err := tx.QueryRow(ctx, `SELECT p.owner_id::text, u.display_name, NULLIF(u.avatar_url, '')
			FROM cloud_projects p JOIN users u ON u.id = p.owner_id
			WHERE p.id = $1`, projectID).
			Scan(&owner.UserID, &owner.Name, &owner.AvatarURL); err != nil {
			return fmt.Errorf("store: room list owner: %w", err)
		}

		// Thứ tự tất định: tên rồi user id. Không sắp theo `created_at` vì bảng đó không có cột
		// thời gian, và hai người trùng tên vẫn phải ra cùng một thứ tự ở mọi lần đọc.
		rows, err := tx.Query(ctx, `SELECT m.user_id::text, u.display_name, NULLIF(u.avatar_url, ''), m.role
			FROM cloud_project_members m JOIN users u ON u.id = m.user_id
			WHERE m.project_id = $1
			ORDER BY u.display_name, m.user_id`, projectID)
		if err != nil {
			return fmt.Errorf("store: room list members: %w", err)
		}
		defer rows.Close()

		members := []RoomMember{owner}
		for rows.Next() {
			var m RoomMember
			if err := rows.Scan(&m.UserID, &m.Name, &m.AvatarURL, &m.Role); err != nil {
				return fmt.Errorf("store: room member row: %w", err)
			}
			// Chủ dự án tự mở link mời của mình sẽ có thêm một hàng thành viên (`JoinRoom` chèn cho
			// mọi người nhận vé). Bỏ hàng đó: chủ đã đứng đầu danh sách với vai trò `owner`, còn hàng
			// trùng thì hiện hai lần và không xoá được (`ErrOwnerCannotLeave`).
			if m.UserID == owner.UserID {
				continue
			}
			members = append(members, m)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("store: room list members rows: %w", err)
		}
		out = members
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetBaton đọc trạng thái Baton, đồng thời là nguồn của `GET /arena-step` (dùng `.Step`).
//
// Hàm chỉ đọc, không tạo hàng: phòng chưa ai nhận Baton thì trả `{holderId: null, step: 0,
// updatedAt: null}` — đúng nghĩa "chưa ai giữ", và client phân biệt được bằng null thay vì phải
// đoán từ một mốc thời gian giả. Hàng baton chỉ sinh ra khi chủ phòng gọi `POST /baton/claim`
// hoặc `POST /arena-step`.
//
// `requireReader` gọi trước để tách hai ca có cùng kết quả SELECT: "không phải thành viên" (404) và
// "phòng chưa có baton" (200 với null). Thiếu bước này thì người ngoài nhận 200 rỗng và học được
// rằng dự án có tồn tại.
func (s *Store) GetBaton(ctx context.Context, userID, projectID string) (Baton, error) {
	var out Baton
	err := s.WithTenant(ctx, userID, func(tx pgx.Tx) error {
		if err := requireReader(ctx, tx, userID, projectID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `SELECT holder_id::text, arena_step, updated_at
			FROM room_baton WHERE project_id = $1`, projectID).
			Scan(&out.HolderID, &out.Step, &out.UpdatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			out = Baton{}
			return nil
		}
		if err != nil {
			return fmt.Errorf("store: room baton get: %w", err)
		}
		return nil
	})
	if err != nil {
		return Baton{}, err
	}
	return out, nil
}

// ClaimBaton đưa Baton về chủ phòng (đường phục hồi khi người giữ cũ mất kết nối).
//
// Upsert một câu thay vì SELECT rồi UPDATE: phòng chưa có hàng baton thì INSERT, có rồi thì
// UPDATE, và cả hai đường đều trả về đúng hàng vừa ghi nên response không cần đọc lại.
func (s *Store) ClaimBaton(ctx context.Context, ownerID, projectID string) (Baton, error) {
	var out Baton
	err := s.WithTenant(ctx, ownerID, func(tx pgx.Tx) error {
		if err := requireOwner(ctx, tx, ownerID, projectID); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `INSERT INTO room_baton (project_id, holder_id, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (project_id) DO UPDATE SET holder_id = EXCLUDED.holder_id, updated_at = now()
			RETURNING holder_id::text, arena_step, updated_at`, projectID, ownerID).
			Scan(&out.HolderID, &out.Step, &out.UpdatedAt)
		if err != nil {
			return fmt.Errorf("store: room baton claim: %w", err)
		}
		return nil
	})
	if err != nil {
		return Baton{}, err
	}
	return out, nil
}

// SetArenaStep lưu bước Arena hiện tại và trả lại giá trị đã ghi, để client không phải đoán
// server đã chuẩn hoá thành gì.
//
// Cố ý KHÔNG đụng `updated_at`: bước Arena đổi liên tục trong lúc chạy, còn `updated_at` là mốc
// đổi người giữ Baton. Gộp hai nghĩa vào một cột sẽ làm client tưởng Baton vừa đổi chủ.
func (s *Store) SetArenaStep(ctx context.Context, ownerID, projectID string, step int) (int, error) {
	if step < 0 {
		return 0, ErrInvalidStep
	}
	var out int
	err := s.WithTenant(ctx, ownerID, func(tx pgx.Tx) error {
		if err := requireOwner(ctx, tx, ownerID, projectID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO room_baton (project_id, arena_step) VALUES ($1, $2)
			ON CONFLICT (project_id) DO UPDATE SET arena_step = EXCLUDED.arena_step
			RETURNING arena_step`, projectID, step).Scan(&out)
	})
	if err != nil {
		return 0, err
	}
	return out, nil
}
