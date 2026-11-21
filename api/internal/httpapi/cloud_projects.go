package httpapi

import (
	"errors"
	"log"
	"net/http"
	"regexp"

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
	codeCloudNotFound       = "not_found"
)

var cloudIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// CloudConfig nối handler với phần đăng nhập. httpapi không import được package auth
// (auth đã import httpapi), nên middleware và hàm đọc user id được truyền vào từ ngoài.
type CloudConfig struct {
	Store       *store.Store
	RequireUser gin.HandlerFunc
	UID         func(*gin.Context) string
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
	g := r.Group("/api/v1/cloud/projects", guard)
	g.POST("", h.create)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.PUT("/:id", h.replace)
	g.DELETE("/:id", h.remove)
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
	p, err := h.s.ReplaceCloudProject(c.Request.Context(), owner, id, body.Name, body.Engine, body.toStore())
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
