import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { initLogger, log } from './lib/logger.js';
import { authenticate } from './control/auth.js';
import { ControlChannel } from './control/channel.js';
import { ProxyHandler } from './proxy/handler.js';
import { Metrics } from './metrics/index.js';
import { HealthChecker } from './metrics/health.js';
import { HealthServer } from './metrics/server.js';

const CAPACITY = 10;
let shutdownInProgress = false;
let assignedConsumers = 0;

async function main() {
  const config = loadConfig();
  initLogger(config);
  log.info('agent.starting', {
    nodeId: config.nodeId,
    region: config.region,
    version: '0.1.0',
  });

  // Modules
  const metrics = new Metrics();
  const healthChecker = new HealthChecker(config);
  const channel = new ControlChannel(config);
  const proxy = new ProxyHandler(channel, metrics);
  const httpServer = new HealthServer(config, metrics, healthChecker, channel);

  // Graceful shutdown
  const shutdown = async (signal) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    log.info('agent.shutdown', { signal });

    healthChecker.stop();
    channel.stopHeartbeat();
    await proxy.close();
    await channel.close();
    await httpServer.close();

    log.info('agent.stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start health checks and HTTP server
  healthChecker.start();
  httpServer.start();

  // Authenticate
  let auth;
  while (!shutdownInProgress) {
    try {
      auth = await authenticate(config);
      break;
    } catch (err) {
      log.error('auth.failed', { error: err.message });
      log.info('auth.retrying', { delayMs: 10000 });
      await sleep(10000);
    }
  }
  if (shutdownInProgress) return;

  // Connect WebSocket
  channel.on('authenticated', async () => {
    try {
      // Register and join aggregation layer
      await channel.registerPeer();
      await channel.joinAggregation(CAPACITY);

      // Start heartbeat — report consumer count as load, not tunnel count
      channel.startHeartbeat(() => ({
        activeSessions: assignedConsumers,
        capacity: CAPACITY,
        health: healthChecker.health,
      }));

      log.info('agent.ready', {
        nodeId: config.nodeId,
        peerId: channel.peerId,
        region: config.region,
      });
    } catch (err) {
      log.error('peer.setup_failed', { error: err.message });
    }
  });

  channel.on('session-incoming', (msg) => {
    assignedConsumers++;
    log.info('session.incoming', {
      sessionId: msg.session_id,
      consumerId: msg.consumer_user_id,
      assignedConsumers,
    });
  });

  await channel.connect(auth.token);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
