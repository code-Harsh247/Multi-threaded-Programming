import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, validate, estimateSeconds, toArgs, limitsForClient } from '../src/limits.js';

test('an empty body gives the engine defaults', () => {
  for (const body of [undefined, null, {}]) {
    const v = validate(body);
    assert.equal(v.ok, true);
    assert.deepEqual(v.settings, {
      boats: 5, visitors: 20, msPerMin: 100, sightMin: 30, sightMax: 120, rideMin: 15, rideMax: 60,
    });
  }
});

test('every bound is accepted and every bound ±1 is rejected', () => {
  for (const [key, lim] of Object.entries(LIMITS)) {
    // Keep min <= max pairs valid while one side sits at its edge.
    const base = { sightMin: 1, sightMax: 240, rideMin: 1, rideMax: 120 };
    for (const ok of [lim.min, lim.max]) {
      const body = { ...base, [key]: ok };
      if (key === 'sightMin') body.sightMax = Math.max(ok, body.sightMax);
      if (key === 'sightMax') body.sightMin = Math.min(ok, body.sightMin);
      if (key === 'rideMin') body.rideMax = Math.max(ok, body.rideMax);
      if (key === 'rideMax') body.rideMin = Math.min(ok, body.rideMin);
      assert.equal(validate(body).ok, true, `${key}=${ok} should be accepted`);
    }
    for (const bad of [lim.min - 1, lim.max + 1]) {
      const v = validate({ [key]: bad });
      assert.equal(v.ok, false, `${key}=${bad} should be rejected`);
      assert.match(v.error, new RegExp(`${key} must be between ${lim.min} and ${lim.max}`));
    }
  }
});

test('non-integers, wrong types and unknown settings are rejected', () => {
  for (const value of [5.5, '5', true, [5], { n: 5 }, NaN, Infinity]) {
    assert.equal(validate({ boats: value }).ok, false, `boats=${JSON.stringify(value)}`);
  }
  assert.match(validate({ boats: 5, colour: 'red' }).error, /Unknown setting: colour/);
  assert.equal(validate([1, 2]).ok, false);
  assert.equal(validate('boats=5').ok, false);
  assert.equal(validate({ __proto__: { boats: 3 } }).ok, true, 'inherited keys are ignored');
});

test('min must not exceed max', () => {
  assert.match(validate({ sightMin: 50, sightMax: 40 }).error, /sightMin must not be greater than sightMax/);
  assert.match(validate({ rideMin: 61, rideMax: 60 }).error, /rideMin must not be greater than rideMax/);
  assert.equal(validate({ sightMin: 40, sightMax: 40, rideMin: 9, rideMax: 9 }).ok, true);
});

test('worst-case estimate', () => {
  // defaults: 120 + (ceil(20/5) + 1) * 60 = 420 minutes at 100 ms = 42 s
  assert.equal(estimateSeconds(validate({}).settings), 42);
  // 120 + (ceil(200/5) + 1) * 60 = 2580 minutes at 200 ms = 516 s
  assert.equal(estimateSeconds(validate({ visitors: 200, msPerMin: 200 }).settings), 516);
  // ceil rounds up: 21 visitors on 20 boats is 2 rides each
  assert.equal(estimateSeconds({ boats: 20, visitors: 21, msPerMin: 1000, sightMax: 1, rideMax: 1 }), 4);
});

test('toArgs builds the engine command line in a fixed order', () => {
  const s = validate({ boats: 8, visitors: 50, msPerMin: 20 }).settings;
  assert.deepEqual(toArgs(s), [
    '--boats', '8', '--visitors', '50', '--ms-per-min', '20',
    '--sight-min', '30', '--sight-max', '120', '--ride-min', '15', '--ride-max', '60',
  ]);
});

test('limitsForClient exposes ranges and defaults but not engine flags', () => {
  const out = limitsForClient(180);
  assert.equal(out.maxRunSeconds, 180);
  assert.deepEqual(out.settings.boats, { min: 5, max: 20, default: 5 });
  assert.deepEqual(Object.keys(out.settings), Object.keys(LIMITS));
});
