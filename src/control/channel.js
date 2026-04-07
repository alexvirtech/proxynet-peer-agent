import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { fetchJSON } from '../lib/api.js';
import { log } from '../lib/logger.js';

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const PING_INTERVAL_MS = 20000;

export class ControlChannel extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ws = null;
    this.token = null;
    this.deviceId = config.deviceId;
    this.peerId = null;
    this.authenticated = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.heartbeatTimer = null;
    this.closing = false;
    this.joined = false;
  }

  async connect(token) {
    this.token = token;
    this.closing = false;
    this._doConnect();
  }

  _doConnect() {
    if (this.closing) return;

    log.info('ws.connecting', { url: this.config.controlUrl });
    this.ws = new WebSocket(this.config.controlUrl);

    this.ws.on('open', () => {
      log.info('ws.connected');
      this.reconnectAttempt = 0;
      this._sendAuth();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch (e) {
        log.error('ws.parse_error', { error: e.message });
      }
    });

    this.ws.on('close', (code, reason) => {
      log.warn('ws.closed', { code, reason: reason?.toString() });
      this._cleanup();
      if (!this.closing) this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log.error('ws.error', { error: err.message });
    });
  }

  _sendAuth() {
    this.send({ type: 'auth', token: this.token, deviceId: this.deviceId });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'auth-ok':
        this.authenticated = true;
        log.info('ws.authenticated', { userId: msg.userId });
        this._startPing();
        this.emit('authenticated');
        break;

      case 'error':
        log.error('ws.server_error', { code: msg.code, message: msg.message });
        if (msg.code === 'AUTH_FAILED' || msg.code === 'AUTH_TIMEOUT') {
          this.emit('auth-failed', msg);
        }
        break;

      case 'pong':
        break;

      case 'peer-join-ok':
        this.joined = true;
        this.peerId = msg.peerId;
        log.info('peer.joined', { state: msg.state, score: msg.score, peerId: msg.peerId });
        this.emit('joined', msg);
        break;

      case 'peer-join-failed':
        log.error('peer.join_failed', { reason: msg.reason });
        this.emit('join-failed', msg);
        break;

      case 'peer-heartbeat-ack':
        log.debug('peer.heartbeat_ack', { score: msg.score, state: msg.state });
        this.emit('heartbeat-ack', msg);
        break;

      case 'peer-pause-ok':
      case 'peer-resume-ok':
      case 'peer-leave-ok':
        this.emit('lifecycle', msg);
        break;

      case 'session-incoming':
        this.emit('session-incoming', msg);
        break;

      // Proxy messages
      case 'proxy-request':
      case 'proxy-connect':
      case 'tunnel-data':
      case 'tunnel-end':
        this.emit(msg.type, msg);
        break;

      default:
        log.debug('ws.unknown_message', { type: msg.type });
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  async registerPeer() {
    const res = await fetchJSON('POST', `${this.config.apiBaseUrl}/api/peers/register`, {
      country: this.config.region.toUpperCase().slice(0, 2),
      bandwidth_available_mbps: 100,
      max_connections: 10,
    }, this.token);
    const data = res.data || res;
    this.peerId = data.peerId;
    log.info('peer.registered', { peerId: this.peerId });
    return data;
  }

  joinAggregation(capacity = 10) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeAllListeners('joined');
        this.removeAllListeners('join-failed');
        log.warn('peer.join_timeout', { msg: 'Falling back to legacy register' });
        this.registerPeer().then(resolve).catch(reject);
      }, 5000);

      this.once('joined', (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });

      this.once('join-failed', (msg) => {
        clearTimeout(timeout);
        log.warn('peer.join_failed_fallback');
        this.registerPeer().then(resolve).catch(reject);
      });

      this.send({
        type: 'peer-join',
        capacity,
        region: this.config.region,
        bandwidth_mbps: 100,
        peerId: this.peerId,
      });
    });
  }

  startHeartbeat(getStats) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const stats = getStats();
      this.send({
        type: 'peer-heartbeat',
        load: stats.activeSessions,
        capacity: stats.capacity,
        health: stats.health,
        bandwidth_mbps: 100,
        region: this.config.region,
      });
    }, this.config.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _cleanup() {
    this.authenticated = false;
    this.joined = false;
    this._stopPing();
    this.stopHeartbeat();
  }

  _scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;
    log.info('ws.reconnecting', { attempt: this.reconnectAttempt, delayMs: delay });
    this.reconnectTimer = setTimeout(() => this._doConnect(), delay);
  }

  async close() {
    this.closing = true;
    this._cleanup();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.joined) {
      this.send({ type: 'peer-leave' });
      await new Promise((r) => setTimeout(r, 500));
    }

    if (this.ws) {
      this.ws.close(1000, 'shutdown');
      this.ws = null;
    }
  }
}
