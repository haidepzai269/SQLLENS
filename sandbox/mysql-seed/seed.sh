#!/usr/bin/env bash
# Dựng và kiểm bản mẫu dữ liệu MySQL. Chạy: sudo ./seed.sh build|verify
#   build  : khởi tạo thư mục dữ liệu mysql:8.4.13 một lần (root để trống, chỉ nghe socket trong container không mạng).
#            Chạy lại khi bản mẫu còn đúng thì không làm gì; REBUILD=1 để dựng lại.
#   verify : so SHA256 mọi file với SHA256SUMS lúc dựng, phát hiện file bị sửa, thêm hoặc mất.
set -euo pipefail
. "$(dirname "$0")/common.sh"
DATA="$SEED_ROOT/data"; SUMS="$SEED_ROOT/SHA256SUMS"

sums() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }
verify() { [ -d "$DATA" ] && [ -f "$SUMS" ] && sums "$DATA" 2>/dev/null | diff -q - "$SUMS" >/dev/null 2>&1; }

case "${1:-}" in
verify) verify && echo "bản mẫu đúng" || { echo "bản mẫu thiếu hoặc bị sửa" >&2; exit 1; } ;;
build)
  if [ "${REBUILD:-0}" != 1 ] && verify && [ "$(cat "$SEED_ROOT/IMAGE" 2>/dev/null)" = "$IMAGE" ]; then echo "bản mẫu đã có, bỏ qua"; exit 0; fi
  mkdir -p "$SEED_ROOT"; chmod 755 "$SEED_ROOT"
  NEW="$SEED_ROOT/data.new"; rm -rf "$NEW"; mkdir "$NEW"; chown 999:999 "$NEW"
  trap 'rm -rf "$NEW"' EXIT
  # --initialize-insecure: root@localhost không mật khẩu, chỉ vào được bằng socket trong container. Mỗi phiên đặt mật khẩu riêng lúc khởi động.
  docker run --rm --entrypoint mysqld --user 999:999 --network none --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges --memory 512m --memory-swap 512m -v "$NEW:/var/lib/mysql" "$IMAGE" \
    --initialize-insecure --datadir=/var/lib/mysql "${CNF[@]}"
  rm -f "$NEW/auto.cnf"   # mỗi phiên tự sinh server_uuid
  chown -R root:root "$NEW"; chmod -R go-w "$NEW"
  sums "$NEW" > "$SEED_ROOT/SHA256SUMS.new"
  rm -rf "$DATA"; mv "$NEW" "$DATA"; mv "$SEED_ROOT/SHA256SUMS.new" "$SUMS"; echo "$IMAGE" > "$SEED_ROOT/IMAGE"
  echo "đã dựng bản mẫu: $(du -sm "$DATA" | cut -f1) MiB, $(wc -l < "$SUMS") file" ;;
*) echo "dùng: seed.sh build|verify" >&2; exit 2 ;;
esac
