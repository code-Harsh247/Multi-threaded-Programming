import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BIN = process.env.BOATING_BIN
  || path.join(REPO_ROOT, process.platform === 'win32' ? 'boating.exe' : 'boating');
export const CHECK_SCRIPT = path.join(REPO_ROOT, 'tests', 'check_events.py');

if (!fs.existsSync(BIN)) {
  throw new Error(`Engine not found at ${BIN}. Run "make" in the repo root first, or set BOATING_BIN.`);
}

// A run that finishes in well under a second.
export const FAST = { boats: 20, visitors: 20, msPerMin: 1, sightMin: 1, sightMax: 1, rideMin: 1, rideMax: 1 };
// A run that lasts several seconds (for abort, limit and timeout tests).
export const SLOW = { boats: 5, visitors: 20, msPerMin: 50 };

export const silentLog = { log() {}, warn() {}, error() {} };

export async function startServer(options = {}) {
  const app = createApp({ bin: BIN, log: silentLog, ...options });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve(s)));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => {
    app.locals.killAll();
    server.closeAllConnections();
    server.close(resolve);
  });
  return { app, url, close };
}

export function postRun(url, body, signal) {
  return fetch(`${url}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
}

export function parseLines(text) {
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

export async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A Python 3 that can run tests/check_events.py, or null.
export function findPython() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return cmd;
  }
  return null;
}
