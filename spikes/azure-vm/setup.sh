#!/usr/bin/env bash
# Khóa chặt máy Azure sandbox (Ubuntu 24.04). Chạy lại nhiều lần không hỏng.
# Chạy trên máy: sudo bash setup.sh   (hoặc: ssh -i "$KEY" azureuser@"$IP" 'sudo bash -s' < setup.sh)
# Không lưu IP, khóa hay mật khẩu ở đây.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "cần chạy bằng root (sudo)" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# </dev/null: script đi qua stdin của ssh, apt không được ăn phần còn lại
apt-get update -qq </dev/null
apt-get -y -qq upgrade </dev/null
# docker.io của Ubuntu: đủ cho sandbox, ít phần phải tin hơn thêm kho ngoài
apt-get -y -qq install docker.io ufw </dev/null
systemctl enable --now docker >/dev/null

# Swap 1G: máy chỉ 1 GB RAM, không swap thì một lần đo quá tay làm treo cả máy (OOM kill sshd).
# Container vẫn đặt --memory-swap bằng --memory nên không dùng swap; đây chỉ là lưới an toàn cho máy chủ.
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  [ -f /swapfile ] || { fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

# SSH: tắt mật khẩu và root. Tên 00- để thắng 60-cloudimg-settings.conf (sshd lấy giá trị đầu tiên).
cat > /etc/ssh/sshd_config.d/00-sqllens.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
CONF
sshd -t   # cấu hình hỏng thì dừng ở đây, chưa reload
systemctl reload ssh

# Tường lửa: cho 22 TRƯỚC khi bật, tránh tự khóa.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null

# Kiểm lại trạng thái cuối
sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '
ufw status verbose | sed -n 1,6p
swapon --show
docker --version
