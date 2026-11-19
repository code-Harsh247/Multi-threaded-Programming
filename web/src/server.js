import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultEngine() {
  return path.join(REPO_ROOT, process.platform === 'win32' ? 'boating.exe' : 'boating');
}

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} must be a positive whole number, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

// Express accepts a hop count, true, or a list of trusted addresses.
function trustProxyFromEnv() {
  const raw = process.env.TRUST_PROXY;
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const bin = process.env.BOATING_BIN || defaultEngine();
if (!fs.existsSync(bin)) {
  console.error(`Simulation engine not found at ${bin}. Run "make" in the repo root, or set BOATING_BIN.`);
  process.exit(1);
}

const app = createApp({
  bin,
  maxConcurrent: intFromEnv('MAX_CONCURRENT_RUNS', 4),
  maxPerIp: intFromEnv('MAX_RUNS_PER_IP', 1),
  runsPerMinute: intFromEnv('RUNS_PER_MINUTE_PER_IP', 20),
  maxRunSeconds: intFromEnv('MAX_RUN_SECONDS', 180),
  trustProxy: trustProxyFromEnv(),
});

const port = intFromEnv('PORT', 3000);
const server = app.listen(port, (err) => {
  if (err) {
    console.error(`Could not listen on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Boating simulator on http://localhost:${port} (engine: ${bin})`);
});

// On shutdown, stop every running simulation before exiting.
function shutdown(signal) {
  console.log(`${signal} received, stopping ${app.locals.activeRuns()} run(s)`);
  app.locals.killAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
