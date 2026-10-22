#!/bin/bash
set -euo pipefail

# Run as root from a private staging directory containing runtime/tunnel env files and units.
hostname=${1:?Usage: install-release.sh HOSTNAME SHA256_IMAGE_ID}
image_id=${2:?An immutable Docker image ID is required}
[[ "$hostname" =~ ^[a-z0-9.-]+$ ]] && [[ "$hostname" == *.* ]]
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
test -f /var/lib/scope-settle-bootstrap-complete
mountpoint -q /srv/scope-and-settle
test -s runtime.env
test -s scope-and-settle.service
test -s tunnel.env
test -s scope-and-settle-tunnel.service
docker image inspect "$image_id" >/dev/null
grep -Fxq 'PAYPAL_ENVIRONMENT=sandbox' runtime.env
grep -Fxq "PUBLIC_BASE_URL=https://$hostname" runtime.env

if systemctl is-active --quiet scope-and-settle; then
  docker exec scope-and-settle node scripts/backup-data.mjs
fi
install -m 0600 -o root -g root runtime.env /etc/scope-and-settle/runtime.env
printf 'IMAGE_ID=%s\n' "$image_id" > /etc/scope-and-settle/image.env
chmod 600 /etc/scope-and-settle/image.env
install -m 0644 scope-and-settle.service /etc/systemd/system/scope-and-settle.service
systemctl daemon-reload
systemctl enable scope-and-settle
systemctl restart scope-and-settle

for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/health | grep -Fq '"ok":true'; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8787/health | grep -Fq '"ok":true'

install -m 0600 -o root -g root tunnel.env /etc/scope-and-settle/tunnel.env
install -m 0644 scope-and-settle-tunnel.service /etc/systemd/system/scope-and-settle-tunnel.service
docker pull cloudflare/cloudflared@sha256:faa8e0a1475f137c910be6025f43c8e4092fdd35461b31e19fd1390657a1ff39
systemctl daemon-reload
systemctl enable scope-and-settle-tunnel
systemctl restart scope-and-settle-tunnel
echo "Installed $image_id for https://$hostname"
