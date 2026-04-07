import http from 'http';
import { log } from '../lib/logger.js';

export class HealthServer {
  constructor(config, metrics, healthChecker, channel) {
    this.config = config;
    this.metrics = metrics;
    this.healthChecker = healthChecker;
    this.channel = channel;
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        const health = this.healthChecker.lastResult;
        const ok = health.dns && health.http;
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: ok ? 'ok' : 'degraded',
          ...health,
          nodeId: this.config.nodeId,
          region: this.config.region,
        }));
      } else if (req.url === '/readyz') {
        const ready = this.channel.authenticated && this.channel.joined;
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: ready ? 'ready' : 'not_ready',
          authenticated: this.channel.authenticated,
          joined: this.channel.joined,
        }));
      } else if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.metrics.getSnapshot()));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.config.httpPort, '0.0.0.0', () => {
      log.info('http.listening', { port: this.config.httpPort });
    });
  }

  async close() {
    return new Promise((resolve) => {
      if (this.server) this.server.close(resolve);
      else resolve();
    });
  }
}
