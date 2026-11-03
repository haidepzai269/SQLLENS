#!/usr/bin/env bash
# Kiểm quyền sqllens_user (Task036). Chạy bằng root trên Linux, cần seed.sh build trước.
#   sudo ./lowpriv.sh ac1|ac2|ac3|ac4|ac5|edge   (mỗi lệnh tự tạo và hủy phiên riêng; ac3 chạy 5 lần)
# Thoát khác 0 nếu có dòng FAIL.
set -uo pipefail
. "$(dirname "$0")/common.sh"
S="$HERE/session.sh"; N="${N:-lp-a}"; N2="${N2:-lp-b}"; FAILS=0
u() { "$S" exec "$N" --as user "$@"; }
r() { "$S" exec "$N" --as root "$@"; }
fail() { echo "FAIL | $*"; FAILS=$((FAILS+1)); }
first() { head -1 | cut -c1-120; }
deny() { local out; out=$(u -e "$2" 2>&1) && fail "$1: chạy được" || echo "OK bị từ chối | $1 | $(echo "$out" | first)"; }
ok() { local out; out=$(u -e "$2" 2>&1) && echo "OK chạy được | $1" || fail "$1: $(echo "$out" | first)"; }
start() { "$S" destroy "$N"; "$S" create "$N" --innodb-lock-wait-timeout=8 >/dev/null || { echo "không tạo được phiên"; exit 1; }; }
trap '"$S" destroy "$N"; "$S" destroy "$N2"; jobs -p | xargs -r kill 2>/dev/null' EXIT

ac1() {
  start
  ok "chuẩn bị bảng t" "CREATE TABLE t(a INT)"
  deny "đọc performance_schema.data_locks" "SELECT COUNT(*) FROM performance_schema.data_locks"
  deny "đọc performance_schema.data_lock_waits" "SELECT COUNT(*) FROM performance_schema.data_lock_waits"
  deny "đọc mysql.user" "SELECT user FROM mysql.user"
  deny "SELECT INTO OUTFILE" "SELECT 1 INTO OUTFILE '/tmp/lp.out'"
  v=$(u -N -B -e "SELECT IFNULL(LOAD_FILE('/etc/passwd'),'NULL')" 2>&1 | first)
  [ "$v" = NULL ] && echo "OK bị từ chối | LOAD_FILE trả NULL (secure_file_priv=NULL, không có FILE)" || fail "LOAD_FILE trả: $v"
  deny "LOAD DATA INFILE" "LOAD DATA INFILE '/etc/passwd' INTO TABLE t"
  out=$(u --local-infile=1 -e "LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE t" 2>&1) && fail "LOAD DATA LOCAL chạy được" || echo "OK bị từ chối | LOAD DATA LOCAL INFILE | $(echo "$out" | first)"
  deny "SET GLOBAL" "SET GLOBAL max_connections=5"
  deny "SET PERSIST" "SET PERSIST max_connections=5"
  deny "CREATE USER" "CREATE USER 'x'@'%' IDENTIFIED BY 'y'"
  deny "GRANT toàn cục" "GRANT SELECT ON *.* TO 'sqllens_user'@'localhost'"
  deny "GRANT FILE" "GRANT FILE ON *.* TO 'sqllens_user'@'localhost'"
  deny "GRANT trên mysql.*" "GRANT SELECT ON mysql.* TO 'sqllens_user'@'localhost'"
  out=$(u -e '\! id' 2>&1); echo "$out" | grep -q '^uid=' && fail "lệnh phía client \! chạy được shell trong container" || echo "OK bị từ chối | \! (lệnh shell phía client) | $(echo "$out" | first)"
  out=$(u -e 'system id' 2>&1); echo "$out" | grep -q '^uid=' && fail "system chạy được" || echo "OK bị từ chối | system | $(echo "$out" | first)"
  out=$(u --commands --system-command -e '\! id' 2>&1); echo "$out" | grep -q '^uid=' && fail "tham số của người gọi bật lại \!" || echo "OK bị từ chối | --commands đứng trước không bật lại được \!"
  r -N -B -e "SELECT SLEEP(20)" >/dev/null 2>&1 &
  sleep 1
  rid=$(r -N -B -e "SELECT id FROM information_schema.processlist WHERE user='root' AND info LIKE 'SELECT SLEEP(20)%' AND id<>CONNECTION_ID()" | first)
  [ -n "$rid" ] || { fail "không tìm được kết nối root để thử"; return; }
  n=$(u -N -B -e "SHOW PROCESSLIST" | awk -F'\t' '$2=="root"' | wc -l)
  [ "$n" = 0 ] && echo "OK | SHOW PROCESSLIST không thấy kết nối root (0 dòng)" || fail "SHOW PROCESSLIST thấy $n dòng root"
  n=$(u -N -B -e "SELECT COUNT(*) FROM information_schema.processlist WHERE user='root'" | first)
  [ "$n" = 0 ] && echo "OK | information_schema.processlist không thấy root" || fail "information_schema.processlist thấy $n dòng root"
  deny "KILL kết nối root ($rid)" "KILL $rid"
  deny "KILL QUERY kết nối root ($rid)" "KILL QUERY $rid"
  n=$(r -N -B -e "SELECT COUNT(*) FROM information_schema.processlist WHERE id=$rid" | first)
  [ "$n" = 1 ] && echo "OK | kết nối root vẫn sống sau KILL" || fail "kết nối root đã mất"
}

ac2() {
  start
  ok "CREATE TABLE" "CREATE TABLE a(id INT PRIMARY KEY, k INT, KEY ik(k)); CREATE TABLE b(id INT PRIMARY KEY, a_id INT, FOREIGN KEY(a_id) REFERENCES a(id))"
  ok "CREATE INDEX" "CREATE INDEX ik2 ON a(k,id)"
  ok "ALTER TABLE" "ALTER TABLE a ADD COLUMN v VARCHAR(10)"
  ok "INSERT" "INSERT INTO a(id,k,v) VALUES(1,10,'x'),(2,20,'y'); INSERT INTO b VALUES(1,1)"
  ok "UPDATE" "UPDATE a SET v='z' WHERE id=1"
  ok "SELECT JOIN" "SELECT a.id,b.id FROM a JOIN b ON b.a_id=a.id"
  ok "BEGIN/COMMIT" "BEGIN; UPDATE a SET k=11 WHERE id=1; COMMIT"
  ok "BEGIN/ROLLBACK" "BEGIN; UPDATE a SET k=12 WHERE id=1; ROLLBACK"
  ok "SELECT FOR UPDATE" "BEGIN; SELECT * FROM a WHERE id=1 FOR UPDATE; COMMIT"
  ok "EXPLAIN" "EXPLAIN SELECT * FROM a WHERE k=10"
  ok "EXPLAIN ANALYZE" "EXPLAIN ANALYZE SELECT * FROM a JOIN b ON b.a_id=a.id"
  ok "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED" "SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"
  ok "CREATE VIEW" "CREATE VIEW va AS SELECT id,k FROM a"
  ok "bảng tạm" "CREATE TEMPORARY TABLE tt(x INT); INSERT INTO tt VALUES(1)"
  ok "LOCK TABLES" "LOCK TABLES a WRITE; UPDATE a SET k=13 WHERE id=1; UNLOCK TABLES"
  ok "CREATE PROCEDURE và TRIGGER" "CREATE PROCEDURE pr() SELECT 1; CALL pr(); CREATE TRIGGER tg BEFORE INSERT ON a FOR EACH ROW SET NEW.k=NEW.k+1"
  ok "DELETE" "DELETE FROM b"
  ok "DROP TABLE" "DROP VIEW va; DROP TABLE b, a"
}

ac3() {
  start
  local d; d=$(mktemp -d)
  u -e "CREATE TABLE acct(id INT PRIMARY KEY,bal INT); CREATE TABLE gp(k INT PRIMARY KEY)"
  reset() { u -e "DELETE FROM acct; INSERT INTO acct VALUES(1,100),(2,100); DELETE FROM gp; INSERT INTO gp VALUES(10),(20),(30)"; }
  reset
  u -e "BEGIN; UPDATE acct SET bal=bal+1 WHERE id=1; DO SLEEP(4); COMMIT" & sleep 1
  u -e "UPDATE acct SET bal=bal+1 WHERE id=1" & sleep 1.5
  echo "lock wait: data_lock_waits=$(r -N -B -e 'SELECT COUNT(*) FROM performance_schema.data_lock_waits') | $(r -N -B -e 'SELECT l.LOCK_MODE,l.INDEX_NAME FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID' | tr '\t' ' ')"
  wait; reset
  u -e "BEGIN; UPDATE acct SET bal=1 WHERE id=1; DO SLEEP(2); UPDATE acct SET bal=1 WHERE id=2; COMMIT" >"$d/a" 2>&1 &
  u -e "BEGIN; UPDATE acct SET bal=2 WHERE id=2; DO SLEEP(2); UPDATE acct SET bal=2 WHERE id=1; COMMIT" >"$d/b" 2>&1 &
  wait; echo "deadlock: số bên nhận lỗi 1213=$(cat "$d/a" "$d/b" | grep -c 'ERROR 1213')"
  reset
  u -e "BEGIN; UPDATE acct SET bal=999 WHERE id=1; DO SLEEP(3); ROLLBACK" & sleep 1
  echo "dirty read: READ UNCOMMITTED=$(u -N -B -e 'SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT bal FROM acct WHERE id=1') READ COMMITTED=$(u -N -B -e 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED; SELECT bal FROM acct WHERE id=1')"
  wait; reset
  u -e "BEGIN; SELECT bal FROM acct WHERE id=1; DO SLEEP(2); UPDATE acct SET bal=100+20 WHERE id=1; COMMIT" >/dev/null & sleep 0.8
  u -e "UPDATE acct SET bal=bal+30 WHERE id=1"; wait
  echo "lost update: kết quả cuối=$(u -N -B -e 'SELECT bal FROM acct WHERE id=1')"
  reset
  u -e "BEGIN; SELECT * FROM gp WHERE k BETWEEN 11 AND 19 FOR UPDATE; DO SLEEP(4); COMMIT" >/dev/null & sleep 1
  u -e "INSERT INTO gp VALUES(15)" >/dev/null 2>&1 & sleep 1.5
  echo "gap lock: giữ=$(r -N -B -e "SELECT LOCK_MODE FROM performance_schema.data_locks WHERE OBJECT_NAME='gp' AND LOCK_DATA='20' AND LOCK_STATUS='GRANTED'" | tr '\n' ' ') chờ=$(r -N -B -e "SELECT LOCK_MODE FROM performance_schema.data_locks WHERE OBJECT_NAME='gp' AND LOCK_STATUS='WAITING'" | tr '\n' ' ')"
  wait
  wait; rm -rf "$d"
}

ac4() {
  start; "$S" destroy "$N2"; "$S" create "$N2" >/dev/null
  A=$("$S" path "$N"); B=$("$S" path "$N2")
  for w in root user; do cmp -s "$A/$w.pw" "$B/$w.pw" && fail "mật khẩu $w trùng giữa hai phiên" || echo "OK | mật khẩu $w khác nhau"; done
  cmp -s "$A/root.pw" "$A/user.pw" && fail "root và user cùng mật khẩu" || echo "OK | root.pw khác user.pw"
  echo "quyền file: $(stat -c '%a %U' "$A/root.pw" "$A/user.pw" | tr '\n' ';')"
  out=$(printf '[client]\npassword=%s\n' "$(cat "$A/user.pw")" | docker exec -i "sqllens-mysql-$N2" mysql --defaults-extra-file=/dev/stdin -usqllens_user -e 'SELECT 1' 2>&1) \
    && fail "sqllens_user phiên A vào được phiên B" || echo "OK bị từ chối | user A -> phiên B | $(echo "$out" | first)"
  docker inspect "sqllens-mysql-$N" "sqllens-mysql-$N2" | grep -cF -e "$(cat "$A/user.pw")" -e "$(cat "$A/root.pw")" -e "$(cat "$B/user.pw")" -e "$(cat "$B/root.pw")" | sed 's/^/mật khẩu trong docker inspect: /'
  docker logs "sqllens-mysql-$N" 2>&1 | grep -cF -e "$(cat "$A/user.pw")" -e "$(cat "$A/root.pw")" | sed 's/^/mật khẩu trong docker logs: /'
  ( u -N -B -e "SELECT SLEEP(3)" >/dev/null & sleep 1; ps -eo args > /tmp/lp.ps; grep -cF -f "$A/user.pw" -f "$A/root.pw" /tmp/lp.ps | sed 's/^/mật khẩu trong ps: /'; wait )
}

ac5() {
  start
  echo "--- user(): $(u -N -B -e 'SELECT CURRENT_USER()')"
  echo "--- information_schema.schemata:"; u -N -B -e "SELECT schema_name FROM information_schema.schemata ORDER BY 1"
  echo "--- SHOW DATABASES:"; u -N -B -e "SHOW DATABASES"
  echo "--- số bảng theo schema thấy được:"; u -N -B -e "SELECT table_schema,COUNT(*) FROM information_schema.tables GROUP BY 1 ORDER BY 1"
  echo "--- SHOW GRANTS:"; u -N -B -e "SHOW GRANTS"
  echo "--- thấy mysql.user trong information_schema.tables? $(u -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='mysql'")"
  echo "--- user_privileges (toàn cục): $(u -N -B -e "SELECT GROUP_CONCAT(privilege_type) FROM information_schema.user_privileges")"
}

edge() {
  start
  ok "procedure SQL SECURITY DEFINER (definer là chính user)" "CREATE PROCEDURE pd() SQL SECURITY DEFINER SELECT user FROM mysql.user"
  out=$(u -e "CALL pd()" 2>&1) && fail "CALL pd đọc được mysql.user" || echo "OK bị từ chối | CALL pd đọc mysql.user | $(echo "$out" | first)"
  deny "DEFINER=root procedure" "CREATE DEFINER='root'@'localhost' PROCEDURE pr() SQL SECURITY DEFINER SELECT user FROM mysql.user"
  ok "bảng cho trigger" "CREATE TABLE tr(a INT)"
  deny "DEFINER=root trigger" "CREATE DEFINER='root'@'localhost' TRIGGER tg BEFORE INSERT ON tr FOR EACH ROW SET NEW.a=1"
  deny "DEFINER=root view" "CREATE DEFINER='root'@'localhost' SQL SECURITY DEFINER VIEW vr AS SELECT user FROM mysql.user"
  deny "tạo event" "CREATE EVENT ev ON SCHEDULE EVERY 1 SECOND DO SELECT 1"
  deny "tự đổi mật khẩu (Task037)" "SET PASSWORD='x'"
  echo "max_allowed_packet=$(u -N -B -e 'SELECT @@max_allowed_packet') (mong đợi 4194304)"
  echo "max_execution_time: global=$(r -N -B -e 'SELECT @@global.max_execution_time') user=$(u -N -B -e 'SELECT @@session.max_execution_time')"
  t0=$(date +%s); v=$(u -N -B -e "SELECT SLEEP(40)"); echo "SELECT SLEEP(40): trả $v sau $(( $(date +%s) - t0 )) giây (1 = bị ngắt)"
  ok "user tự đặt max_execution_time=0 cho phiên (giới hạn chỉ là mặc định)" "SET SESSION max_execution_time=0"
  for i in 1 2 3 4 5 6 7; do ( u -e "DO SLEEP(3)" >/dev/null 2>&1 & ); done; sleep 1
  echo "MAX_USER_CONNECTIONS=6: kết nối thứ 7+ -> $(u -e 'SELECT 1' 2>&1 | first)"; sleep 3
}

"${1:?dùng: lowpriv.sh ac1|ac2|ac3|ac4|ac5|edge}"
[ "$FAILS" = 0 ] || { echo "$FAILS FAIL"; exit 1; }
