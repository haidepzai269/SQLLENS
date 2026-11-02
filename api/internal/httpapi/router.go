package httpapi

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the engine. Gin runs in release mode unless GIN_MODE is set.
func NewRouter() *gin.Engine {
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	// Must not touch external services: the keep-alive ping calls it.
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}
