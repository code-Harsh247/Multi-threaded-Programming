#!/usr/bin/env bash
# Sets up (or updates) the boating simulator on an Ubuntu VM.
# Usage:  bash setup.sh <site address>     e.g.  bash setup.sh 129-146-10-20.sslip.io
# Safe to run again: it only installs what is missing and then redeploys.
set -euo pipefail

SITE_ADDRESS="${1:?usage: setup.sh <site address, e.g. 129-146-10-20.sslip.io>}"
REPO="https://github.com/code-Harsh247/Multi-threaded-Programming.git"
DIR="$HOME/boating"

echo "== 1. Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 git
  sudo systemctl enable --now docker
fi
docker --version
docker compose version

echo "== 2. VM firewall (Oracle's Ubuntu images reject everything except SSH)"
open_port() {   # proto port
  if ! sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null; then
    local line
    line=$(sudo iptables -L INPUT --line-numbers | awk '$2 == "REJECT" {print $1; exit}')
    if [ -n "$line" ]; then
      sudo iptables -I INPUT "$line" -p "$1" --dport "$2" -j ACCEPT
    else
      sudo iptables -A INPUT -p "$1" --dport "$2" -j ACCEPT
    fi
  fi
}
open_port tcp 80
open_port tcp 443
open_port udp 443
if command -v netfilter-persistent >/dev/null; then
  sudo netfilter-persistent save
else
  echo "warning: netfilter-persistent not found; firewall rules will reset on reboot"
fi

echo "== 3. Code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi

echo "== 4. Start"
cd "$DIR/deploy"
echo "SITE_ADDRESS=$SITE_ADDRESS" > .env
sudo docker compose up -d --build
sudo docker compose ps

echo
echo "Deployed. Open https://$SITE_ADDRESS (the certificate can take a minute on first start)."
