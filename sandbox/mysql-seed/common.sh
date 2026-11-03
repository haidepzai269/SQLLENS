# Dùng chung cho seed.sh, session.sh, bench.sh. Chạy trên Linux với quyền root (sudo).
IMAGE="${IMAGE:-mysql:8.4.13}"
SEED_ROOT="${SEED_ROOT:-/var/lib/sqllens/mysql-seed}"
SESS_ROOT="${SESS_ROOT:-/var/lib/sqllens/sessions}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "cần chạy bằng root (sudo)" >&2; exit 1; }
# my.cnf thành tham số mysqld: file mount có thể bị mysqld bỏ qua vì quyền, tham số thì không (Task015)
mapfile -t CNF < <(tr -d '\r' < "$HERE/my.cnf" | grep -vE '^[[:space:]]*(#|\[|$)' | sed 's/^/--/')
[ "${#CNF[@]}" -gt 10 ] || { echo "my.cnf không đọc được" >&2; exit 1; }
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
