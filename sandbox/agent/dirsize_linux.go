package main

import (
	"io/fs"
	"path/filepath"
	"syscall"
)

// dirBytes cộng dung lượng thật trên đĩa (block), tính cả file thưa. Lỗi đọc thì bỏ qua file đó.
func dirBytes(dir string) int64 {
	var n int64
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if info, e := d.Info(); e == nil {
			if st, ok := info.Sys().(*syscall.Stat_t); ok {
				n += st.Blocks * 512
			}
		}
		return nil
	})
	return n
}
