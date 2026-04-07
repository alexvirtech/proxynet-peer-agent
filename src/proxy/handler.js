import http from 'http';
import https from 'https';
import net from 'net';
import { log } from '../lib/logger.js';

export class ProxyHandler {
  constructor(channel, metrics) {
    this.channel = channel;
    this.metrics = metrics;
    this.tunnels = new Map(); // id -> net.Socket

    channel.on('proxy-request', (msg) => this._handleRequest(msg));
    channel.on('proxy-connect', (msg) => this._handleConnect(msg));
    channel.on('tunnel-data', (msg) => this._handleTunnelData(msg));
    channel.on('tunnel-end', (msg) => this._handleTunnelEnd(msg));
  }

  async _handleRequest(msg) {
    const { id, fromUserId, method, url, headers, body } = msg;
    const sessionId = `req-${id}`;
    log.debug('proxy.request', { id, method, url: url?.slice(0, 80) });

    this.metrics.requestStart(sessionId);

    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const reqHeaders = { ...headers };
      delete reqHeaders['host'];
      delete reqHeaders['proxy-connection'];

      const proxyReq = mod.request(parsed, { method, headers: reqHeaders }, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const bodyBuf = Buffer.concat(chunks);
          this.metrics.requestEnd(sessionId, bodyBuf.length);

          const resHeaders = {};
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            resHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
          }

          this.channel.send({
            type: 'proxy-response',
            id,
            toUserId: fromUserId,
            status: proxyRes.statusCode,
            statusText: proxyRes.statusMessage,
            headers: resHeaders,
            bodyBase64: bodyBuf.toString('base64'),
          });
        });
      });

      proxyReq.on('error', (err) => {
        log.error('proxy.request_error', { id, error: err.message });
        this.metrics.requestEnd(sessionId, 0, true);
        this.channel.send({
          type: 'proxy-response',
          id,
          toUserId: fromUserId,
          status: 502,
          statusText: 'Bad Gateway',
          headers: {},
          bodyBase64: Buffer.from(err.message).toString('base64'),
        });
      });

      proxyReq.setTimeout(30000, () => {
        proxyReq.destroy();
      });

      if (body) proxyReq.write(body);
      proxyReq.end();
    } catch (err) {
      log.error('proxy.request_exception', { id, error: err.message });
      this.metrics.requestEnd(sessionId, 0, true);
      this.channel.send({
        type: 'proxy-response',
        id,
        toUserId: fromUserId,
        status: 500,
        statusText: 'Internal Error',
        headers: {},
        bodyBase64: Buffer.from(err.message).toString('base64'),
      });
    }
  }

  _handleConnect(msg) {
    const { id, fromUserId, host, port } = msg;
    log.debug('proxy.connect', { id, host, port });

    this.metrics.tunnelStart(id);

    const socket = net.createConnection({ host, port: parseInt(port, 10) }, () => {
      log.debug('proxy.connect_ok', { id, host, port });
      this.tunnels.set(id, socket);

      this.channel.send({
        type: 'proxy-connect-ok',
        id,
        toUserId: fromUserId,
      });
    });

    socket.on('data', (chunk) => {
      this.metrics.tunnelData(id, chunk.length, 'out');
      this.channel.send({
        type: 'tunnel-data',
        id,
        toUserId: fromUserId,
        data: chunk.toString('base64'),
      });
    });

    socket.on('end', () => {
      this._closeTunnel(id, fromUserId);
    });

    socket.on('close', () => {
      this._closeTunnel(id, fromUserId);
    });

    socket.on('error', (err) => {
      log.error('proxy.tunnel_error', { id, error: err.message });
      if (!this.tunnels.has(id)) {
        // Connection failed before established
        this.channel.send({
          type: 'proxy-connect-failed',
          id,
          toUserId: fromUserId,
          error: err.message,
        });
        this.metrics.tunnelEnd(id, true);
      } else {
        this._closeTunnel(id, fromUserId);
      }
    });

    socket.setTimeout(60000, () => {
      log.warn('proxy.tunnel_timeout', { id });
      socket.destroy();
    });
  }

  _handleTunnelData(msg) {
    const { id, data } = msg;
    const socket = this.tunnels.get(id);
    if (socket && !socket.destroyed) {
      const buf = Buffer.from(data, 'base64');
      this.metrics.tunnelData(id, buf.length, 'in');
      socket.write(buf);
    }
  }

  _handleTunnelEnd(msg) {
    const { id } = msg;
    const socket = this.tunnels.get(id);
    if (socket) {
      socket.end();
      this.tunnels.delete(id);
      this.metrics.tunnelEnd(id);
    }
  }

  _closeTunnel(id, toUserId) {
    if (!this.tunnels.has(id)) return;
    this.tunnels.delete(id);
    this.metrics.tunnelEnd(id);
    this.channel.send({ type: 'tunnel-end', id, toUserId });
  }

  get activeTunnels() {
    return this.tunnels.size;
  }

  async close() {
    for (const [id, socket] of this.tunnels) {
      socket.destroy();
    }
    this.tunnels.clear();
  }
}
