const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS.info;
let nodeId = null;

export function initLogger(config) {
  currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;
  nodeId = config.nodeId;
}

function emit(level, event, data = {}) {
  if (LEVELS[level] > currentLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    nodeId,
    event,
    ...data,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  error: (event, data) => emit('error', event, data),
  warn: (event, data) => emit('warn', event, data),
  info: (event, data) => emit('info', event, data),
  debug: (event, data) => emit('debug', event, data),
};
