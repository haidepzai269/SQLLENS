//go:build !linux

package main

import (
	"io/fs"
	"path/filepath"
)

// Chỉ để biên dịch và test trên máy phát triển; agent thật chạy trên Linux.
func dirBytes(dir string) int64 {
	var n int64
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, e := d.Info(); e == nil {
				n += info.Size()
			}
		}
		return nil
	})
	return n
}
