#!/usr/bin/env bash
# Sets up (or updates) the boating simulator on an Ubuntu VM that can host
# several projects behind one shared Caddy proxy.
#
# Usage:  bash setup.sh <site address>
#   e.g.  bash setup.sh boats.129-146-10-20.sslip.io
#
# Layout it creates:
#   ~/proxy/          shared Caddy (ports 80/443, HTTPS certificates)
#   ~/proxy/sites/    one *.caddy file per project
#   ~/apps/boating/   this repo, running as its own Docker Compose stack
# All stacks share the Docker network "web". Safe to run again: it only
# installs what is missing and then redeploys the simulator.
set -euo pipefail

SITE_ADDRESS="${1:?usage: setup.sh <site address, e.g. boats.129-146-10-20.sslip.io>}"
REPO="https://github.com/code-Harsh247/Multi-threaded-Programming.git"
APP_DIR="$HOME/apps/boating"
PROXY_DIR="$HOME/proxy"

echo "== 1. Docker"
if ! command -v docker >/dev/null || ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 git
  sudo systemctl enable --now docker
fi
sudo docker --version
sudo docker compose version

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

echo "== 3. Shared Docker network"
sudo docker network inspect web >/dev/null 2>&1 || sudo docker network create web

echo "== 4. Simulator code"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi

echo "== 5. Shared proxy"
if [ ! -d "$PROXY_DIR" ]; then
  # First time only: after this, ~/proxy belongs to the VM, not to this repo.
  mkdir -p "$PROXY_DIR/sites"
  cp "$APP_DIR/deploy/proxy/compose.yaml" "$APP_DIR/deploy/proxy/Caddyfile" "$PROXY_DIR/"
fi
sed "s|^SITE_ADDRESS {|$SITE_ADDRESS {|" "$APP_DIR/deploy/boating.caddy" > "$PROXY_DIR/sites/boating.caddy"

echo "== 6. Start the simulator, then the proxy"
(cd "$APP_DIR/deploy" && sudo docker compose up -d --build)
(cd "$PROXY_DIR" && sudo docker compose up -d)
# Pick up the site file even if Caddy was already running.
(cd "$PROXY_DIR" && sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile)

sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
echo "Deployed. Open https://$SITE_ADDRESS (the certificate can take a minute on first start)."
