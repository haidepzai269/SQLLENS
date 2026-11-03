#!/usr/bin/env bash
# Một phiên MySQL từ bản mẫu. Chạy: sudo ./session.sh create|destroy|exec|path TÊN ...
#   create TÊN [tham số mysqld...] : sao chép bản mẫu, đặt mật khẩu root ngẫu nhiên, chạy container, chờ nhận kết nối
#   destroy TÊN                    : xóa container và thư mục dữ liệu (chạy lại không lỗi)
#   exec TÊN [tham số mysql...]    : chạy client mysql với root, mật khẩu đi qua stdin
# NET=loopback PORT=n : chỉ dùng để thử bằng client ngoài container (AC4): bind 127.0.0.1:n và thêm root@'%'. Mặc định --network none.
set -euo pipefail
. "$(dirname "$0")/common.sh"
cmd="${1:-}"; name="${2:-}"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || { echo "tên phiên phải khớp ^[a-z0-9][a-z0-9-]{0,30}\$" >&2; exit 2; }
C="sqllens-mysql-$name"; D="$SESS_ROOT/$name"
shift 2 || true

destroy() { docker rm -fv "$C" >/dev/null 2>&1 || true; rm -rf "${D:?}"; }
cli() { # mật khẩu qua stdin vào --defaults-extra-file, không qua biến môi trường hay dòng lệnh
  printf '[client]\npassword=%s\n' "$(cat "$D/pw")" | docker exec -i "$C" mysql --defaults-extra-file=/dev/stdin -uroot "$@"
}

case "$cmd" in
destroy) destroy ;;
path) echo "$D" ;;
exec) [ -f "$D/pw" ] || { echo "không có phiên $name" >&2; exit 1; }; cli "$@" ;;
create)
  t0=$(now_ms)
  [ ! -e "$D" ] && ! docker inspect "$C" >/dev/null 2>&1 || { echo "phiên $name đã tồn tại" >&2; exit 2; }
  "$HERE/seed.sh" verify >/dev/null   # bản mẫu bị sửa thì không tạo phiên
  seed_mb=$(du -sm "$SEED_ROOT/data" | cut -f1)
  mkdir -p "$SESS_ROOT"; chmod 711 "$SESS_ROOT"
  avail_mb=$(df -Pm "$SESS_ROOT" | awk 'NR==2{print $4}')
  [ "$avail_mb" -ge $(( seed_mb * 2 + 1024 )) ] || { echo "đĩa còn $avail_mb MiB, cần ít nhất $(( seed_mb * 2 + 1024 )) MiB" >&2; exit 3; }
  trap 'destroy' ERR; trap 'destroy; exit 1' INT TERM
  # uid riêng cho mỗi phiên: phiên khác không đọc được thư mục này kể cả khi lộ đường dẫn
  uid=$(( 20000 + $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 40000 ))
  mkdir -m 700 "$D"
  cp -a "$SEED_ROOT/data" "$D/data"; chown -R "$uid:$uid" "$D/data"; chmod 700 "$D/data"
  pw=$(head -c 24 /dev/urandom | base64 | tr -d '+/=\n')
  (umask 077; printf '%s' "$pw" > "$D/pw")
  (umask 077; printf "ALTER USER 'root'@'localhost' IDENTIFIED BY '%s';\n" "$pw" > "$D/init.sql")
  net=(--network none)
  if [ "${NET:-}" = loopback ]; then
    net=(-p "127.0.0.1:${PORT:?cần PORT}:3306")
    printf "CREATE USER 'root'@'%%' IDENTIFIED BY '%s';\nGRANT ALL ON *.* TO 'root'@'%%' WITH GRANT OPTION;\n" "$pw" >> "$D/init.sql"
  fi
  chown "$uid:$uid" "$D/init.sql"
  t1=$(now_ms)
  docker run -d --name "$C" --label sqllens.session="$name" --entrypoint mysqld --user "$uid:$uid" \
    --memory "${MEM:-384m}" --memory-swap "${MEM:-384m}" --cpus 1 --pids-limit 200 "${net[@]}" \
    --read-only --tmpfs /tmp --tmpfs "/run/mysqld:rw,mode=0700,uid=$uid,gid=$uid" --security-opt no-new-privileges --cap-drop ALL \
    -v "$D/data:/var/lib/mysql" -v "$D/init.sql:/init.sql:ro" "$IMAGE" \
    --datadir=/var/lib/mysql --init-file=/init.sql "${CNF[@]}" "$@" >/dev/null
  ready=""
  for _ in $(seq 1 900); do   # tối đa 180 giây
    [ "$(docker inspect -f '{{.State.Running}}' "$C")" = true ] || { echo "container chết lúc khởi động" >&2; false; }
    if [ "$(cli -N -B -e 'SELECT @@skip_networking' 2>/dev/null | tail -1)" = 0 ]; then ready=$(( $(now_ms) - t0 )); break; fi
    sleep 0.2
  done
  [ -n "$ready" ] || { echo "quá 180 giây chưa nhận kết nối" >&2; false; }
  rm -f "$D/init.sql"   # đã chạy xong, không để mật khẩu nằm lại ở chỗ thứ hai
  trap - ERR INT TERM
  echo "READY $name ready_ms=$ready prep_ms=$(( t1 - t0 )) uid=$uid" ;;
*) echo "dùng: session.sh create|destroy|exec|path TÊN" >&2; exit 2 ;;
esac
