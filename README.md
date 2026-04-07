# ProxyNet Peer Agent

Headless Linux peer agent for the ProxyNet P2P proxy network. Runs on cloud instances (Hetzner) as a system-owned provider node.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your configuration
npm install
npm start
```

## Configuration

All config via environment variables (`.env` file):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTROL_URL` | Yes | — | WebSocket URL for server |
| `API_BASE_URL` | Yes | — | HTTP API base URL |
| `NODE_SECRET` | Yes | — | Wallet password for auth |
| `OWNER_ID` | No | `system` | Owner identifier |
| `REGION` | No | `unknown` | Region code (e.g., `eu-central`) |
| `HEARTBEAT_INTERVAL_MS` | No | `25000` | Heartbeat frequency |
| `LOG_LEVEL` | No | `info` | `error`, `warn`, `info`, `debug` |
| `HTTP_PORT` | No | `9090` | Health/metrics HTTP port |

## Endpoints

- `GET /healthz` — Health check (DNS, HTTP, latency)
- `GET /readyz` — Readiness (authenticated + joined)
- `GET /metrics` — Traffic stats

## Deployment

### systemd

```bash
sudo bash scripts/install.sh
sudo systemctl start proxynet-peer-agent
journalctl -u proxynet-peer-agent -f
```

### Docker

```bash
docker build -t proxynet-peer-agent .
docker run -d --env-file .env -p 9090:9090 proxynet-peer-agent
```

### Cloud-init (Hetzner)

Use `deploy/cloud-init.yaml` as user-data when creating instances.

## Architecture

```
src/
  index.js          — Main orchestrator
  config/           — Config loader (.env)
  control/
    auth.js         — Wallet auth (challenge-response)
    channel.js      — WebSocket control channel + heartbeat
  proxy/
    handler.js      — HTTP relay + HTTPS CONNECT tunnels
  metrics/
    index.js        — Traffic accounting
    health.js       — DNS/HTTP/latency health checks
    server.js       — /healthz, /readyz, /metrics HTTP server
  lib/
    api.js          — HTTP client helper
    logger.js       — JSON structured logging
```
