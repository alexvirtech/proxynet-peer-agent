#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/proxynet-peer-agent"

echo "=== ProxyNet Peer Agent — Upgrade ==="

echo "Stopping service..."
systemctl stop proxynet-peer-agent || true

echo "Updating files..."
cp -r src package.json "$APP_DIR/"

cd "$APP_DIR"
npm install --production

chown -R proxynet:proxynet "$APP_DIR"

echo "Starting service..."
systemctl start proxynet-peer-agent

echo "=== Upgrade complete ==="
echo "Logs: journalctl -u proxynet-peer-agent -f"
