import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  FAST, SLOW, CHECK_SCRIPT, startServer, postRun, parseLines, waitFor, isAlive, findPython,
} from './helpers.js';

describe('default server', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('GET /healthz', async () => {
    const r = await fetch(`${srv.url}/healthz`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
  });

  test('GET /api/limits', async () => {
    const r = await fetch(`${srv.url}/api/limits`);
    const body = await r.json();
    assert.equal(body.maxRunSeconds, 180);
    assert.deepEqual(Object.keys(body.settings),
      ['boats', 'visitors', 'msPerMin', 'sightMin', 'sightMax', 'rideMin', 'rideMax']);
    assert.deepEqual(body.settings.visitors, { min: 20, max: 200, default: 20 });
  });

  test('GET / serves the simulator page and its assets', async () => {
    const r = await fetch(srv.url);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Boating Simulator/);
    for (const asset of ['/js/main.js', '/js/scene.js', '/js/sprites.js', '/js/sim.js', '/css/style.css', '/debug.html']) {
      assert.equal((await fetch(srv.url + asset)).status, 200, asset);
    }
  });

  test('GET /js/limits.js serves the server\'s own limits module to the browser', async () => {
    const r = await fetch(`${srv.url}/js/limits.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    const body = await r.text();
    assert.match(body, /export function estimateSeconds/);
    assert.match(body, /export function validate/);
  });

  test('a run streams a complete, valid event stream', async (t) => {
    const r = await postRun(srv.url, FAST);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/x-ndjson/);
    assert.match(r.headers.get('cache-control'), /no-cache/);
    const text = await r.text();
    const events = parseLines(text);
    assert.equal(events[0].type, 'config');
    assert.equal(events[0].boats, 20);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.length, 1 + 20 + 6 * 20 + 1);   // config + boats + 6 per visitor + done
    await waitFor(() => srv.app.locals.activeRuns() === 0);

    const python = findPython();
    if (!python) return t.skip('Python 3 not found; skipped tests/check_events.py');
    const check = spawnSync(python, [CHECK_SCRIPT], { input: text, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  });

  test('bad input is rejected with 400 and no run is started', async () => {
    for (const body of [{ boats: 4 }, { visitors: 201 }, { boats: '5' }, { speed: 3 },
                        { sightMin: 50, sightMax: 40 }, '{not json', '[1,2]']) {
      const r = await postRun(srv.url, body);
      assert.equal(r.status, 400, `body ${JSON.stringify(body)}`);
      assert.ok((await r.json()).error);
    }
    assert.equal(srv.app.locals.activeRuns(), 0);
  });

  test('a run that could take too long is rejected with its estimate', async () => {
    const r = await postRun(srv.url, { boats: 5, visitors: 200, msPerMin: 200 });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.estimateSeconds, 516);
    assert.match(body.error, /could take up to 516 s/);
  });

  test('a second run from the same visitor gets 429', async () => {
    const ac = new AbortController();
    const first = await postRun(srv.url, SLOW, ac.signal);
    assert.equal(first.status, 200);
    const second = await postRun(srv.url, FAST);
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /already have a simulation running/);
    ac.abort();
    await waitFor(() => srv.app.locals.activeRuns() === 0);
  });

  test('aborting a run kills the engine process', async () => {
    const ac = new AbortController();
    const r = await postRun(srv.url, SLOW, ac.signal);
    const reader = r.body.getReader();
    await reader.read();                        // the run has started streaming
    const pids = srv.app.locals.activePids();
    assert.equal(pids.length, 1);
    assert.ok(isAlive(pids[0]));
    ac.abort();
    await waitFor(() => srv.app.locals.activeRuns() === 0);
    await waitFor(() => !isAlive(pids[0]));
  });
});

test('server-wide limit returns 503', async () => {
  const srv = await startServer({ maxConcurrent: 1, maxPerIp: 5 });
  try {
    const ac = new AbortController();
    const first = await postRun(srv.url, SLOW, ac.signal);
    assert.equal(first.status, 200);
    const second = await postRun(srv.url, FAST);
    assert.equal(second.status, 503);
    assert.equal(second.headers.get('retry-after'), '10');
    await second.json();
    ac.abort();
    await waitFor(() => srv.app.locals.activeRuns() === 0);
  } finally {
    await srv.close();
  }
});

test('per-minute limit returns 429 with Retry-After', async () => {
  const srv = await startServer({ runsPerMinute: 2, maxPerIp: 5, maxConcurrent: 5 });
  try {
    for (let i = 0; i < 2; i++) {
      const r = await postRun(srv.url, FAST);
      assert.equal(r.status, 200);
      await r.text();
    }
    const third = await postRun(srv.url, FAST);
    assert.equal(third.status, 429);
    assert.match((await third.json()).error, /Too many runs started/);
    assert.ok(Number(third.headers.get('retry-after')) > 0);
  } finally {
    await srv.close();
  }
});

test('a run past its time budget ends with a timeout error', async () => {
  const srv = await startServer({ timeoutMs: 300 });
  try {
    const r = await postRun(srv.url, SLOW);
    const events = parseLines(await r.text());
    assert.equal(events[0].type, 'config');
    assert.deepEqual(events.at(-1), { type: 'error', message: 'run timed out' });
    assert.ok(!events.some((e) => e.type === 'done'));
    await waitFor(() => srv.app.locals.activeRuns() === 0);
  } finally {
    await srv.close();
  }
});
