import { log } from '../lib/logger.js';

export class Metrics {
  constructor() {
    this.sessions = new Map();
    this.totals = {
      requestsHandled: 0,
      tunnelsOpened: 0,
      bytesIn: 0,
      bytesOut: 0,
      errors: 0,
    };
    this.activeSessions = 0;
  }

  requestStart(sessionId) {
    this.sessions.set(sessionId, { type: 'request', startedAt: Date.now(), bytesIn: 0, bytesOut: 0 });
    this.activeSessions++;
    this.totals.requestsHandled++;
  }

  requestEnd(sessionId, bytesOut, error = false) {
    const s = this.sessions.get(sessionId);
    if (s) {
      this.totals.bytesOut += bytesOut;
      this.sessions.delete(sessionId);
    }
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    if (error) this.totals.errors++;
  }

  tunnelStart(tunnelId) {
    this.sessions.set(`tun-${tunnelId}`, { type: 'tunnel', startedAt: Date.now(), bytesIn: 0, bytesOut: 0 });
    this.activeSessions++;
    this.totals.tunnelsOpened++;
  }

  tunnelData(tunnelId, bytes, direction) {
    const key = `tun-${tunnelId}`;
    const s = this.sessions.get(key);
    if (s) {
      if (direction === 'in') { s.bytesIn += bytes; this.totals.bytesIn += bytes; }
      else { s.bytesOut += bytes; this.totals.bytesOut += bytes; }
    }
  }

  tunnelEnd(tunnelId, error = false) {
    const key = `tun-${tunnelId}`;
    this.sessions.delete(key);
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    if (error) this.totals.errors++;
  }

  getSnapshot() {
    return {
      activeSessions: this.activeSessions,
      ...this.totals,
      uptimeMs: process.uptime() * 1000,
    };
  }
}
