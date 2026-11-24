package httpapi

import (
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/haidepzai269/SQLLENS/api/internal/store"
)

// Cloud CRUD cho dự án lưu trên Neon (SP023 / Task150).
//
// Không câu SQL nào của người dùng đi vào log ở bất kỳ mức nào: handler chỉ ghi loại lỗi
// (`%T`), không ghi err, không ghi body, không ghi tab. requestLog của router chỉ in
// method + route pattern + status. Đây là Core Rule 7 và là AC5 của task.
//
// `owner_id` luôn lấy từ session, không bao giờ từ body: struct request không có trường đó nên
// body có gửi kèm cũng bị json bỏ qua.

const (
	codeCloudInvalidBody    = "invalid_body"
	codeCloudInvalidID      = "invalid_id"
	codeCloudInvalidEngine  = "invalid_engine"
	codeCloudTooManyProject = "too_many_projects"
	codeCloudTooManyTabs    = "too_many_tabs"
	codeCloudTabTooLarge    = "tab_too_large"
	codeCloudProjectTooBig  = "project_too_large"
	codeCloudNotFound       = "not_found"
)

// cloudPathPrefix là tiền tố mà router dùng để nâng trần body. Trần mặc định 1MB nhỏ hơn quota
// tab (100 × 512KB) nên nếu để chung, một dự án nhiều tab bị 413 trước khi handler kịp trả lỗi
// quota có nghĩa. Chỉ route dưới tiền tố này được nâng, mọi route khác giữ 1MB.
const cloudPathPrefix = "/api/v1/cloud/"

// cloudBodyOverhead là phần dôi ra cho vỏ JSON (tên trường, dấu ngoặc, escape). Phải dương để
// dự án vượt trần TỔNG nhận 400 project_too_large từ handler thay vì 413 từ tầng vận chuyển:
// nếu trần body bằng đúng trần tổng thì mọi ca vượt quota đều bị chặn sớm hơn, và client không
// phân biệt được "dự án quá lớn" với "request quá lớn". Dấu nháy và xuống dòng trong SQL tốn
// 2 byte JSON mỗi byte, nên để dư 1MB (50%) thay vì sát trần.
const cloudBodyOverhead = 1 << 20

// cloudBodyBytes là trần body riêng của route cloud.
const cloudBodyBytes = store.MaxCloudProjectBytes + cloudBodyOverhead

var cloudIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// CloudConfig nối handler với phần đăng nhập. httpapi không import được package auth
// (auth đã import httpapi), nên middleware và hàm đọc user id được truyền vào từ ngoài.
type CloudConfig struct {
	Store       *store.Store
	RequireUser gin.HandlerFunc
	// Guards chạy ngay sau RequireUser, trước handler: giới hạn tần suất thô và quota
	// (`auth.GateLimit(quota.CloudSync, false)` ở main.go). Để rỗng khi test riêng handler.
	Guards []gin.HandlerFunc
	UID    func(*gin.Context) string
}

// MountCloud đăng ký /api/v1/cloud/projects. Phải gọi sau auth.Mount để hưởng originCheck.
func MountCloud(r *gin.Engine, cfg CloudConfig) {
	h := &cloudHandler{s: cfg.Store, uid: cfg.UID}
	if h.uid == nil {
		h.uid = func(*gin.Context) string { return "" }
	}
	guard := cfg.RequireUser
	if guard == nil {
		// Thiếu middleware đăng nhập thì đóng route, không chạy handler trên danh tính rỗng.
		guard = func(c *gin.Context) {
			Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
		}
	}
	chain := make([]gin.HandlerFunc, 0, 1+len(cfg.Guards))
	chain = append(chain, guard)
	chain = append(chain, cfg.Guards...)
	g := r.Group("/api/v1/cloud/projects", chain...)
	g.POST("", h.create)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.PUT("/:id", h.replace)
	g.DELETE("/:id", h.remove)
	// Sáu mục của Task161 (phòng cộng tác) dùng chung nhóm route, nên thừa hưởng nguyên
	// RequireUser và Guards. Tách hàm riêng chỉ để file này không phình theo.
	mountRoomRoutes(g, h)
}

type cloudHandler struct {
	s   *store.Store
	uid func(*gin.Context) string
}

type cloudTabBody struct {
	Name string `json:"name"`
	SQL  string `json:"sql"`
}

type cloudProjectBody struct {
	Name   string         `json:"name"`
	Engine string         `json:"engine"`
	Tabs   []cloudTabBody `json:"tabs"`
	// BaseUpdatedAt là mốc server của lần đồng bộ trước (Task153). Vắng = ghi không điều kiện.
	BaseUpdatedAt string `json:"baseUpdatedAt"`
}

func (b cloudProjectBody) toStore() []store.CloudTab {
	tabs := make([]store.CloudTab, 0, len(b.Tabs))
	for _, t := range b.Tabs {
		tabs = append(tabs, store.CloudTab{Name: t.Name, SQL: t.SQL})
	}
	return tabs
}

type cloudTabJSON struct {
	Name     string `json:"name"`
	SQL      string `json:"sql"`
	Position int    `json:"position"`
}

// projectJSON dựng response. Danh sách không kèm nội dung tab để không đẩy SQL của mọi dự án
// sang client khi người dùng chỉ mở hộp chọn dự án.
func projectJSON(p store.CloudProject, withTabs bool) gin.H {
	out := gin.H{
		"id":        p.ID,
		"name":      p.Name,
		"engine":    p.Engine,
		"tabCount":  p.TabCount,
		"createdAt": p.CreatedAt,
		"updatedAt": p.UpdatedAt,
	}
	if withTabs {
		tabs := make([]cloudTabJSON, 0, len(p.Tabs))
		for i, t := range p.Tabs {
			tabs = append(tabs, cloudTabJSON{Name: t.Name, SQL: t.SQL, Position: i})
		}
		out["tabs"] = tabs
	}
	return out
}

// ready trả false khi chưa có DATABASE_URL: route trả 503 thay vì 500.
func (h *cloudHandler) ready(c *gin.Context) bool {
	if h.s == nil {
		Abort(c, http.StatusServiceUnavailable, "not_configured", "error.notConfigured")
		return false
	}
	return true
}

// owner lấy user id từ session. Middleware đăng nhập đã chặn trước đó; đây là lớp thứ hai.
func (h *cloudHandler) owner(c *gin.Context) (string, bool) {
	if id := h.uid(c); id != "" {
		return id, true
	}
	Abort(c, http.StatusUnauthorized, "auth_required", "error.authRequired")
	return "", false
}

// cloudID đọc tham số :id và từ chối trước khi chạm database nếu không phải UUID.
func (h *cloudHandler) cloudID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if !cloudIDRe.MatchString(id) {
		Abort(c, http.StatusBadRequest, codeCloudInvalidID, "error.badRequest")
		return "", false
	}
	return id, true
}

// fail dịch lỗi store sang mã lỗi. Nhánh mặc định KHÔNG ghi err: thông điệp lỗi của pgx có thể
// chứa giá trị cột, và giá trị đó có thể là SQL của người dùng.
func (h *cloudHandler) fail(c *gin.Context, err error) {
	// 409 có payload riêng (mốc hiện tại của server) để UI hỏi người dùng thay vì ghi đè.
	var conflict *store.CloudConflictError
	if errors.As(err, &conflict) {
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{
			"error":    gin.H{"code": "conflict", "messageKey": "error.badRequest"},
			"conflict": gin.H{"remoteUpdatedAt": conflict.RemoteUpdatedAt},
		})
		return
	}
	switch {
	case errors.Is(err, store.ErrCloudInvalidName):
		Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
	case errors.Is(err, store.ErrCloudInvalidEngine):
		Abort(c, http.StatusBadRequest, codeCloudInvalidEngine, "error.badRequest")
	case errors.Is(err, store.ErrCloudTooManyProjects):
		Abort(c, http.StatusBadRequest, codeCloudTooManyProject, "error.badRequest")
	case errors.Is(err, store.ErrCloudTooManyTabs):
		Abort(c, http.StatusBadRequest, codeCloudTooManyTabs, "error.badRequest")
	case errors.Is(err, store.ErrCloudTabTooLarge):
		Abort(c, http.StatusBadRequest, codeCloudTabTooLarge, "error.badRequest")
	case errors.Is(err, store.ErrCloudProjectTooLarge):
		// Mã riêng chứ không gộp vào tab_too_large: client cần biết phải xóa bớt tab hay cắt
		// ngắn một tab, và 400 (không phải 413) nói rằng request đã tới được handler.
		Abort(c, http.StatusBadRequest, codeCloudProjectTooBig, "error.badRequest")
	case errors.Is(err, store.ErrNotFound):
		// Người khác dùng id của chủ cũng rơi vào đây: 404 để không lộ dự án có tồn tại hay không.
		Abort(c, http.StatusNotFound, codeCloudNotFound, "error.notFound")
	default:
		log.Printf("cloud: request failed (%T)", err)
		Abort(c, http.StatusInternalServerError, "internal", "error.internal")
	}
}

func (h *cloudHandler) create(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	var body cloudProjectBody
	if err := c.ShouldBindJSON(&body); err != nil {
		Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
		return
	}
	p, err := h.s.CreateCloudProject(c.Request.Context(), owner, body.Name, body.Engine, body.toStore())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, gin.H{"project": projectJSON(p, true)})
}

func (h *cloudHandler) list(c *gin.Context) {
	if !h.ready(c) {
		return
	}
	owner, ok := h.owner(c)
	if !ok {
		return
	}
	ps, err := h.s.ListCloudProjects(c.Request.Context(), owner)
	if err != nil {
		h.fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(ps))
	for _, p := range ps {
		items = append(items, projectJSON(p, false))
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"projects": items})
}

func (h *cloudHandler) get(c *gin.Context) {
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
	p, err := h.s.GetCloudProject(c.Request.Context(), owner, id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"project": projectJSON(p, true)})
}

func (h *cloudHandler) replace(c *gin.Context) {
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
	var body cloudProjectBody
	if err := c.ShouldBindJSON(&body); err != nil {
		Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
		return
	}
	var base *time.Time
	if raw := strings.TrimSpace(body.BaseUpdatedAt); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			Abort(c, http.StatusBadRequest, codeCloudInvalidBody, "error.badRequest")
			return
		}
		base = &t
	}
	p, err := h.s.ReplaceCloudProject(c.Request.Context(), owner, id, body.Name, body.Engine, body.toStore(), base)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"project": projectJSON(p, true)})
}

func (h *cloudHandler) remove(c *gin.Context) {
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
	if err := h.s.DeleteCloudProject(c.Request.Context(), owner, id); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
