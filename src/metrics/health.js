import dns from 'dns/promises';
import https from 'https';
import { log } from '../lib/logger.js';

export class HealthChecker {
  constructor(config) {
    this.config = config;
    this.lastResult = { score: 1.0, dns: true, http: true, latencyMs: 0 };
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.check(), this.config.healthCheckIntervalMs);
    this.check();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async check() {
    let dnsOk = true;
    let httpOk = true;
    let latencyMs = 0;

    // DNS check
    try {
      await dns.resolve4('google.com');
    } catch {
      dnsOk = false;
    }

    // HTTP check + latency
    try {
      const start = Date.now();
      await this._httpPing('https://www.google.com/generate_204');
      latencyMs = Date.now() - start;
    } catch {
      httpOk = false;
    }

    // Compute health score (0.0 - 1.0)
    let score = 1.0;
    if (!dnsOk) score -= 0.4;
    if (!httpOk) score -= 0.4;
    if (latencyMs > 2000) score -= 0.2;
    else if (latencyMs > 1000) score -= 0.1;
    score = Math.max(0, Math.min(1, score));

    this.lastResult = { score, dns: dnsOk, http: httpOk, latencyMs };
    log.debug('health.check', this.lastResult);
    return this.lastResult;
  }

  _httpPing(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 5000 }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  get health() {
    return this.lastResult.score;
  }
}
