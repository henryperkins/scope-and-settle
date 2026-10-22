#!/bin/bash
set -euo pipefail

# A dedicated, newly provisioned Debian 12 VM and data disk only.
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io ca-certificates curl
systemctl enable --now docker

device=/dev/disk/by-id/google-scope-settle-data
for attempt in {1..60}; do
  [ -b "$device" ] && break
  sleep 2
done
test -b "$device"
filesystem=$(blkid -o value -s TYPE "$device" || true)
if [ -z "$filesystem" ]; then
  # Refuse to overwrite a disk with partition/signature information.
  test -z "$(wipefs --noheadings --output TYPE "$device")"
  mkfs.ext4 -m 0 -L scope-settle-data "$device"
elif [ "$filesystem" != ext4 ]; then
  echo "Unexpected data filesystem; refusing to modify it" >&2
  exit 1
fi
mkdir -p /srv/scope-and-settle
uuid=$(blkid -o value -s UUID "$device")
if ! grep -Fq "UUID=$uuid " /etc/fstab; then
  printf 'UUID=%s /srv/scope-and-settle ext4 defaults 0 2\n' "$uuid" >> /etc/fstab
fi
mountpoint -q /srv/scope-and-settle || mount /srv/scope-and-settle
install -d -o 1000 -g 1000 -m 0700 /srv/scope-and-settle/data
install -d -o root -g root -m 0700 /etc/scope-and-settle

# Small burst allowance; steady-state app memory remains capped by the unit.
if [ ! -e /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -Fxq /swapfile || swapon /swapfile
grep -Fq '/swapfile none swap sw 0 0' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab

touch /var/lib/scope-settle-bootstrap-complete
echo 'Scope & Settle bootstrap complete'
