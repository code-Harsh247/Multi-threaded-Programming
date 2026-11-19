// The server keeps its own copy of the setting limits (src/limits.js) so it
// can reject bad input before starting a process. These tests check that
// copy against the real engine, so the two can never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LIMITS, validate, toArgs } from '../src/limits.js';
import { BIN, FAST } from './helpers.js';

const DEFAULTS = Object.fromEntries(Object.entries(LIMITS).map(([k, l]) => [k, l.default]));

function runEngine(settings) {
  return spawnSync(BIN, toArgs({ ...DEFAULTS, ...settings }), { encoding: 'utf8', timeout: 30000 });
}

// Puts one setting at `value` on top of the fast config, keeping the
// matching min/max pair consistent.
function withEdge(key, value) {
  const s = { ...FAST, [key]: value };
  if (key === 'sightMin') s.sightMax = Math.max(value, s.sightMax);
  if (key === 'sightMax') s.sightMin = Math.min(value, s.sightMin);
  if (key === 'rideMin') s.rideMax = Math.max(value, s.rideMax);
  if (key === 'rideMax') s.rideMin = Math.min(value, s.rideMin);
  return s;
}

for (const [key, lim] of Object.entries(LIMITS)) {
  test(`${key}: ${lim.min} and ${lim.max} are accepted by the server and the engine`, () => {
    for (const value of [lim.min, lim.max]) {
      const s = withEdge(key, value);
      assert.equal(validate(s).ok, true, `server rejected ${key}=${value}`);
      const r = runEngine(s);
      assert.equal(r.status, 0, `engine rejected ${key}=${value}: ${r.stdout.split('\n')[0]}`);
      assert.match(r.stdout.trim().split('\n').at(-1), /"type":"done"/);
    }
  });

  test(`${key}: ${lim.min - 1} and ${lim.max + 1} are rejected by the server and the engine`, () => {
    for (const value of [lim.min - 1, lim.max + 1]) {
      const s = { ...FAST, [key]: value };
      assert.equal(validate(s).ok, false, `server accepted ${key}=${value}`);
      const r = runEngine(s);
      assert.equal(r.status, 2, `engine accepted ${key}=${value}`);
      assert.match(r.stdout, /^\{"type":"error"/);
    }
  });
}

test('min > max is rejected by both', () => {
  for (const s of [{ sightMin: 10, sightMax: 9 }, { rideMin: 10, rideMax: 9 }]) {
    assert.equal(validate(s).ok, false);
    assert.equal(runEngine(s).status, 2);
  }
});
