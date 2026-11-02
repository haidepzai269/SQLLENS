# Kết quả Task016: bắt lock wait trên MySQL thật

Nhãn: **Thật**. Mọi số liệu lấy từ MySQL 8.4.13 (image `mysql:8.4.13`) vừa chạy. Độ trễ đo trong sandbox, không phải dự đoán cho production.

Cấu hình: `innodb_lock_wait_timeout` = 8 (global) / 8 (session của user thấp), mặc định là 50 giây. Isolation mặc định REPEATABLE READ, mỗi kịch bản chạy 5 lần.
Quyền user `lowpriv`: DELETE,INSERT,SELECT,UPDATE trên `lab.*`, không có quyền nào trên `performance_schema`.

## Câu truy vấn khóa (connection thứ ba, root)

Cặp chờ:

```sql
SELECT tr.PROCESSLIST_ID, tb.PROCESSLIST_ID,
  rl.LOCK_TYPE, rl.LOCK_MODE, rl.OBJECT_SCHEMA, rl.OBJECT_NAME, IFNULL(rl.INDEX_NAME,''), IFNULL(rl.LOCK_DATA,''),
  bl.LOCK_TYPE, bl.LOCK_MODE, IFNULL(bl.LOCK_DATA,'')
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID AND rl.ENGINE = w.ENGINE
JOIN performance_schema.data_locks bl ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID AND bl.ENGINE = w.ENGINE
JOIN performance_schema.threads tr ON tr.THREAD_ID = w.REQUESTING_THREAD_ID
JOIN performance_schema.threads tb ON tb.THREAD_ID = w.BLOCKING_THREAD_ID
WHERE rl.OBJECT_SCHEMA = 'lab'
```

Khóa đang giữ của một session:

```sql
SELECT t.PROCESSLIST_ID, l.LOCK_TYPE, l.LOCK_MODE, l.OBJECT_NAME, IFNULL(l.INDEX_NAME,''), IFNULL(l.LOCK_DATA,''), l.LOCK_STATUS
FROM performance_schema.data_locks l
JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
WHERE l.OBJECT_SCHEMA = 'lab' AND t.PROCESSLIST_ID = ?
ORDER BY l.LOCK_TYPE, l.LOCK_MODE, l.LOCK_DATA
```

Deadlock: `SHOW ENGINE INNODB STATUS` (mục LATEST DETECTED DEADLOCK).

## AC1. Lock wait: B cập nhật cùng dòng A chưa commit

5/5 lần cùng kết quả: `B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP | 29ms |  |
| 2 | B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP | 15.7ms |  |
| 3 | B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP | 53.1ms |  |
| 4 | B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP | 4.9ms |  |
| 5 | B chờ A: RECORD X,REC_NOT_GAP trên lab.acct index PRIMARY; A giữ RECORD X,REC_NOT_GAP | 6.1ms |  |

Độ trễ từ lúc B bắt đầu câu lệnh bị chặn đến lúc connection thứ ba thấy khóa: min 4.9ms, trung vị 15.7ms, max 53.1ms (poll mỗi 5ms, gồm cả thời gian khởi động goroutine B).

Ví dụ dữ liệu đọc được (lần 1):

```text
A=conn 10, B=conn 11
data_lock_waits+data_locks: RECORD X,REC_NOT_GAP on lab.acct index=PRIMARY data=1 (blocked by RECORD X,REC_NOT_GAP data=1)
A đang giữ:
RECORD X,REC_NOT_GAP acct PRIMARY 1 GRANTED
TABLE IX acct   GRANTED

```

## AC2. Deadlock do cập nhật ngược thứ tự

5/5 lần cùng kết quả: `đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread | - | bên bị hủy: B |
| 2 | đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread | - | bên bị hủy: B |
| 3 | đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread | - | bên bị hủy: B |
| 4 | đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread | - | bên bị hủy: B |
| 5 | đúng một bên nhận lỗi 1213, bên kia chạy tiếp; INNODB STATUS ghi cả hai thread | - | bên bị hủy: B |

Ví dụ dữ liệu đọc được (lần 1):

```text
A=conn 20, B=conn 21, bị hủy: B
LATEST DETECTED DEADLOCK
------------------------
2026-11-02 13:08:54 140478263563840
*** (1) TRANSACTION:
TRANSACTION 1889, ACTIVE 1 sec starting index read
mysql tables in use 1, locked 1
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s), undo log entries 1
MySQL thread id 20, OS thread handle 140478253057600, query id 118 172.17.0.1 lowpriv updating
UPDATE lab.acct SET bal = bal + 1 WHERE id = 2

*** (1) HOLDS THE LOCK(S):
RECORD LOCKS space id 2 page no 4 n bits 72 index PRIMARY of table `lab`.`acct` trx id 1889 lock_mode X locks rec but not gap
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000001; asc     ;;
 1: len 6; hex 000000000761; asc      a;;
 2: len 7; hex 01000001290151; asc     ) Q;;
 3: len 4; hex 80000065; asc    e;;


*** (1) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 2 page no 4 n bits 72 index PRIMARY of table `lab`.`acct` trx id 1889 lock_mode X locks rec but not gap waiting
Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000002; asc     ;;
 1: len 6; hex 000000000762; asc      b;;
 2: len 7; hex 020000012d0151; asc     - Q;;
 3: len 4; hex 80000065; asc    e;;


*** (2) TRANSACTION:
TRANSACTION 1890, ACTIVE 1 sec starting index read
mysql tables in use 1, locked 1
LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s), undo log entries 1
MySQL thread id 21, OS thread handle 140478254114368, query id 120 172.17.0.1 lowpriv updating
UPDATE lab.acct SET bal = bal + 1 WHERE id = 1

*** (2) HOLDS THE LOCK(S):
RECORD LOCKS space id 2 page no 4 n bits 72 index PRIMARY of table `lab`.`acct` trx id 1890 lock_mode X locks rec but not gap
Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000002; asc     ;;
 1: len 6; hex 000000000762; asc      b;;
 2: len 7; hex 020000012d0151; asc     - Q;;
 3: len 4; hex 80000065; asc    e;;


*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 2 page no 4 n bits 72 index PRIMARY of table `lab`.`acct` trx id 1890 lock_mode X locks rec but not gap waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000001; asc     ;;
 1: len 6; hex 000000000761; asc      a;;
 2: len 7; hex 01000001290151; asc     ) Q;;
 3: len 4; hex 80000065; asc    e;;

*** WE ROLL BACK TRANSACTION (2)
------------
```

## AC3. Dirty read: READ UNCOMMITTED so với READ COMMITTED

5/5 lần cùng kết quả: `READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100 | - |  |
| 2 | READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100 | - |  |
| 3 | READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100 | - |  |
| 4 | READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100 | - |  |
| 5 | READ UNCOMMITTED đọc 999; READ COMMITTED đọc 100 | - |  |

Ví dụ dữ liệu đọc được (lần 1):

```text
A UPDATE bal=999 chưa commit (gốc 100); B ở READ UNCOMMITTED: SELECT bal => 999
A UPDATE bal=999 chưa commit (gốc 100); B ở READ COMMITTED: SELECT bal => 100
```

## AC4a. Lost update ở REPEATABLE READ

5/5 lần cùng kết quả: `A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A)`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A) | - |  |
| 2 | A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A) | - |  |
| 3 | A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A) | - |  |
| 4 | A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A) | - |  |
| 5 | A và B cùng đọc 100, A ghi 110, B ghi 120, kết quả cuối 120 (mất +10 của A) | - |  |

Ví dụ dữ liệu đọc được (lần 1):

```text
snapshot RR: A đọc 100, B đọc 100; sau khi A commit B vẫn thấy snapshot cũ khi đọc; cuối cùng bal=120 (cộng đúng phải là 130)
```

## AC4b. Gap lock: SELECT ... FOR UPDATE theo khoảng

5/5 lần cùng kết quả: `A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION | 4.9ms |  |
| 2 | A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION | 2.7ms |  |
| 3 | A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION | 4.8ms |  |
| 4 | A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION | 7.5ms |  |
| 5 | A giữ RECORD X,GAP trên PRIMARY tại khóa 20; INSERT 15 của B chờ với X,GAP,INSERT_INTENTION | 4.5ms |  |

Độ trễ từ lúc B bắt đầu câu lệnh bị chặn đến lúc connection thứ ba thấy khóa: min 2.7ms, trung vị 4.8ms, max 7.5ms (poll mỗi 5ms, gồm cả thời gian khởi động goroutine B).

Ví dụ dữ liệu đọc được (lần 1):

```text
A=conn 60, B=conn 61
A giữ:
RECORD X,GAP gap PRIMARY 20 GRANTED
TABLE IX gap   GRANTED

B chờ: RECORD X,GAP,INSERT_INTENTION on lab.gap index=PRIMARY data=20 (blocked by RECORD X,GAP data=20)
```

## AC5. User quyền thấp đọc performance_schema

5/5 lần cùng kết quả: `lowpriv bị từ chối, mã lỗi 1142/1142/1227`

| Lần | Kết quả | Độ trễ thấy khóa | Ghi thêm |
|---|---|---|---|
| 1 | lowpriv bị từ chối, mã lỗi 1142/1142/1227 | - |  |
| 2 | lowpriv bị từ chối, mã lỗi 1142/1142/1227 | - |  |
| 3 | lowpriv bị từ chối, mã lỗi 1142/1142/1227 | - |  |
| 4 | lowpriv bị từ chối, mã lỗi 1142/1142/1227 | - |  |
| 5 | lowpriv bị từ chối, mã lỗi 1142/1142/1227 | - |  |

Ví dụ dữ liệu đọc được (lần 1):

```text
SELECT * FROM performance_schema.data_locks => ERROR 1142: SELECT command denied to user 'lowpriv'@'172.17.0.1' for table 'data_locks'
SELECT * FROM performance_schema.data_lock_waits => ERROR 1142: SELECT command denied to user 'lowpriv'@'172.17.0.1' for table 'data_lock_waits'
SHOW ENGINE INNODB STATUS => ERROR 1227: Access denied; you need (at least one of) the PROCESS privilege(s) for this operation
đối chứng: root chạy được truy vấn đầu tiên
```

## Ca biên: innodb_lock_wait_timeout

A giữ khóa và không commit; B chờ 8s rồi nhận lỗi 1205 (Lock wait timeout exceeded; try restarting transaction), khớp `innodb_lock_wait_timeout`=8.
