#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/proxynet-peer-agent"
APP_USER="proxynet"

echo "=== ProxyNet Peer Agent — Install ==="

# Install Node.js 22 if missing
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "Node.js: $(node -v)"

# Create app user
if ! id "$APP_USER" &>/dev/null; then
  echo "Creating user $APP_USER..."
  useradd -r -m -s /bin/false "$APP_USER"
fi

# Create data dir
mkdir -p /home/$APP_USER/.proxynet-agent
chown $APP_USER:$APP_USER /home/$APP_USER/.proxynet-agent

# Deploy app
echo "Deploying to $APP_DIR..."
mkdir -p "$APP_DIR"
cp -r src package.json "$APP_DIR/"

cd "$APP_DIR"
npm install --production

# Copy .env if not present
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f /tmp/proxynet-peer-agent.env ]; then
    cp /tmp/proxynet-peer-agent.env "$APP_DIR/.env"
  else
    echo "WARNING: No .env file found. Copy .env.example and configure it."
    cp "$(dirname "$0")/../.env.example" "$APP_DIR/.env" 2>/dev/null || true
  fi
fi

chown -R $APP_USER:$APP_USER "$APP_DIR"

# Install systemd service
echo "Installing systemd service..."
cp systemd/proxynet-peer-agent.service /etc/systemd/system/ 2>/dev/null || \
  cp "$(dirname "$0")/../systemd/proxynet-peer-agent.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable proxynet-peer-agent

echo ""
echo "=== Install complete ==="
echo "1. Edit $APP_DIR/.env with your configuration"
echo "2. Start: systemctl start proxynet-peer-agent"
echo "3. Logs:  journalctl -u proxynet-peer-agent -f"
