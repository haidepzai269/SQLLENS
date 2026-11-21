package store

import (
	"strings"
	"testing"
)

// Test trần TỔNG theo dự án (review độc lập, lỗi 3). Không cần database: đây là kiểm tra thuần
// trên dữ liệu đầu vào, đúng chỗ mà handler dựa vào để trả 400 trước khi mở transaction.

func TestValidateCloudInputTotalBytes(t *testing.T) {
	// Một tab 512KB vẫn hợp lệ: trần riêng của tab không đổi.
	if err := ValidateCloudInput("p", "postgres", []CloudTab{{Name: "t", SQL: strings.Repeat("a", MaxCloudTabBytes)}}); err != nil {
		t.Fatalf("tab đúng 512KB: %v", err)
	}

	// Hai tab 512KB: từng tab hợp lệ và tổng 1MB vẫn dưới trần 2MB. Đây là ca mà trần body 1MB
	// toàn cục từng chặn bằng 413 trước khi tới đây.
	two := []CloudTab{
		{Name: "a", SQL: strings.Repeat("a", MaxCloudTabBytes)},
		{Name: "b", SQL: strings.Repeat("b", MaxCloudTabBytes)},
	}
	if err := ValidateCloudInput("p", "postgres", two); err != nil {
		t.Fatalf("hai tab 512KB (tổng 1MB): %v", err)
	}

	// Tab 600KB: vẫn là lỗi riêng của tab, không phải lỗi tổng — client phải biết cắt tab nào.
	big := []CloudTab{{Name: "t", SQL: strings.Repeat("a", 600*1024)}}
	if err := ValidateCloudInput("p", "postgres", big); err != ErrCloudTabTooLarge {
		t.Fatalf("tab 600KB: %v, mong đợi ErrCloudTabTooLarge", err)
	}

	// Năm tab 450KB: từng tab dưới 512KB nhưng tổng 2,25MB vượt trần 2MB.
	over := make([]CloudTab, 0, 5)
	for i := 0; i < 5; i++ {
		over = append(over, CloudTab{Name: "t", SQL: strings.Repeat("a", 450*1024)})
	}
	if err := ValidateCloudInput("p", "postgres", over); err != ErrCloudProjectTooLarge {
		t.Fatalf("tổng 2,25MB: %v, mong đợi ErrCloudProjectTooLarge", err)
	}

	// Tên tab cũng tính vào trần tổng: 100 tab với tên dài vượt trần dù SQL rỗng.
	names := make([]CloudTab, 0, MaxCloudTabs)
	longName := strings.Repeat("n", 24*1024)
	for i := 0; i < MaxCloudTabs; i++ {
		names = append(names, CloudTab{Name: longName})
	}
	if err := ValidateCloudInput("p", "postgres", names); err != ErrCloudProjectTooLarge {
		t.Fatalf("100 tab tên dài: %v, mong đợi ErrCloudProjectTooLarge", err)
	}
}
