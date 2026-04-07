import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.proxynet-agent');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function getNodeId() {
  ensureDataDir();
  const file = join(DATA_DIR, 'node-id');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const id = randomBytes(8).toString('hex');
    writeFileSync(file, id);
    return id;
  }
}

function getDeviceId() {
  ensureDataDir();
  const file = join(DATA_DIR, 'device-id');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const id = randomBytes(8).toString('hex');
    writeFileSync(file, id);
    return id;
  }
}

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export function loadConfig() {
  return {
    nodeEnv: process.env.NODE_ENV || 'production',
    controlUrl: required('CONTROL_URL'),
    apiBaseUrl: required('API_BASE_URL'),
    nodeSecret: required('NODE_SECRET'),
    ownerId: process.env.OWNER_ID || 'system',
    region: process.env.REGION || 'unknown',
    proxyMode: process.env.PROXY_MODE || 'socks5',
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 25000,
    healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS, 10) || 30000,
    logLevel: process.env.LOG_LEVEL || 'info',
    httpPort: parseInt(process.env.HTTP_PORT, 10) || 9090,
    nodeId: getNodeId(),
    deviceId: getDeviceId(),
    dataDir: DATA_DIR,
  };
}
