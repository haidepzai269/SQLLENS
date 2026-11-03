#!/usr/bin/env bash
# Đo trên máy Azure. Chạy: sudo ./bench.sh time1|time2|capacity
#   time1    : 5 lần, mỗi lần tạo một phiên, in thời gian đến khi nhận kết nối, rồi xóa
#   time2    : 5 lần, mỗi lần tạo hai phiên cùng lúc
#   capacity : tăng dần số phiên, mỗi phiên giữ khóa (B chờ A). Dừng khi RAM trống < 15%, OOM/chết, thời gian sẵn sàng > 2x lần đầu,
#              (IGNORE_TIME=1 bỏ điều kiện thời gian để thấy giới hạn RAM) hoặc (lưới an toàn) swap máy > SWAP_MAX_MB, RAM trống < 150 MiB trước khi mở phiên kế, đĩa hết chỗ.
set -uo pipefail
. "$(dirname "$0")/common.sh"
S="$HERE/session.sh"; MAX="${MAX:-8}"; HOLD="${HOLD:-1500}"; SWAP_MAX_MB="${SWAP_MAX_MB:-300}"
kb() { awk -v k="$1" '$1==k":"{print $2}' /proc/meminfo; }
cleanup() { for n in $(docker ps -a --filter label=sqllens.session --format '{{.Label "sqllens.session"}}' | grep '^b-'); do "$S" destroy "$n"; done; rm -rf "$SESS_ROOT"/b-*; jobs -p | xargs -r kill 2>/dev/null; }
trap cleanup EXIT
mem() { echo "RAM trống $(( $(kb MemAvailable)/1024 )) MiB, swap dùng $(( ($(kb SwapTotal)-$(kb SwapFree))/1024 )) MiB"; }

case "${1:-}" in
time1) for i in 1 2 3 4 5; do "$S" create b-1 | sed "s/^/lần $i: /"; "$S" destroy b-1; done ;;
time2) for i in 1 2 3 4 5; do
    ("$S" create b-1 | sed "s/^/lần $i: /") & ("$S" create b-2 | sed "s/^/lần $i: /") & wait
    "$S" destroy b-1; "$S" destroy b-2; done ;;
capacity)
  TOTAL=$(kb MemTotal); base=0
  echo "RAM máy $((TOTAL/1024)) MiB, ngưỡng 15% = $((TOTAL*15/100/1024)) MiB. $(mem)"
  echo "n | ready_ms | MemAvailable MiB (trước) | MemAvailable MiB (sau) | % | swap máy MiB | tổng RAM container MiB | đĩa trống MiB | ghi chú"
  for n in $(seq 1 "$MAX"); do
    before=$(( $(kb MemAvailable)/1024 )); note=ok
    [ "$before" -lt 150 ] && { echo "DỪNG trước n=$n: MemAvailable $before MiB < 150 MiB"; break; }
    out=$("$S" create "b-$n" 2>&1) || { echo "$n | tạo lỗi: $(echo "$out" | tail -1)"; break; }
    ready=$(sed -n 's/.*ready_ms=\([0-9]*\).*/\1/p' <<<"$out")
    "$S" exec "b-$n" --as root -e "CREATE DATABASE d; CREATE TABLE d.t (id INT PRIMARY KEY, k INT, v VARCHAR(40), KEY ik(k));
      SET SESSION cte_max_recursion_depth=10000;
      INSERT INTO d.t SELECT n, n%1000, MD5(n) FROM (WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n<10000) SELECT n FROM s) q;" >/dev/null || note="load lỗi"
    "$S" exec "b-$n" --as root -e "BEGIN; SELECT * FROM d.t WHERE id=1 FOR UPDATE; DO SLEEP($HOLD);" >/dev/null 2>&1 &
    sleep 1
    "$S" exec "b-$n" --as root -e "BEGIN; SELECT * FROM d.t WHERE id=2 FOR UPDATE; SELECT * FROM d.t WHERE id=1 FOR UPDATE;" >/dev/null 2>&1 &
    sleep 4
    w=$("$S" exec "b-$n" --as root -N -B -e "SELECT COUNT(*) FROM performance_schema.data_lock_waits" | tail -1); [ "$w" = 1 ] || note="$note; data_lock_waits=$w"
    sleep 3
    av=$(( $(kb MemAvailable)/1024 )); pct=$(( av*1024*100/TOTAL )); swap=$(( ($(kb SwapTotal)-$(kb SwapFree))/1024 ))
    sum=$(docker stats --no-stream --format '{{.MemUsage}}' | awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); sub(/[A-Za-z]+/,"",v); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; s+=v} END{printf "%.0f", s}')
    disk=$(df -Pm "$SESS_ROOT" | awk 'NR==2{print $4}')
    oom=$(docker ps -a --filter label=sqllens.session --format '{{.Names}}' | while read x; do docker inspect -f '{{.Name}} oom={{.State.OOMKilled}} run={{.State.Running}}' "$x"; done | grep -E 'oom=true|run=false' | tr '\n' ' ')
    [ -n "$oom" ] && note="$note; $oom"
    echo "$n | $ready | $before | $av | $pct% | $swap | $sum | $disk | $note"
    [ "$n" = 1 ] && base=$ready
    stop=""
    [ -n "$oom" ] && stop="OOM/chết"
    [ "$pct" -lt 15 ] && stop="RAM trống < 15%"
    [ -z "${IGNORE_TIME:-}" ] && [ "$base" -gt 0 ] && [ "$ready" -gt $((base*2)) ] && stop="${stop:+$stop, }thời gian sẵn sàng > 2x lần đầu"
    [ "$swap" -gt "$SWAP_MAX_MB" ] && stop="${stop:+$stop, }swap máy > ${SWAP_MAX_MB} MiB (lưới an toàn)"
    [ -n "$stop" ] && { echo "DỪNG ở n=$n: $stop"; break; }
  done ;;
*) echo "dùng: bench.sh time1|time2|capacity" >&2; exit 2 ;;
esac
