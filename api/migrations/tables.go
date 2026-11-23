package migrations

// DropAllTablesSQL là danh sách mọi bảng do các migration trong package này tạo, xếp con
// trước cha, dùng cho việc dọn database về trạng thái trắng (test, dựng lại từ đầu).
//
// VÌ SAO PHẢI LÀ MỘT HẰNG SỐ DÙNG CHUNG, KHÔNG ĐƯỢC CHÉP TAY LẠI:
// `DROP TABLE ... CASCADE` xoá khoá ngoại của bảng được nêu tên, nhưng KHÔNG xoá bảng con
// không có tên trong danh sách. Bảng con sống sót, rồi `CREATE TABLE IF NOT EXISTS` ở lần
// Migrate sau bỏ qua nó — nên bảng đó vĩnh viễn mất khoá ngoại mà không ai báo lỗi. Đó đúng
// là lỗi L1 của Task171: sáu helper dọn database chép tay danh sách thiếu `room_invite_tokens`
// và `room_baton`, và test vẫn xanh trong khi khoá ngoại đã biến mất.
//
// Một danh sách chép tay ở tám chỗ thì tám cơ hội quên. Thêm bảng mới vào migration thì thêm
// đúng một dòng ở đây, mọi chỗ dọn database tự đúng theo.
const DropAllTablesSQL = `room_invite_tokens, room_baton,
		cloud_project_members, cloud_tabs, cloud_projects,
		user_vip_redemptions, vip_codes, sessions, identities, users, schema_migrations`

// DropCloudTablesSQL chỉ gồm các bảng của 003/006, để lại `users` và bảng đăng nhập. Dùng cho
// test cần dựng lại riêng phần cloud mà vẫn giữ tài khoản đang đăng nhập.
const DropCloudTablesSQL = `room_invite_tokens, room_baton,
		cloud_project_members, cloud_tabs, cloud_projects`
