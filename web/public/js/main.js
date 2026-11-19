import { Sim, clockText } from './sim.js';
import { Scene, W, H } from './scene.js';
import { QueueChart } from './chart.js';
import { lookFor, HULLS } from './sprites.js';
import { validate, estimateSeconds } from './limits.js';   // served from the server's own src/limits.js

const $ = (id) => document.getElementById(id);
const SPEEDS = [
  { ms: 200, label: 'Slow motion — 1 min = 200 ms' },
  { ms: 150, label: 'Leisurely — 1 min = 150 ms' },
  { ms: 100, label: 'Relaxed — 1 min = 100 ms' },
  { ms: 50, label: 'Normal — 1 min = 50 ms' },
];
const DEFAULT_SPEED = 50;
const FIELDS = ['boats', 'visitors', 'msPerMin', 'sightMin', 'sightMax', 'rideMin', 'rideMax'];
const CHART_COLORS = { bg: '#fffdf6', grid: '#d9c49a', axis: '#3a2a1c', line: '#1d5fa8', fill: '#a8d4f5' };

const sim = new Sim();
const scene = new Scene($('scene'));
const chart = new QueueChart($('chart'));
let maxRunSeconds = 180;
let controller = null;
let running = false;
let pointer = null;          // last pointer position over the scene, in scene pixels

// ------------------------------------------------------------- settings --
async function loadLimits() {
  const res = await fetch('/api/limits');
  if (!res.ok) throw new Error(`limits request failed (${res.status})`);
  const { settings, maxRunSeconds: maxSeconds } = await res.json();
  maxRunSeconds = maxSeconds;

  for (const key of ['boats', 'visitors', 'sightMin', 'sightMax', 'rideMin', 'rideMax']) {
    const input = $(key);
    Object.assign(input, { min: settings[key].min, max: settings[key].max, step: 1, value: settings[key].default });
  }
  const speed = $('msPerMin');
  for (const s of SPEEDS) {
    if (s.ms < settings.msPerMin.min || s.ms > settings.msPerMin.max) continue;
    speed.append(new Option(s.label, s.ms, false, s.ms === DEFAULT_SPEED));
  }
  onSettingsChanged();
}

function readSettings() {
  const out = {};
  for (const key of FIELDS) out[key] = Number($(key).value);
  return out;
}

function onSettingsChanged() {
  const s = readSettings();
  $('boats-out').textContent = s.boats;
  $('visitors-out').textContent = s.visitors;
  const est = $('estimate');
  const v = validate(s);
  let ok = v.ok;
  if (!v.ok) {
    est.textContent = v.error;
  } else {
    const seconds = estimateSeconds(v.settings);
    if (seconds > maxRunSeconds) {
      ok = false;
      est.textContent = `This could take up to ${Math.ceil(seconds)} s (limit ${maxRunSeconds} s). ` +
                        'Pick a faster speed, fewer visitors or shorter rides.';
    } else {
      est.textContent = `Takes up to ${Math.ceil(seconds)} s of real time.`;
    }
  }
  est.classList.toggle('bad', !ok);
  $('start').disabled = running || !ok;
  if (!running && v.ok && v.settings.boats !== scene.m) {
    scene.setBoats(v.settings.boats);
    sim.reset();
  }
}

function setRunning(on) {
  running = on;
  for (const key of FIELDS) $(key).disabled = on;
  $('stop').disabled = !on;
  if (!on) onSettingsChanged();
  else $('start').disabled = true;
}

function message(text, kind = '') {
  const m = $('message');
  m.textContent = text;
  m.className = `message ${kind}`;
}

// ------------------------------------------------------------------ run --
async function* readEvents(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

async function start() {
  const v = validate(readSettings());
  if (!v.ok) return message(v.error, 'bad');
  setRunning(true);
  sim.reset();
  scene.setBoats(v.settings.boats);
  message('Opening the gates…');
  controller = new AbortController();
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v.settings),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      message(err.error ?? `The server said no (${res.status}).`, 'bad');
      return;
    }
    message('The park is open. Hover over anyone to see what they are up to.');
    for await (const ev of readEvents(res.body)) {
      sim.apply(ev);
      scene.handle(ev, sim);
      if (ev.type === 'error') message(`Something went wrong: ${ev.message}`, 'bad');
      if (ev.type === 'done') {
        message(`Day over! All ${sim.config.visitors} visitors had their ride by ` +
                `${clockText(sim.minutes(ev.t))}, in ${(ev.t / 1000).toFixed(1)} s of real time.`, 'good');
      }
    }
    if (!sim.done && !sim.error) message('The simulation ended early.', 'bad');
  } catch (e) {
    if (e.name === 'AbortError') {
      scene.stopRun();
      message('Stopped. Everyone is heading home.');
    } else {
      scene.stopRun();
      message(`Lost the connection to the server: ${e.message}`, 'bad');
    }
  } finally {
    controller = null;
    setRunning(false);
  }
}

// ----------------------------------------------------------------- stats --
function nowT() {
  if (!sim.config) return 0;
  return running ? Math.max(sim.lastT, scene.clock()) : sim.lastT;
}

const fmtMin = (m) => `${Math.round(m)} min`;

function updateStats() {
  const t = nowT();
  const minutes = sim.config ? sim.minutes(t) : 0;
  const c = sim.counts;
  const n = sim.config?.visitors ?? 0;
  $('clock').textContent = clockText(minutes);
  $('st-sight').textContent = c.sightseeing;
  $('st-wait').textContent = c.waiting;
  $('st-ride').textContent = c.riding;
  $('st-left').textContent = n ? `${c.left} / ${n}` : '0';
  $('st-avg').textContent = sim.waitCount ? fmtMin(sim.avgWait) : '–';
  $('st-max').textContent = sim.waitCount ? fmtMin(sim.maxWait) : '–';
  $('st-busy').textContent = `${c.riding} / ${scene.m}`;
  $('st-real').textContent = `${(t / 1000).toFixed(1)} s`;
  $('progress').style.width = n ? `${(100 * c.left) / n}%` : '0';

  const { xMax, yMax, peak } = chart.draw(sim.series, minutes, CHART_COLORS);
  $('chart-y').textContent = yMax;
  $('chart-x-end').textContent = clockText(xMax);
  $('chart-note').textContent = `Peak: ${peak} waiting`;
}

// -------------------------------------------------------------- tooltips --
function describe(item) {
  const t = nowT();
  const mins = (from) => Math.max(0, Math.round(sim.minutes(t - from)));
  if (item.kind === 'boat') {
    const b = sim.boats[item.id - 1];
    const [hull] = HULLS[(item.id - 1) % HULLS.length];
    const rides = b?.rides ?? 0;
    let status = 'Docked, waiting for a visitor.';
    if (b?.visitor) status = `Out with visitor ${b.visitor}: ${Math.min(mins(b.rideStartT), b.ride)} of ${b.ride} min.`;
    return `<b><span class="sw" style="background:${hull}"></span>Boat ${item.id}</b>` +
           `${rides} ride${rides === 1 ? '' : 's'} given today.<br>${status}`;
  }
  const v = sim.visitors.get(item.id);
  if (!v) return `<b>Visitor ${item.id}</b>`;
  const { shirt } = lookFor(item.id);
  let status;
  switch (v.state) {
    case 'sightseeing': status = `Exploring the park: ${Math.min(mins(v.arriveT), v.sight)} of ${v.sight} min.`; break;
    case 'waiting': status = `Waiting at the jetty for ${mins(v.waitT)} min.`; break;
    case 'boarding': status = `Hurrying to boat ${v.boat}.`; break;
    case 'riding': status = `Rowing boat ${v.boat}.`; break;
    case 'left': status = `Waited ${Math.round(sim.minutes(v.claimT - v.waitT))} min, rode boat ${v.boat}. Heading home.`; break;
    default: status = '';
  }
  return `<b><span class="sw" style="background:${shirt}"></span>Visitor ${item.id}</b>` +
         `Plans: ${v.sight} min sightseeing, ${v.ride} min ride.<br>${status}`;
}

function updateTooltip() {
  const tip = $('tooltip');
  const item = pointer ? scene.hitTest(pointer.x, pointer.y) : null;
  scene.hover = item;
  if (!item) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = describe(item);
  tip.hidden = false;
  const wrap = $('scene-wrap').getBoundingClientRect();
  const canvas = $('scene').getBoundingClientRect();
  let left = canvas.left - wrap.left + (pointer.x / W) * canvas.width + 14;
  let top = canvas.top - wrap.top + (pointer.y / H) * canvas.height + 14;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  if (left + tw > wrap.width) left = Math.max(0, left - tw - 28);
  if (top + th > wrap.height) top = Math.max(0, top - th - 28);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function trackPointer(e) {
  const r = $('scene').getBoundingClientRect();
  pointer = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

// ---------------------------------------------------------------- layout --
// Scale the 480x270 scene by a whole number so every pixel stays square.
function fitScene() {
  const avail = $('scene-wrap').clientWidth;
  const scale = avail >= W ? Math.min(4, Math.floor(avail / W)) : avail / W;
  const canvas = $('scene');
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
}

// ------------------------------------------------------------------ main --
let lastTip = 0;
function step(now) {
  scene.frame(now);
  updateStats();
  if (now - lastTip > 80) {
    updateTooltip();
    lastTip = now;
  }
}
function tick(now) {
  step(now);
  requestAnimationFrame(tick);
}

$('settings').addEventListener('input', onSettingsChanged);
$('settings').addEventListener('submit', (e) => e.preventDefault());
$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => controller?.abort());
$('scene').addEventListener('pointermove', trackPointer);
$('scene').addEventListener('pointerdown', trackPointer);
$('scene').addEventListener('pointerleave', () => { pointer = null; });
window.park = { sim, scene, step };   // handy for poking at the state from the dev console
new ResizeObserver(fitScene).observe($('scene-wrap'));
fitScene();
requestAnimationFrame(tick);
loadLimits().catch((e) => message(`Could not reach the server: ${e.message}`, 'bad'));
