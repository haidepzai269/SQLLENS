#!/usr/bin/env bash
# AC3 Task018: tăng dần số container MySQL chạy cùng lúc trên máy Azure, mỗi cái giữ khóa như measure.sh của Task015.
# Chạy trên máy: sudo IMAGE=mysql:8.4.13 bash capacity.sh   (cần my.cnf cạnh file này, như spikes/mysql-container/my.cnf)
# Dừng khi: MemAvailable < 15% RAM, có container bị OOM/chết, thời gian sẵn sàng > 2x lần đầu, swap máy > SWAP_MAX_MB, hoặc đủ MAX.
# Container chỉ --network none, không mở cổng. Dọn sạch t018-* khi thoát.
set -u
cd "$(dirname "$0")"
IMAGE="${IMAGE:-mysql:8.4.13}"; MEM="${MEM:-384m}"; MAX="${MAX:-8}"; HOLD="${HOLD:-1500}"; SWAP_MAX_MB="${SWAP_MAX_MB:-300}"
PW="t018-only-for-test"
mapfile -t CNF < <(tr -d '\r' < my.cnf | grep -vE '^[[:space:]]*(#|\[|$)' | sed 's/^/--/')
[ "${#CNF[@]}" -gt 10 ] || { echo "my.cnf không đọc được" >&2; exit 1; }
trap 'docker ps -aq --filter name=^t018- | xargs -r docker rm -fv >/dev/null 2>&1; jobs -p | xargs -r kill 2>/dev/null' EXIT
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
kb() { awk -v k="$1" '$1==k":"{print $2}' /proc/meminfo; }
sql() { docker exec -e MYSQL_PWD="$PW" "$1" mysql -uroot -N -B -e "$2" 2>&1; }
TOTAL=$(kb MemTotal)
echo "Image $IMAGE --memory $MEM, RAM máy $((TOTAL/1024)) MiB, ngưỡng 15% = $((TOTAL*15/100/1024)) MiB"
echo "n | ready_ms | MemAvailable MiB (trước) | MemAvailable MiB (sau) | % | swap máy MiB | RAM theo docker stats (tổng MiB) | ghi chú"
base=0
for n in $(seq 1 "$MAX"); do
  before=$(( $(kb MemAvailable)/1024 )); c="t018-$n"; t0=$(now_ms); note=ok
  # lưới an toàn: dưới 150 MiB thì container kế (~270 MiB) sẽ ép máy vào swap sâu, không thử
  [ "$before" -lt 150 ] && { echo "DỪNG trước n=$n: MemAvailable $before MiB < 150 MiB, không đủ chỗ an toàn"; break; }
  docker run -d --name "$c" -e MYSQL_ROOT_PASSWORD="$PW" --memory "$MEM" --memory-swap "$MEM" --cpus 1 --pids-limit 200 \
    --network none --read-only --tmpfs /tmp --tmpfs /run/mysqld --security-opt no-new-privileges \
    --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE --cap-add FOWNER "$IMAGE" "${CNF[@]}" >/dev/null || { echo "$n | docker run lỗi"; break; }
  ready=""
  for i in $(seq 1 900); do   # tối đa 180 giây
    [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] || { note="chết lúc khởi động oom=$(docker inspect -f '{{.State.OOMKilled}}' "$c")"; break; }
    if docker exec "$c" mysqladmin -uroot -p"$PW" ping >/dev/null 2>&1 && [ "$(sql "$c" 'SELECT @@skip_networking' | tail -1)" = 0 ]; then ready=$(( $(now_ms) - t0 )); break; fi
    sleep 0.2
  done
  if [ -n "$ready" ]; then
    sql "$c" "CREATE DATABASE d; CREATE TABLE d.t (id INT PRIMARY KEY, k INT, v VARCHAR(40), KEY ik(k));
      SET SESSION cte_max_recursion_depth=10000;
      INSERT INTO d.t SELECT n, n%1000, MD5(n) FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n<10000) SELECT n FROM s) q;" >/dev/null || note="load lỗi"
    docker exec -e MYSQL_PWD="$PW" "$c" mysql -uroot -e "BEGIN; SELECT * FROM d.t WHERE id=1 FOR UPDATE; DO SLEEP($HOLD);" >/dev/null 2>&1 &
    sleep 1
    docker exec -e MYSQL_PWD="$PW" "$c" mysql -uroot -e "BEGIN; SELECT * FROM d.t WHERE id=2 FOR UPDATE; SELECT * FROM d.t WHERE id=1 FOR UPDATE;" >/dev/null 2>&1 &
    sleep 4
    w=$(sql "$c" "SELECT COUNT(*) FROM performance_schema.data_lock_waits" | tail -1); [ "$w" = 1 ] || note="$note; data_lock_waits=$w"
  fi
  sleep 3
  av=$(( $(kb MemAvailable)/1024 )); pct=$(( av*1024*100/TOTAL )); swap=$(( ($(kb SwapTotal)-$(kb SwapFree))/1024 ))
  sum=$(docker stats --no-stream --format '{{.MemUsage}}' | awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); sub(/[A-Za-z]+/,"",v); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; s+=v} END{printf "%.0f", s}')
  oom=$(docker ps -a --filter name=^t018- --format '{{.Names}}' | while read x; do docker inspect -f '{{.Name}} oom={{.State.OOMKilled}} run={{.State.Running}}' "$x"; done | grep -E 'oom=true|run=false' | tr '\n' ' ')
  [ -n "$oom" ] && note="$note; $oom"
  echo "$n | ${ready:--} | $before | $av | $pct% | $swap | $sum | $note"
  [ "$n" = 1 ] && base=${ready:-0}
  stop=""
  [ -z "$ready" ] && stop="không lên"
  [ -n "$oom" ] && stop="OOM/chết"
  [ "$pct" -lt 15 ] && stop="RAM trống < 15%"
  [ "$base" -gt 0 ] && [ -n "$ready" ] && [ "$ready" -gt $((base*2)) ] && stop="${stop:+$stop, }thời gian sẵn sàng > 2x lần đầu"
  [ "$swap" -gt "$SWAP_MAX_MB" ] && stop="${stop:+$stop, }swap máy > ${SWAP_MAX_MB} MiB (dừng sớm để máy khỏi treo)"
  [ -n "$stop" ] && { echo "DỪNG ở n=$n: $stop"; break; }
done
echo "Xong. Dọn container..."
