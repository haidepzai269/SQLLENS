// Package migrations nhúng các file SQL, chạy theo thứ tự tên file.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
