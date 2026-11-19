import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, estimateSeconds, toArgs, limitsForClient } from './limits.js';
import { startRun } from './runner.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(SRC_DIR, '..', 'public');
// limits.js has no Node-only code, so the browser imports the very same file
// for its form validation and run-time estimate.
const LIMITS_FILE = path.join(SRC_DIR, 'limits.js');

const DEFAULTS = {
  maxConcurrent: 4,       // simulations running at once, server-wide
  maxPerIp: 1,            // simulations running at once, per visitor
  runsPerMinute: 20,      // simulations started per minute, per visitor
  maxRunSeconds: 180,     // reject runs whose worst case is longer
  timeoutSlackMs: 10000,  // kill a run this long after its worst-case estimate
  timeoutMs: null,        // fixed per-run timeout instead (used by tests)
  trustProxy: false,      // Express "trust proxy" setting
  log: console,
};

export function createApp(options) {
  const o = { ...DEFAULTS, ...options };
  if (!o.bin) throw new Error('createApp: `bin` (path to the boating engine) is required');

  const app = express();
  app.disable('x-powered-by');
  if (o.trustProxy) app.set('trust proxy', o.trustProxy);

  const active = new Set();      // run handles
  const activeByIp = new Map();  // ip -> number of running simulations
  const windows = new Map();     // ip -> { start, count } for the per-minute limit

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  app.get('/api/limits', (req, res) => res.json(limitsForClient(o.maxRunSeconds)));

  app.get('/js/limits.js', (req, res) => res.type('text/javascript').sendFile(LIMITS_FILE));

  app.post('/api/run', express.json({ limit: '2kb' }), (req, res) => {
    const v = validate(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const estimate = estimateSeconds(v.settings);
    if (estimate > o.maxRunSeconds) {
      return res.status(400).json({
        error: `This run could take up to ${Math.ceil(estimate)} s, and the limit is ${o.maxRunSeconds} s. ` +
               'Lower msPerMin, or use fewer visitors or shorter rides.',
        estimateSeconds: Math.ceil(estimate),
      });
    }

    const ip = req.ip;
    const now = Date.now();
    if (windows.size > 1000) {
      for (const [key, w] of windows) if (now - w.start >= 60000) windows.delete(key);
    }
    let w = windows.get(ip);
    if (!w || now - w.start >= 60000) {
      w = { start: now, count: 0 };
      windows.set(ip, w);
    }
    if (w.count >= o.runsPerMinute) {
      res.set('Retry-After', String(Math.ceil((w.start + 60000 - now) / 1000)));
      return res.status(429).json({ error: 'Too many runs started. Wait a minute and try again.' });
    }
    if ((activeByIp.get(ip) ?? 0) >= o.maxPerIp) {
      return res.status(429).json({ error: 'You already have a simulation running.' });
    }
    if (active.size >= o.maxConcurrent) {
      res.set('Retry-After', '10');
      return res.status(503).json({ error: 'The server is busy. Try again in a few seconds.' });
    }

    w.count++;
    activeByIp.set(ip, (activeByIp.get(ip) ?? 0) + 1);

    res.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const run = startRun({
      bin: o.bin,
      args: toArgs(v.settings),
      res,
      timeoutMs: o.timeoutMs ?? Math.ceil(estimate * 1000) + o.timeoutSlackMs,
      log: o.log,
      onEnd: () => {
        active.delete(run);
        const left = (activeByIp.get(ip) ?? 1) - 1;
        if (left > 0) activeByIp.set(ip, left);
        else activeByIp.delete(ip);
      },
    });
    active.add(run);
  });

  app.use(express.static(PUBLIC_DIR));

  // Bad JSON bodies and anything unexpected get a JSON error, never a stack trace.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body must be valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large.' });
    o.log.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  app.locals.activeRuns = () => active.size;
  app.locals.activePids = () => [...active].map((r) => r.pid);
  app.locals.killAll = () => { for (const r of active) r.kill(); };
  return app;
}
