# Review độc lập Task150 + Task151

Người review: lead (không phải agent viết code). Ngày 2026-11-21.
Phạm vi: 2 commit `6b4c730` (feat) + `726c048` (docs) trên nhánh `task/Task150`, so với `main`.
Môi trường: PostgreSQL 18.6 trong Docker (`postgres://postgres:t150@localhost:54491/app`), Go test thật, không mock.

## Kết luận: **FAIL** — 1 lỗi chặn phát hành, không merge được

Cả hai bàn giao đều ghi "chưa gọi reviewer độc lập". Review này lấp chỗ đó, và tìm ra một lỗi
mà **toàn bộ 13 test hiện có không thể bắt được**, vì chúng chạy bằng role `postgres` là superuser.

---

## LỖI CHẶN (confirmed, đã tái hiện bằng máy)

### B1. `insertCloudTabs` dùng `COPY FROM`, mà PostgreSQL **không hỗ trợ** `COPY FROM` trên bảng có RLS

`api/internal/store/cloud.go:105` dùng `tx.CopyFrom(...)` để ghi tab. Với bảng đã bật RLS,
PostgreSQL trả thẳng:

```
ERROR: COPY FROM not supported with row-level security (SQLSTATE 0A000)
```

Đây không phải hạn chế của role app — nó xảy ra với **chính role chủ bảng** khi bảng có
`FORCE ROW LEVEL SECURITY` (đúng chân dung `neondb_owner` của Neon). Hệ quả:

- **Không lưu được bất kỳ dự án nào có ít nhất 1 tab.** Tức là AC1 của Task150 ("tạo dự án kèm 3 tab")
  hỏng 100% trên production.
- `CreateCloudProject` và `ReplaceCloudProject` đều đi qua `insertCloudTabs`, nên cả tạo mới lẫn cập nhật đều hỏng.
- Dự án **không có tab** vẫn lưu được, nên lỗi sẽ lộ ra dưới dạng "lưu dự án trống thì được, lưu dự án có SQL thì 500"
  — rất dễ bị chẩn đoán nhầm là lỗi frontend.

Bằng chứng đo được (role `t150_owner`, `NOSUPERUSER NOBYPASSRLS`, là owner của cả 3 bảng, `relforcerowsecurity = true`):

```
CreateCloudProject kèm 2 tab:  err=store: cloud tabs: ERROR: COPY FROM not supported with row-level security (SQLSTATE 0A000)
CreateCloudProject không tab:  err=<nil>            (id trả về bình thường)
ReplaceCloudProject thêm tab:  err=store: cloud tabs: ERROR: COPY FROM not supported with row-level security (SQLSTATE 0A000)
```

Và chạy đúng bộ test của Task150 dưới role chủ non-superuser thì 4/6 test FAIL:

```
TestCloudCreateReadOrder  POST = 500 {"error":{"code":"internal",...}}
TestCloudCrossTenant      POST = 500
TestCloudDeleteCascade    DELETE = 404
TestCloudLogsNoSQL        POST = 500
TestCloudQuota            ERROR: new row violates row-level security policy for table "cloud_projects"
```

### Vì sao 6/6 test vẫn xanh trong bàn giao

Bàn giao ghi "6/6 PASS trên PostgreSQL 18.6 thật". Đúng, nhưng **test chạy bằng role `postgres`,
mà superuser bỏ qua RLS hoàn toàn** (`rolsuper = t`, `rolbypassrls = t`). Với superuser,
`COPY FROM` không bị chặn và policy không có tác dụng. Nên bộ test chứng minh được CRUD,
quota, cascade, log — nhưng **không chứng minh được gì về RLS**, và vô tình che mất B1.

Đây đúng là cái bẫy mà bàn giao Task151 đã cảnh báo cho Task152 ("chân dung Neon"), chỉ khác là
nó đã cắn ngay ở Task150.

### Cách sửa đã kiểm chứng

Thay `CopyFrom` bằng **một câu `INSERT` nhiều dòng** dựng tham số. Tôi đã chạy thử trên đúng
role chủ non-superuser có `FORCE`:

```
INSERT nhiều dòng dưới RLS:  err=<nil>
chủ đọc lại:                 3 tab   (mong đợi 3)
người ngoài INSERT tab:      ERROR: new row violates row-level security policy for table "cloud_tabs"
người ngoài đọc tab:         0 tab
```

Tức là cách sửa này **giữ nguyên lớp bảo vệ RLS** (người ngoài vẫn bị chặn cả đọc lẫn ghi),
chỉ đổi cơ chế ghi. Cần sửa kèm: thêm một test chạy bằng role chủ `NOSUPERUSER NOBYPASSRLS`
sao cho test **FAIL trên code hiện tại** và PASS sau khi sửa — nếu không thì lại là test không thể fail.

---

## Đã kiểm độc lập và ĐẠT

Những điều dưới đây tôi tự chạy lại, không dựa vào lời bàn giao:

1. **Task151 — `FORCE RLS` có tác dụng thật với role chủ non-superuser** (đây là mục bàn giao
   Task151 ghi "chưa làm được", nay đã kiểm): dựng role `t150_owner NOSUPERUSER NOBYPASSRLS` sở hữu
   3 bảng, chạy `Migrate` bằng chính role đó → `MIGRATE OK`. Đọc dữ liệu qua `WithTenant`:

   ```
   role chạy API: t150_owner super=false bypassrls=false
     cloud_projects        owner=t150_owner  force=true
     cloud_tabs            owner=t150_owner  force=true
     cloud_project_members owner=t150_owner  force=true
   A thấy 1, B thấy 1
   A đọc thẳng dự án của B: 0 dòng
   A xóa thẳng dự án của B: 0 hàng
   owner đọc KHÔNG ngữ cảnh: 0 dòng
   ```

   Dòng cuối là quan trọng nhất: role chủ, không có `set_config`, vẫn thấy 0 dòng. `FORCE` là
   lớp bảo vệ thật chứ không phải hình thức.

2. **Task150 — quota chống được request đồng thời** (bàn giao khẳng định nhờ
   `pg_advisory_xact_lock`, chưa có số): dựng 49 dự án rồi bắn **6 request song song**:
   `ok=1 chặn=5 lỗi_khác=0 | tổng sau=50 (trần 50)`. Không có khe hở.

3. **Task150 — không log SQL**: `TestCloudLogsNoSQL` PASS, log nhánh 500 chỉ có
   `cloud: request failed (*fmt.wrapError)` và `POST /api/v1/cloud/projects 500`, không có dấu
   `ZZTOPSECRET`, không có chữ `SELECT`. `requestLog` chỉ in method + route pattern + status.

4. **Task150 — `owner_id` không nhận từ body**: struct request không có trường đó, test gửi
   `"owner_id"` của người khác và DB vẫn ghi đúng người gọi.

5. **Task151 — 12 policy, không `FOR ALL`, lệnh ghi có `WITH CHECK`, members có policy**:
   `TestTenantRLSCatalog` PASS, đọc từ `pg_policy`/`pg_class` chứ không tin file migration.

6. **Task151 — `WithTenant` là cửa duy nhất**: `TestTenantOnlyHelperSetsContext` PASS (grep toàn
   `api/` cấm `set_config`/`current_setting` ngoài `tenant.go`).

7. **Task151 — không rò ngữ cảnh qua pool**: `TestTenantContextLeak` PASS, hai lượt buộc dùng
   chung `pg_backend_pid`, connection rảnh có `current_setting(...)` = NULL.

8. **Chạy lại được**: `TestTenantMigrationTwice` PASS, 12 policy không nhân đôi.

9. **Chất lượng chung**: `go vet ./...` sạch; `go test -p 1 -count=1 ./...` 7/7 package `ok`;
   `TestCloudMigrateTwice` đã đổi sang đếm số file `.sql` nhúng nên không vỡ khi thêm 004 —
   sửa đúng.

---

## Cần chủ dự án quyết (không phải lỗi đã chứng minh)

1. **Body toàn cục 1MB vs quota 100 tab × 512KB**: không thể chạm trần 100 tab trong một request
   vì `MaxBodyBytes = 1 << 20` chặn trước. Hoặc nới riêng cho route cloud (kèm trần riêng),
   hoặc sửa con số trong hợp đồng. Hiện tài liệu đang hứa một giới hạn không đạt tới được.
2. **Chưa có rate limit cho CRUD cloud**: user đã đăng nhập ghi Neon liên tục được.
   `auth.Gate` đòi Upstash nên Task150 không gắn. Với Neon free 100 CU-giờ, đây là rủi ro chi phí thật.
3. **`name` không có trần riêng**, trần thực tế là 1MB của body.
4. **Policy `cloud_tabs` kiểm thành viên, không kiểm `role`**: một `viewer` ghi/xóa tab của dự án
   được chia sẻ. Bàn giao Task151 đã ghi; Task152/153 phải siết `role IN ('owner','editor')` nếu
   muốn phân quyền thật.
5. **`app.owned_projects` tính một lần đầu transaction**: "tạo dự án rồi thêm thành viên trong
   cùng transaction" sẽ vi phạm `WITH CHECK`. Chưa ảnh hưởng vì chưa có đường ghi members.

## Ghi nhận thêm

- Rào chắn localhost của `cloud_projects_test.go:61` dùng `strings.Contains(url, "@localhost:")`,
  yếu hơn `guardLocalOnly` của `store_cloud_test.go` (so khớp `Hostname()` chính xác). Không phải
  lỗi bảo mật production, nhưng nên thống nhất về một hàm.
- Bàn giao Task150 mục "Việc tiếp theo cần biết" nói API dùng **một pool** role chủ thay vì pool
  `sqllens_app`. Điều này làm `FORCE RLS` trở thành lớp bảo vệ **duy nhất** cho dữ liệu thật —
  nên B1 càng nghiêm trọng: khi lớp đó bật lên thì đường ghi tab gãy, và nếu ai đó "sửa nhanh"
  bằng cách tắt `FORCE` thì mất luôn lớp bảo vệ duy nhất.
- Tại thời điểm review, working tree có thay đổi chưa commit của agent khác
  (`web/src/modules/cloud/`, `tenant_rls_test.go`, `cloud.go` đang thêm `CloudConflictError`).
  Review này chỉ đánh giá **2 commit đã commit**, không đánh giá phần đang làm dở.
