#!/usr/bin/env bash
# Đo thời gian khởi động và RAM của một container MySQL sandbox. Chạy: ./measure.sh
# Chạy được trên Git Bash (Windows) và Linux. Tên container t015-*. Dọn sạch khi thoát.
# Biến môi trường: IMAGE, MEM (giới hạn mặc định), SWEEP (danh sách --memory cho AC4), RUNS.
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
IMAGE="${IMAGE:-mysql:8.4.6}"
MEM="${MEM:-512m}"
SWEEP="${SWEEP:-512m 384m 256m 192m 160m 128m 96m}"
RUNS="${RUNS:-5}"
PW="t015-only-for-test"   # mật khẩu chỉ dùng trong container không có mạng, sống vài chục giây
# Bind mount từ Windows cho file quyền 0777 và mysqld bỏ qua nó ("World-writable config file is ignored"),
# nên my.cnf được đổi thành tham số dòng lệnh mysqld. Cùng một nguồn, chạy giống nhau trên Linux.
mapfile -t CNF_ARGS < <(tr -d '\r' < my.cnf | grep -vE '^[[:space:]]*(#|\[|$)' | sed 's/^/--/')
[ "${#CNF_ARGS[@]}" -gt 10 ] || { echo "my.cnf không đọc được" >&2; exit 1; }
trap 'docker ps -aq --filter name=^t015- | xargs -r docker rm -fv >/dev/null 2>&1' EXIT

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
sql() { docker exec -e MYSQL_PWD="$PW" "$1" mysql -uroot -N -B -e "$2" 2>&1; }
# docker stats cho "12.3MiB / 512MiB": đổi phần đầu sang MiB
mem_mib() { docker stats --no-stream --format '{{.MemUsage}}' "$1" | awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); sub(/[A-Za-z]+/,"",v); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; else if(u=="B")v/=1048576; printf "%.1f", v}'; }
pids() { docker stats --no-stream --format '{{.PIDs}}' "$1"; }

# Cô lập: không mạng, bỏ mọi capability trừ 5 cái entrypoint cần để chuyển sang user mysql,
# không leo quyền, root filesystem chỉ đọc, giới hạn RAM/CPU/pid.
# $1=tên $2=--memory $3=áp my.cnf (1) hay mặc định (0)
start() {
  local args=(--name "$1" -e MYSQL_ROOT_PASSWORD="$PW" --memory "$2" --memory-swap "$2" --cpus 1 --pids-limit 200
    --network none --read-only --tmpfs /tmp --tmpfs /run/mysqld --security-opt no-new-privileges
    --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE --cap-add FOWNER)
  local opts=(); [ "$3" = 1 ] && opts=("${CNF_ARGS[@]}")
  docker run -d "${args[@]}" "$IMAGE" "${opts[@]}" >/dev/null
}
# "alive": mysqladmin ping thành công (đúng AC1). "ready": server thật đã mở mạng.
# Server tạm của entrypoint cũng trả ping nhưng chạy với skip_networking=1, nên ready cần thêm điều kiện này.
wait_up() { # $1=tên $2=mốc ms; đặt ALIVE_MS, READY_MS; trả 1 nếu quá 150 giây hoặc container chết
  ALIVE_MS=""; READY_MS=""
  local i
  for i in $(seq 1 750); do
    [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] || return 1
    if docker exec "$1" mysqladmin -uroot -p"$PW" ping >/dev/null 2>&1; then
      [ -z "$ALIVE_MS" ] && ALIVE_MS=$(( $(now_ms) - $2 ))
      if [ "$(sql "$1" 'SELECT @@skip_networking' | tail -1)" = 0 ]; then READY_MS=$(( $(now_ms) - $2 )); return 0; fi
    fi
    sleep 0.2
  done
  return 1
}

# Bảng 10k dòng có index, rồi 2 connection cùng giữ khóa (B chờ khóa của A).
load() {
  sql "$1" "CREATE DATABASE d; CREATE TABLE d.t (id INT PRIMARY KEY, k INT, v VARCHAR(40), KEY ik(k));
    SET SESSION cte_max_recursion_depth=10000;
    INSERT INTO d.t SELECT n, n%1000, MD5(n) FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n<10000) SELECT n FROM s) q;"
}
hold_locks() { # chạy 2 connection nền; B bị chặn bởi A
  docker exec -e MYSQL_PWD="$PW" "$1" mysql -uroot -e "BEGIN; SELECT * FROM d.t WHERE id=1 FOR UPDATE; DO SLEEP(12);" >/dev/null 2>&1 &
  sleep 1
  docker exec -e MYSQL_PWD="$PW" "$1" mysql -uroot -e "BEGIN; SELECT * FROM d.t WHERE id=2 FOR UPDATE; SELECT * FROM d.t WHERE id=1 FOR UPDATE;" >/dev/null 2>&1 &
  sleep 2
}

# Một lượt đầy đủ. In một dòng TSV: nhãn cnf mem alive_ms ready_ms idle load locks pids waits status
run_case() { # $1=nhãn $2=--memory $3=dùng my.cnf
  local c="t015-$1-$RANDOM" t0 idle="" after="" locked="" waits="" st=ok err=""
  t0=$(now_ms); start "$c" "$2" "$3" || { echo -e "$1\t$3\t$2\t-\t-\t-\t-\t-\t-\t-\tdocker run lỗi"; return; }
  if ! wait_up "$c" "$t0"; then
    err=$(docker logs "$c" 2>&1 | grep -iE "error|killed" | tail -1 | cut -c1-120)
    echo -e "$1\t$3\t$2\t-\t-\t-\t-\t-\t-\t-\tkhông lên: oom=$(docker inspect -f '{{.State.OOMKilled}} exit={{.State.ExitCode}}' "$c") $err"
    docker rm -fv "$c" >/dev/null; return
  fi
  sleep 5; idle=$(mem_mib "$c")
  err=$(load "$c"); [ -n "$err" ] && st="load lỗi: $(echo "$err" | tail -1 | cut -c1-100)"
  after=$(mem_mib "$c")
  if [ "$st" = ok ]; then
    hold_locks "$c"; locked=$(mem_mib "$c")
    waits=$(sql "$c" "SELECT COUNT(*) FROM performance_schema.data_lock_waits" | tail -1)
    wait   # chờ 2 connection nền kết thúc
  fi
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] || st="chết giữa chừng: oom=$(docker inspect -f '{{.State.OOMKilled}} exit={{.State.ExitCode}}' "$c")"
  echo -e "$1\t$3\t$2\t$ALIVE_MS\t$READY_MS\t$idle\t$after\t${locked:--}\t$(pids "$c")\t${waits:--}\t$st"
  docker rm -fv "$c" >/dev/null
}

echo "Image: $IMAGE ($(docker image inspect -f '{{.Id}}' "$IMAGE" | cut -c1-19)), docker $(docker version -f '{{.Server.Version}} {{.Server.Arch}}'), CPU $(docker info -f '{{.NCPU}}'), RAM docker $(docker info -f '{{.MemTotal}}') byte"
echo "Cột: nhãn | dùng my.cnf | --memory | ping ms | ready ms | RAM nhàn rỗi MiB | sau bảng 10k MiB | sau 2 khóa MiB | pid | số dòng data_lock_waits | trạng thái"
docker pull -q "$IMAGE" >/dev/null 2>&1 || true

echo "## AC1+AC2: $RUNS lần, my.cnf tối giản, --memory $MEM"
for i in $(seq 1 "$RUNS"); do run_case min "$MEM" 1; done
echo "## AC3: mặc định (không my.cnf), --memory $MEM"
run_case default "$MEM" 0
echo "## AC4: quét --memory, my.cnf tối giản"
for m in $SWEEP; do run_case sweep "$m" 1; done
