package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

// Phòng cộng tác (SP024 / STR116 / Task161).
//
// Sáu mục hợp đồng, bảy handler (arena-step có hai method). Tất cả nằm trong nhóm route sẵn có
// `/api/v1/cloud/projects` nên `main.go` không phải sửa: `MountCloud` đã gắn `RequireUser` và
// `Guards` (hạn mức `quota.CloudSync`) cho cả nhóm, tức route mới thừa hưởng nguyên.
//
// Không câu SQL nào của người dùng đi qua đây và không log nào ghi token, body hay tên dự án:
// handler chỉ ghi `%T` của lỗi, `requestLog` chỉ in method + route pattern + status. Core Rule 7.
//
// `messageKey` chỉ dùng khoá đã có trong `web/messages/*/error.json`. Lý do cụ thể nằm ở trường
// `code`, để Task162 dịch được mà không phải thêm chuỗi i18n từ phía backend.

const (
	codeRoomInvalidToken = "invalid_token"
	codeRoomTokenExpired = "token_expired"
	codeRoomForbidden    = "forbidden"
	codeRoomInvalidStep  = "invalid_step"
	codeRoomOwnerLeave   = "owner_cannot_leave"
)

// mountRoomRoutes đăng ký sáu mục của Task161 vào nhóm route cloud.
//
// `POST /join` không có `:id` nên đứng cạnh `/:id` trong cùng nhóm. Gin phân biệt đoạn tĩnh với
// tham số nên không xung đột; AC5 có test gọi `r.Routes()` để chứng minh cả sáu đường đều đăng ký
// được và không panic lúc mount.
func mountRoomRoutes(g *gin.RouterGroup, h *cloudHandler) {
	g.POST("/:id/invite", h.invite)
	g.POST("/join", h.join)
	g.DELETE("/:id/members/:uid", h.removeMember)
	g.GET("/:id/baton", h.baton)
	g.POST("/:id/baton/claim", h.claimBaton)
	g.POST("/:id/arena-step", h.setArenaStep)
	g.GET("/:id/arena-step", h.getArenaStep)
}

// failRoom dịch lỗi tầng store sang mã lỗi HTTP.
//
// Hai cặp dễ nhầm, cố ý tách:
//   - Vé sai/không tồn tại trả 404 `not_found`, còn vé hết hạn trả 410 `token_expired`. Người cầm
//     link cũ cần biết "xin link mới", không phải "link gõ sai".
//   - Không phải chủ dự án trả 403 `forbidden`, nhưng chỉ khi người gọi ĐỌC ĐƯỢC dự án. Người
//     ngoài nhận 404 từ tầng store, nên 403 không bao giờ là kênh dò sự tồn tại của dự án.
//
// Nhánh mặc định không ghi err: thông điệp lỗi của pgx có thể chứa giá trị cột.
func (h *cloudHandler) failRoom(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrInviteInvalid):
		Abort(c, http.StatusNotFound, codeCloudNotFound, "error.notFound")
	case errors.Is(err, store.ErrInviteExpired):
		Abort(c, http.StatusGone, codeRoomTokenExpired, "error.notFound")
	case errors.Is(err, store.ErrNotOwner):
		// `error.forbidden` chưa có trong `web/messages/*/error.json` (đây là chỗ duy nhất dùng
		// tới nó, giống `auth/middleware.go`). Client đã có luật "khoá lạ quy về internal" nên
		// không vỡ; Task162 thêm chuỗi thì route này tự hiện đúng câu.
		Abort(c, http.StatusForbidden, codeRoomForbidden, "error.forbidden")
	case errors.Is(err, store.ErrOwnerCannotLeave):
		Abort(c, http.StatusBadRequest, codeRoomOwnerLeave, "error.badRequest")
	case errors.Is(err, store.ErrInvalidStep):
		Abort(c, http.StatusBadRequest, codeRoomInvalidStep, "error.badRequest")
	case errors.Is(err, store.ErrNotFound):
		Abort(c, http.StatusNotFound, codeCloudNotFound, "error.notFound")
	default:
		log.Printf("room: request failed (%T)", err)
		Abort(c, http.StatusInternalServerError, "internal", "error.internal")
	}
}

// batonJSON dựng response Baton. `holderId` và `updatedAt` để nguyên null khi phòng chưa ai giữ,
// thay vì bịa UUID rỗng hay mốc thời gian zero: client phân biệt "chưa ai giữ" bằng null.
func batonJSON(b store.Baton) gin.H {
	return gin.H{"holderId": b.HolderID, "step": b.Step, "updatedAt": b.UpdatedAt}
}

// invite tạo vé mời 24 giờ. Chỉ chủ dự án.
func (h *cloudHandler) invite(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	inv, err := h.s.CreateInvite(c.Request.Context(), owner, id)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	// Vé mời là bí mật dùng một lần mang quyền ghi vào phòng: cấm mọi tầng cache giữ lại.
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"token": inv.Token, "role": inv.Role, "expiresAt": inv.ExpiresAt})
}

// roomJoinBody là body của `POST /join`. Không có trường nào khác: dự án suy ra từ vé, người
// dùng lấy từ session, vai trò lấy từ vé.
type roomJoinBody struct {
	Token string `json:"token"`
}

// join đổi vé mời thành tư cách thành viên.
//
// Đây là route DUY NHẤT của Task161 mà người gọi chưa là thành viên dự án. Quyền đọc hàng vé đến
// từ policy chỉ-đọc của `007_room_api.sql`, mở bằng GUC `app.invite_hash` mà `store.JoinRoom` đặt
// trong đúng transaction của nó, nên ngữ cảnh vé không sống sang request
// sau. Xem `WithInvite` trong `internal/store/tenant.go`.
func (h *cloudHandler) join(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	user, ok := h.owner(c)
	if !ok {
		return
	}
	var body roomJoinBody
	if err := c.ShouldBindJSON(&body); err != nil {
		Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
		return
	}
	if strings.TrimSpace(body.Token) == "" {
		Abort(c, http.StatusBadRequest, codeRoomInvalidToken, "error.badRequest")
		return
	}
	res, err := h.s.JoinRoom(c.Request.Context(), user, body.Token)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"projectId":     res.ProjectID,
		"role":          res.Role,
		"alreadyMember": res.AlreadyMember,
	})
}

// removeMember thu hồi tư cách thành viên. Chỉ chủ dự án.
func (h *cloudHandler) removeMember(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	// Tham số `:uid` cũng phải là UUID, nếu không thì câu DELETE so sánh uuid với chuỗi rác và
	// Postgres trả lỗi cú pháp, biến một request sai thành 500.
	memberID := c.Param("uid")
	if !cloudIDRe.MatchString(memberID) {
		Abort(c, http.StatusBadRequest, codeCloudInvalidID, "error.badRequest")
		return
	}
	if err := h.s.RemoveMember(c.Request.Context(), owner, id, memberID); err != nil {
		h.failRoom(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// baton đọc trạng thái Baton. Chủ dự án và thành viên đều đọc được.
func (h *cloudHandler) baton(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	user, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	b, err := h.s.GetBaton(c.Request.Context(), user, id)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, batonJSON(b))
}

// claimBaton đưa Baton về chủ dự án. Chỉ chủ dự án.
//
// Đây là đường phục hồi sau khi người giữ Baton cũ mất kết nối hoặc sau khi Gin khởi động lại
// (trạng thái Baton nằm trong database nên sống qua restart, nhưng phòng có thể bị bỏ dở).
func (h *cloudHandler) claimBaton(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	b, err := h.s.ClaimBaton(c.Request.Context(), owner, id)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, batonJSON(b))
}

// arenaStepBody là body của `POST /arena-step`. Con trỏ để phân biệt "thiếu trường" với "bước 0".
type arenaStepBody struct {
	Step *int `json:"step"`
}

// setArenaStep ghi bước Arena hiện tại. Chỉ chủ dự án.
func (h *cloudHandler) setArenaStep(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	var body arenaStepBody
	if err := c.ShouldBindJSON(&body); err != nil || body.Step == nil {
		Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
		return
	}
	step, err := h.s.SetArenaStep(c.Request.Context(), owner, id, *body.Step)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"step": step})
}

// getArenaStep đọc bước Arena. Chủ dự án và thành viên đều đọc được.
//
// Dùng chung một hàm store với `GET /baton` (cùng một hàng `room_baton`): bước Arena và người giữ
// Baton nằm cạnh nhau trong một dòng, nên hai endpoint chỉ là hai cách nhìn cùng một trạng thái.
func (h *cloudHandler) getArenaStep(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	user, ok := h.owner(c)
	if !ok {
		return
	}
	id, ok := h.cloudID(c)
	if !ok {
		return
	}
	b, err := h.s.GetBaton(c.Request.Context(), user, id)
	if err != nil {
		h.failRoom(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"step": b.Step})
}
