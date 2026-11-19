// The browser's state model (public/js/sim.js) is plain JavaScript, so it is
// tested here by replaying real engine output through it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Sim, clockText } from '../public/js/sim.js';
import { LIMITS, toArgs } from '../src/limits.js';
import { BIN } from './helpers.js';

const DEFAULTS = Object.fromEntries(Object.entries(LIMITS).map(([k, l]) => [k, l.default]));

function engineEvents(settings) {
  const r = spawnSync(BIN, toArgs({ ...DEFAULTS, ...settings }), { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout);
  return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
}

for (const settings of [
  { boats: 5, visitors: 40, msPerMin: 2 },
  { boats: 20, visitors: 200, msPerMin: 1, sightMin: 1, sightMax: 1, rideMin: 1, rideMax: 1 },
  { boats: 7, visitors: 90, msPerMin: 1, sightMin: 1, sightMax: 240, rideMin: 1, rideMax: 120 },
]) {
  test(`replaying a ${settings.boats} x ${settings.visitors} run`, () => {
    const events = engineEvents(settings);
    const sim = new Sim();
    const n = settings.visitors;
    for (const ev of events) {
      sim.apply(ev);
      const c = sim.counts;
      // Nothing ever goes negative or over its limit mid-run.
      for (const [k, v] of Object.entries(c)) assert.ok(v >= 0, `${k} went negative at ${ev.type}`);
      assert.ok(c.riding <= settings.boats, 'more riders than boats');
      assert.ok(c.sightseeing + c.waiting + c.left <= n);
      assert.equal(sim.waiting.length, c.waiting);
    }

    assert.equal(sim.done, true);
    assert.equal(sim.error, null);
    assert.deepEqual(sim.counts, { sightseeing: 0, waiting: 0, riding: 0, left: n });
    assert.equal(sim.boats.reduce((sum, b) => sum + b.rides, 0), n);
    assert.ok(sim.boats.every((b) => b.ready && b.visitor === null));
    assert.equal(sim.waitCount, n);
    assert.ok(sim.avgWait >= 0 && sim.maxWait >= sim.avgWait);
    for (const v of sim.visitors.values()) {
      assert.equal(v.state, 'left');
      assert.ok(v.waitT <= v.claimT && v.claimT <= v.rideStartT && v.rideStartT <= v.rideEndT);
    }
    assert.deepEqual(sim.series[0], [0, 0]);
    assert.equal(sim.series.at(-1)[1], 0);
    assert.ok(sim.series.every(([, w]) => w >= 0 && w <= n));
  });
}

test('an error event is recorded', () => {
  const sim = new Sim();
  sim.apply({ type: 'error', t: 0, message: 'boats must be between 5 and 20' });
  assert.equal(sim.error, 'boats must be between 5 and 20');
});

test('a new config resets everything', () => {
  const sim = new Sim();
  for (const ev of engineEvents({ boats: 5, visitors: 20, msPerMin: 1 })) sim.apply(ev);
  sim.apply({ type: 'config', t: 0, boats: 8, visitors: 30, ms_per_min: 10, sight: [30, 120], ride: [15, 60] });
  assert.equal(sim.boats.length, 8);
  assert.equal(sim.visitors.size, 0);
  assert.equal(sim.done, false);
  assert.deepEqual(sim.counts, { sightseeing: 0, waiting: 0, riding: 0, left: 0 });
});

test('the park clock starts at 9:00 AM', () => {
  assert.equal(clockText(0), '9:00 AM');
  assert.equal(clockText(59.9), '9:59 AM');
  assert.equal(clockText(180), '12:00 PM');
  assert.equal(clockText(245), '1:05 PM');
  assert.equal(clockText(900), '12:00 AM');
});
