// Settings a browser may send, with the same limits and defaults as boating.c.
// test/engine-parity.test.js checks that these agree with the real binary.
export const LIMITS = {
  boats:    { min: 5,  max: 20,  default: 5,   flag: '--boats' },
  visitors: { min: 20, max: 200, default: 20,  flag: '--visitors' },
  msPerMin: { min: 1,  max: 200, default: 100, flag: '--ms-per-min' },
  sightMin: { min: 1,  max: 240, default: 30,  flag: '--sight-min' },
  sightMax: { min: 1,  max: 240, default: 120, flag: '--sight-max' },
  rideMin:  { min: 1,  max: 120, default: 15,  flag: '--ride-min' },
  rideMax:  { min: 1,  max: 120, default: 60,  flag: '--ride-max' },
};

// Returns { ok: true, settings } or { ok: false, error }.
// Missing settings take their defaults; unknown ones are rejected.
export function validate(body) {
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Settings must be a JSON object.' };
  }
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(LIMITS, key)) return { ok: false, error: `Unknown setting: ${key}.` };
  }

  const settings = {};
  for (const [key, lim] of Object.entries(LIMITS)) {
    const value = Object.hasOwn(body, key) ? body[key] : lim.default;
    if (!Number.isInteger(value)) {
      return { ok: false, error: `${key} must be a whole number.` };
    }
    if (value < lim.min || value > lim.max) {
      return { ok: false, error: `${key} must be between ${lim.min} and ${lim.max}.` };
    }
    settings[key] = value;
  }
  if (settings.sightMin > settings.sightMax) {
    return { ok: false, error: 'sightMin must not be greater than sightMax.' };
  }
  if (settings.rideMin > settings.rideMax) {
    return { ok: false, error: 'rideMin must not be greater than rideMax.' };
  }
  return { ok: true, settings };
}

// Upper bound on a run's real duration, in seconds. Every visitor is at the
// jetty by sightMax; after that each boat gives at most ceil(visitors/boats)
// rides, plus one ride already under way.
export function estimateSeconds(s) {
  const minutes = s.sightMax + (Math.ceil(s.visitors / s.boats) + 1) * s.rideMax;
  return (minutes * s.msPerMin) / 1000;
}

// Command-line arguments for the engine. Values are validated integers, and
// the engine is started without a shell, so nothing here can inject commands.
export function toArgs(s) {
  return Object.entries(LIMITS).flatMap(([key, lim]) => [lim.flag, String(s[key])]);
}

// What GET /api/limits returns: everything a form needs.
export function limitsForClient(maxRunSeconds) {
  const settings = {};
  for (const [key, { min, max, default: def }] of Object.entries(LIMITS)) {
    settings[key] = { min, max, default: def };
  }
  return { settings, maxRunSeconds };
}
