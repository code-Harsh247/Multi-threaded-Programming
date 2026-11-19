// The animated pixel-art scene. Events from the engine tell it *what* happens
// (a visitor starts waiting, claims boat 3, ...); the scene decides how to
// show it: people walk, queue, row a loop around the lake, and walk home.
import { C, lookFor, personSprites, boatSprites, propSprites, BOAT_W, BOAT_H } from './sprites.js';
import { drawText, textWidth } from './font.js';

export const W = 480;
export const H = 270;

const LAKE_TOP = 24;
const DECK_TOP = 172;        // boardwalk top edge = waterline of docked boats
const PARK_TOP = 184;
const DECK_Y = 180;          // feet of people standing on the boardwalk
const PATH_Y = 257;          // feet of people walking the park path
const GATE_X = 16;
const QUEUE = { x0: 300, x1: 472, y0: 197, rowH: 9, rows: 7, step: 6 };
const PER_ROW = Math.floor((QUEUE.x1 - QUEUE.x0 - 6) / QUEUE.step) + 1;
const WANDER = { x0: 14, x1: 286, y0: 194, y1: 262 };
const WALK_SPEED = 0.03;     // px per real ms at normal speed

const PROPS = [
  { kind: 'tree', x: 30, y: 212 }, { kind: 'tree', x: 120, y: 236 },
  { kind: 'tree', x: 212, y: 210 }, { kind: 'tree', x: 276, y: 246 },
  { kind: 'bush', x: 92, y: 202 }, { kind: 'bush', x: 252, y: 198 }, { kind: 'bush', x: 182, y: 248 },
  { kind: 'bench', x: 62, y: 250 }, { kind: 'bench', x: 154, y: 250 },
  { kind: 'lamp', x: 102, y: 251 }, { kind: 'lamp', x: 240, y: 251 },
];

const DUCKS = [
  { cx: 78, cy: 66, rx: 44, ry: 14, period: 42000, phase: 0.0 },
  { cx: 404, cy: 118, rx: 32, ry: 11, period: 35000, phase: 0.55 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function berthX(m, id) {
  return Math.round(20 + ((W - 40) / m) * (id - 0.5));
}

export function queueSlot(i) {
  const row = Math.floor(i / PER_ROW);
  const col = i % PER_ROW;
  if (row >= QUEUE.rows) {   // queue overflows onto the path
    return { x: QUEUE.x0 - 10 - (i - QUEUE.rows * PER_ROW) * 6, y: PATH_Y };
  }
  const y = QUEUE.y0 + row * QUEUE.rowH;
  const x = row % 2 === 0 ? QUEUE.x1 - 3 - col * QUEUE.step : QUEUE.x0 + 3 + col * QUEUE.step;
  return { x, y };
}

function ellipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

// ------------------------------------------------------------ background --
function buildBackground(m) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const rnd = seeded(7);
  const p = propSprites();

  // Far shore: grass, a row of trees and bushes, sand.
  g.fillStyle = C.grass;
  g.fillRect(0, 0, W, LAKE_TOP);
  for (let x = -6; x < W; x += 13) g.drawImage(p.smallTree, x + Math.floor(rnd() * 4), -3 + Math.floor(rnd() * 3));
  for (let x = 2; x < W; x += 17) g.drawImage(p.bush, x + Math.floor(rnd() * 5), 9 + Math.floor(rnd() * 2));
  g.fillStyle = C.sand;
  g.fillRect(0, 18, W, 6);
  g.fillStyle = C.sandDark;
  for (let i = 0; i < 70; i++) g.fillRect(Math.floor(rnd() * W), 19 + Math.floor(rnd() * 5), 1, 1);

  // The lake.
  g.fillStyle = C.water;
  g.fillRect(0, LAKE_TOP, W, DECK_TOP - LAKE_TOP);
  // Deeper water: a slightly darker core with a dithered edge.
  for (const [cx, cy, rx, ry] of [[150, 70, 70, 16], [330, 98, 92, 22], [90, 132, 50, 12], [420, 56, 40, 10]]) {
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
      for (let dx = -half; dx <= half; dx++) {
        const edge = Math.hypot(dx / rx, dy / ry);
        if (edge < 0.78 || (edge < 1 && (dx + dy) % 2 === 0)) {
          g.fillStyle = C.waterDeep;
          g.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    }
  }
  // Gentle ripples.
  g.fillStyle = C.waterLight;
  for (let i = 0; i < 55; i++) {
    const x = Math.floor(rnd() * W);
    const y = LAKE_TOP + 6 + Math.floor(rnd() * (DECK_TOP - LAKE_TOP - 14));
    g.fillRect(x, y, 3, 1);
    g.fillRect(x + 3, y - 1, 2, 1);
  }
  g.fillStyle = C.waterLight;
  g.fillRect(0, LAKE_TOP, W, 2);
  g.fillStyle = C.sparkle;
  for (let x = 0; x < W; x += 3 + Math.floor(rnd() * 6)) g.fillRect(x, LAKE_TOP, 1 + Math.floor(rnd() * 3), 1);
  g.fillStyle = C.waterShadow;
  g.fillRect(0, DECK_TOP - 2, W, 2);           // shade under the boardwalk
  for (const [x, y] of [[14, 40], [34, 48], [456, 36], [440, 44], [462, 150], [10, 154]]) {
    ellipse(g, x, y, 5, 3, C.leafShade);        // lily pads
    ellipse(g, x, y - 1, 4, 2, C.leafLight);
    g.fillStyle = C.water;
    g.fillRect(x, y - 3, 1, 3);
  }
  g.fillStyle = C.flowers[2];
  g.fillRect(35, 46, 2, 2);
  g.fillRect(441, 42, 2, 2);

  // The boardwalk, with a mooring post between berths.
  g.fillStyle = C.wood;
  g.fillRect(0, DECK_TOP, W, PARK_TOP - DECK_TOP);
  g.fillStyle = C.woodLight;
  g.fillRect(0, DECK_TOP, W, 1);
  g.fillStyle = C.woodDark;
  for (let x = 0; x < W; x += 8) g.fillRect(x, DECK_TOP + 1, 1, 10);
  g.fillStyle = C.woodDeep;
  g.fillRect(0, PARK_TOP - 1, W, 1);
  for (let i = 0; i <= m; i++) {
    const x = Math.round(20 + ((W - 40) / m) * i);
    g.fillStyle = C.woodDeep;
    g.fillRect(x - 1, DECK_TOP - 6, 2, 7);
    g.fillStyle = C.woodLight;
    g.fillRect(x - 1, DECK_TOP - 6, 2, 1);
  }

  // The park strip.
  g.fillStyle = C.grass;
  g.fillRect(0, PARK_TOP, W, H - PARK_TOP);
  g.fillStyle = C.grassDark;
  g.fillRect(0, PARK_TOP, W, 2);
  for (let i = 0; i < 320; i++) {
    const x = Math.floor(rnd() * W);
    const y = PARK_TOP + 3 + Math.floor(rnd() * (H - PARK_TOP - 3));
    g.fillStyle = rnd() < 0.6 ? C.grassDark : C.grassLight;
    g.fillRect(x, y, 1, 1);
    g.fillRect(x + 2, y, 1, 1);
    g.fillRect(x + 1, y + 1, 1, 1);
  }

  // Path from the gate to the queue.
  g.fillStyle = C.path;
  g.fillRect(0, 252, QUEUE.x0 + 4, 11);
  g.fillStyle = C.pathDark;
  g.fillRect(0, 252, QUEUE.x0 - 4, 1);
  g.fillRect(0, 262, QUEUE.x0 + 4, 1);
  for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rnd() * QUEUE.x0), 254 + Math.floor(rnd() * 7), 1, 1);

  // Queue pen: paved ground, ropes between the switchback rows.
  const qx = QUEUE.x0 - 4;
  const qw = QUEUE.x1 - QUEUE.x0 + 8;
  g.fillStyle = C.path;
  g.fillRect(qx, 189, qw, 74);
  g.fillStyle = C.pathDark;
  g.fillRect(qx, 189, qw, 1);
  g.fillRect(qx, 262, qw, 1);
  g.fillRect(qx + qw - 1, 189, 1, 74);
  for (let r = 0; r < QUEUE.rows - 1; r++) {
    const y = QUEUE.y0 + r * QUEUE.rowH + 3;
    const [a, b] = r % 2 === 0 ? [QUEUE.x0 + 8, QUEUE.x1] : [QUEUE.x0, QUEUE.x1 - 8];
    g.fillStyle = C.rope;
    g.fillRect(a, y, b - a, 1);
    for (let x = a; x <= b; x += 24) {
      g.fillStyle = C.woodDeep;
      g.fillRect(x, y - 2, 2, 4);
      g.fillStyle = C.woodLight;
      g.fillRect(x, y - 2, 2, 1);
    }
  }

  // Flower beds: a rounded patch of leaves dotted with clumps of flowers.
  for (const [x, y, w, h] of [[52, 221, 34, 10], [160, 195, 40, 9], [232, 221, 30, 10]]) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ellipse(g, Math.round(cx), Math.round(cy) + 1, Math.round(w / 2), Math.round(h / 2), C.leafOutline);
    ellipse(g, Math.round(cx), Math.round(cy), Math.round(w / 2) - 1, Math.round(h / 2) - 1, C.leafShade);
    for (let i = 0; i < (w * h) / 10; i++) {
      const fx = Math.round(cx + (rnd() - 0.5) * (w - 6));
      const fy = Math.round(cy + (rnd() - 0.5) * (h - 4));
      g.fillStyle = C.leaf;
      g.fillRect(fx - 1, fy + 1, 3, 1);
      const col = C.flowers[Math.floor(rnd() * C.flowers.length)];
      g.fillStyle = col;
      g.fillRect(fx, fy - 1, 1, 1);
      g.fillRect(fx - 1, fy, 3, 1);
      g.fillRect(fx, fy + 1, 1, 1);
      g.fillStyle = C.flowers[1] === col ? C.flowers[5] : C.flowers[1];
      g.fillRect(fx, fy, 1, 1);
    }
  }

  // Entrance gate: a stone pillar on each side of the path, a sign and a flag.
  for (const [y, h] of [[236, 16], [263, 7]]) {
    g.fillStyle = C.stone;
    g.fillRect(4, y, 7, h);
    g.fillStyle = C.stoneLight;
    g.fillRect(4, y, 7, 1);
    g.fillStyle = C.stoneDark;
    g.fillRect(10, y, 1, h);
  }
  g.fillStyle = C.ink;
  g.fillRect(0, 228, 16, 9);
  g.fillStyle = C.cream;
  g.fillRect(1, 229, 14, 7);
  g.fillStyle = C.ink;
  g.fillRect(3, 231, 10, 1);
  g.fillRect(3, 233, 7, 1);
  g.fillStyle = C.iron;
  g.fillRect(7, 216, 1, 12);
  g.fillStyle = C.flag;
  g.fillRect(8, 216, 5, 2);
  g.fillRect(8, 218, 3, 1);

  return canvas;
}

function makeSparkles() {
  const rnd = seeded(42);
  return Array.from({ length: 90 }, () => ({
    x: Math.floor(rnd() * W),
    y: LAKE_TOP + 4 + Math.floor(rnd() * (DECK_TOP - LAKE_TOP - 10)),
    len: 1 + Math.floor(rnd() * 3),
    period: 1800 + rnd() * 3200,
    phase: rnd(),
  }));
}

// A boat's ride: out from its berth, once around an ellipse, and back.
function ridePath(dockX) {
  const ry = Math.round(rand(14, 26));
  const rx = Math.round(rand(30, 72));
  const cx = clamp(dockX + rand(-90, 90), rx + 14, W - rx - 14);
  const cy = clamp(rand(64, 118), LAKE_TOP + 14 + ry, DECK_TOP - 26 - ry);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const pts = [{ x: dockX, y: DECK_TOP }, { x: dockX, y: DECK_TOP - 18 }];
  for (let k = 0; k <= 32; k++) {
    const a = Math.PI / 2 + dir * (k / 32) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  pts.push({ x: dockX, y: DECK_TOP - 18 }, { x: dockX, y: DECK_TOP });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum.at(-1) };
}

function pointOn(path, u) {
  const d = clamp(u, 0, 1) * path.length;
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < d) i++;
  const a = path.pts[i - 1];
  const b = path.pts[i];
  const seg = path.cum[i] - path.cum[i - 1] || 1;
  const f = (d - path.cum[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// --------------------------------------------------------------- scene --
export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.sparkles = makeSparkles();
    this.hover = null;
    this.lastFrame = null;
    this.setBoats(5);
  }

  // An empty park with `m` boats at their berths.
  setBoats(m) {
    this.m = m;
    this.bg = buildBackground(m);
    this.boats = Array.from({ length: m }, (_, i) => {
      const x = berthX(m, i + 1);
      return { id: i + 1, dockX: x, x, y: DECK_TOP, facing: 1, mode: 'docked', passenger: null,
               pending: null, ended: false, rideEnd: null, path: null, u: 0, u0: 0, segStart: 0, segDur: 1 };
    });
    this.people = new Map();
    this.sim = null;
    this.ms = 50;
    this.sf = 1;
    this.clock0 = performance.now();
    this.stopped = false;
  }

  clock() {
    return performance.now() - this.clock0;
  }

  walk(mult = 1) {
    return WALK_SPEED * this.sf * mult;
  }

  // Feed one engine event (after sim.apply(ev)).
  handle(ev, sim) {
    switch (ev.type) {
      case 'config':
        this.setBoats(ev.boats);
        this.sim = sim;
        this.ms = ev.ms_per_min;
        this.sf = clamp(40 / ev.ms_per_min, 1, 30);
        this.clock0 = performance.now() - ev.t;
        break;

      case 'visitor_arrive': {
        const look = lookFor(ev.visitor);
        const p = {
          id: ev.visitor, look, sprites: personSprites(look),
          x: rand(-16, -4), y: PATH_Y + rand(-3, 3), path: [], speed: this.walk(0.8),
          mode: 'wander', pauseUntil: 0, dist: 0, walking: false, hidden: false,
        };
        p.path.push({ x: GATE_X + rand(0, 10), y: PATH_Y + rand(-2, 2) });
        this.people.set(p.id, p);
        break;
      }

      case 'visitor_wait': {
        const p = this.people.get(ev.visitor);
        if (!p) break;
        // Hurry over: at normal speed the average wait is only a couple of
        // real seconds, so a stroll would arrive after their boat was ready.
        const dist = Math.abs(p.x - (QUEUE.x0 - 6)) + Math.abs(p.y - PATH_Y);
        p.mode = 'toQueue';
        p.speed = Math.max(this.walk(2), dist / 1000);
        p.path = [{ x: QUEUE.x0 - 6, y: PATH_Y }];
        break;
      }

      case 'claim': {
        const p = this.people.get(ev.visitor);
        const boat = this.boats[ev.boat - 1];
        if (!p || !boat) break;
        const v = sim.visitors.get(ev.visitor);
        const rideMs = (v?.ride ?? 30) * this.ms;
        const job = { pid: p.id, budget: clamp(rideMs * 0.4, 60, 2500), rideEnd: null, ended: false };
        // The engine can hand a boat its next visitor while the previous
        // ride is still rowing back on screen. Then the new visitor walks
        // to the berth and boards once the boat has docked and unloaded.
        if (boat.mode === 'docked') {
          this.beginBoarding(boat, job);
        } else {
          boat.pending = job;
          p.mode = 'toBoat';
          p.speed = this.walk(2.2);
          p.path = [{ x: p.x, y: DECK_Y }, { x: boat.dockX + 6, y: DECK_Y }];
        }
        break;
      }

      case 'ride_start': {
        const job = this.jobFor(ev.boat, ev.visitor);
        if (job) job.rideEnd = ev.t + ev.ride * this.ms;
        break;
      }

      case 'ride_end': {
        const boat = this.boats[ev.boat - 1];
        const job = this.jobFor(ev.boat, ev.visitor);
        if (!job) break;
        job.ended = true;
        if (job === boat) {
          if (boat.mode === 'out') this.hurryBack(boat);
          else if (boat.mode === 'back') this.disembark(boat);
        }
        break;
      }

      default:
        break;
    }
  }

  // The booking for this visitor on this boat: the current ride (the boat
  // itself holds it) or the next one waiting for the boat to come back.
  jobFor(boatId, visitorId) {
    const boat = this.boats[boatId - 1];
    if (!boat) return null;
    if (boat.pending?.pid === visitorId) return boat.pending;
    if (boat.passenger === visitorId) return boat;
    return null;
  }

  beginBoarding(boat, job) {
    const p = this.people.get(job.pid);
    boat.mode = 'boarding';
    boat.passenger = job.pid;
    boat.boardBy = this.clock() + job.budget;
    boat.rideEnd = job.rideEnd;
    boat.ended = job.ended;
    if (!p) return;
    const dist = Math.abs(p.y - DECK_Y) + Math.abs(p.x - boat.dockX);
    p.mode = 'toBoat';
    p.path = [{ x: p.x, y: DECK_Y }, { x: boat.dockX, y: DECK_Y }];
    p.speed = Math.max(this.walk(2.2), dist / (job.budget * 0.85));
  }

  // The run was stopped: send everyone home and bring the boats in.
  stopRun() {
    this.stopped = true;
    for (const boat of this.boats) {
      boat.pending = null;
      if (boat.mode === 'boarding') {
        boat.mode = 'docked';
        boat.passenger = null;
      } else if (boat.mode === 'out') {
        boat.ended = true;
        this.hurryBack(boat);
      } else if (boat.mode === 'back') {
        this.disembark(boat);
      }
    }
    for (const p of this.people.values()) {
      if (p.mode === 'aboard') continue;
      this.sendHome(p);
    }
  }

  sendHome(p) {
    p.mode = 'exit';
    p.speed = this.walk(1.4);
    p.path = p.y < PARK_TOP
      ? [{ x: -10, y: DECK_Y }]
      : [{ x: GATE_X, y: PATH_Y }, { x: -10, y: PATH_Y }];
  }

  hurryBack(boat) {
    boat.u0 = boat.u;
    boat.segStart = this.clock();
    boat.segDur = 350;
  }

  disembark(boat) {
    const p = this.people.get(boat.passenger);
    boat.mode = 'docked';
    boat.passenger = null;
    boat.x = boat.dockX;
    boat.y = DECK_TOP;
    if (p) {
      p.hidden = false;
      p.x = boat.dockX;
      p.y = DECK_Y;
      p.mode = 'exit';
      p.speed = this.walk(1.6);
      p.path = [{ x: -10, y: DECK_Y }];
    }
    if (boat.pending && !this.stopped) {
      const job = boat.pending;
      boat.pending = null;
      this.beginBoarding(boat, job);
    }
  }

  update(dt) {
    const now = this.clock();
    const queueIndex = new Map();
    if (this.sim) this.sim.waiting.forEach((id, i) => queueIndex.set(id, i));

    for (const p of this.people.values()) {
      if (p.mode === 'aboard') continue;
      if (p.mode === 'queue') {
        const i = queueIndex.get(p.id);
        if (i !== undefined) {
          const slot = queueSlot(i);
          p.path = [slot];
          p.speed = this.walk(1.2);
        }
      }
      this.move(p, dt);
      if (p.path.length === 0) {
        if (p.mode === 'wander' && !this.stopped) {
          if (p.pauseUntil === 0) p.pauseUntil = now + rand(300, 1800) / this.sf;
          else if (now >= p.pauseUntil) {
            p.pauseUntil = 0;
            p.speed = this.walk(0.6);
            p.path = [{ x: rand(WANDER.x0, WANDER.x1), y: rand(WANDER.y0, WANDER.y1) }];
          }
        } else if (p.mode === 'toQueue') {
          p.mode = 'queue';
        } else if (p.mode === 'exit') {
          this.people.delete(p.id);
        }
      }
    }

    for (const boat of this.boats) {
      if (boat.mode === 'boarding') {
        const p = this.people.get(boat.passenger);
        const arrived = p && p.mode === 'toBoat' && p.path.length === 0;
        if (!p) {
          boat.mode = 'docked';
        } else if (arrived || now >= boat.boardBy) {
          p.mode = 'aboard';
          p.hidden = true;
          p.path = [];
          boat.mode = 'out';
          boat.path = ridePath(boat.dockX);
          boat.u = 0;
          boat.u0 = 0;
          boat.segStart = now;
          boat.segDur = boat.ended ? 200 : Math.max(150, (boat.rideEnd ?? now + 1000) - now);
        }
      } else if (boat.mode === 'out') {
        const u = boat.u0 + (1 - boat.u0) * clamp((now - boat.segStart) / boat.segDur, 0, 1);
        const pt = pointOn(boat.path, u);
        if (Math.abs(pt.x - boat.x) > 0.05) boat.facing = pt.x > boat.x ? 1 : -1;
        boat.moving = Math.hypot(pt.x - boat.x, pt.y - boat.y) > 0.01;
        boat.x = pt.x;
        boat.y = pt.y;
        boat.u = u;
        if (u >= 1) {
          boat.facing = 1;
          if (boat.ended) this.disembark(boat);
          else boat.mode = 'back';
        }
      }
    }
  }

  move(p, dt) {
    let budget = p.speed * dt;
    p.walking = false;
    while (budget > 0 && p.path.length) {
      const t = p.path[0];
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        p.x = t.x;
        p.y = t.y;
        p.path.shift();
        budget -= d;
        p.dist += d;
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        p.dist += budget;
        budget = 0;
      }
      p.walking = true;
    }
  }

  frame(nowPerf) {
    const dt = this.lastFrame === null ? 16 : clamp(nowPerf - this.lastFrame, 0, 50);
    this.lastFrame = nowPerf;
    this.update(dt);
    this.draw(nowPerf);
  }

  draw(t) {
    const g = this.g;
    g.drawImage(this.bg, 0, 0);

    g.fillStyle = C.sparkle;
    for (const s of this.sparkles) {
      if ((t / s.period + s.phase) % 1 < 0.16) g.fillRect(s.x, s.y, s.len, 1);
    }

    // Ride counter plaque under each berth.
    for (const boat of this.boats) {
      const rides = this.sim ? this.sim.boats[boat.id - 1]?.rides ?? 0 : 0;
      const text = String(rides);
      const w = textWidth(text);
      const x = Math.round(boat.dockX - w / 2);
      g.fillStyle = C.woodDeep;
      g.fillRect(x - 1, 175, w + 3, 8);
      g.fillStyle = C.cream;
      g.fillRect(x - 2, 174, w + 3, 7);
      drawText(g, text, x, 175, C.ink);
    }

    // Everything else is drawn back to front by its base y.
    const items = [];
    const p = propSprites();
    for (const prop of PROPS) items.push({ y: prop.y, draw: () => this.drawProp(prop, p) });
    for (const d of DUCKS) {
      const a = (t / d.period + d.phase) * Math.PI * 2;
      const x = d.cx + d.rx * Math.cos(a);
      const y = d.cy + d.ry * Math.sin(a);
      const right = -Math.sin(a) > 0;
      items.push({ y, draw: () => {
        g.fillStyle = C.waterLight;
        g.fillRect(Math.round(x) - 4, Math.round(y) + 1, 8, 1);
        g.drawImage(right ? p.duckRight : p.duckLeft, Math.round(x) - 3, Math.round(y) - 4);
      } });
    }
    for (const boat of this.boats) items.push({ y: boat.y, draw: () => this.drawBoat(boat, t) });
    for (const person of this.people.values()) {
      if (!person.hidden) items.push({ y: person.y, draw: () => this.drawPerson(person) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    if (this.hover) this.drawHover();
  }

  drawProp(prop, p) {
    const g = this.g;
    if (prop.kind === 'tree') {
      g.fillStyle = 'rgba(0,0,0,0.15)';
      g.fillRect(prop.x - 5, prop.y, 11, 1);
      g.drawImage(p.tree, prop.x - 6, prop.y - 13);
    } else if (prop.kind === 'bush') g.drawImage(p.bush, prop.x - 4, prop.y - 5);
    else if (prop.kind === 'bench') g.drawImage(p.bench, prop.x - 5, prop.y - 6);
    else if (prop.kind === 'lamp') g.drawImage(p.lamp, prop.x - 1, prop.y - 12);
  }

  drawPerson(person) {
    const g = this.g;
    const x = Math.round(person.x) - 2;
    const y = Math.round(person.y) - 8;
    const s = person.sprites;
    const sprite = person.walking ? (Math.floor(person.dist / 3) % 2 ? s.walkA : s.walkB) : s.stand;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x, y + 8, 5, 1);
    g.drawImage(sprite, x, y);
  }

  drawBoat(boat, t) {
    const g = this.g;
    const sprites = boatSprites(boat.id);
    const docked = boat.mode !== 'out';
    const bob = docked && (t / 700 + boat.id * 0.37) % 1 < 0.5 ? 1 : 0;
    const x = Math.round(boat.x) - BOAT_W / 2;
    const y = Math.round(boat.y) - BOAT_H + bob;
    const right = boat.facing > 0;

    if (!docked) {
      g.fillStyle = C.waterShadow;
      g.fillRect(x + 2, y + BOAT_H, BOAT_W - 4, 1);
    }
    if (boat.mode === 'out' && boat.moving) {
      const flick = Math.floor(t / 160) % 2;
      g.fillStyle = C.sparkle;
      const sx = right ? x - 2 : x + BOAT_W;
      g.fillRect(sx, y + BOAT_H - 2, 2, 1);
      g.fillRect(right ? sx - 3 - flick : sx + 2 + flick, y + BOAT_H - 1, 2, 1);
    }
    g.drawImage(right ? sprites.right : sprites.left, x, y);

    const passenger = this.people.get(boat.passenger);
    if (passenger && passenger.mode === 'aboard') {
      // Head and shirt of the rower, sitting on the seat.
      g.drawImage(passenger.sprites.stand, 0, 0, 5, 4, x + (right ? 6 : 7), y - 2, 5, 4);
      if (boat.mode === 'out') {
        const frame = Math.floor(t / 180) % 2;
        const oar = frame ? [[7, 2], [7, 3], [6, 4], [6, 5], [5, 6], [5, 7], [4, 7]]
                          : [[6, 2], [5, 3], [4, 4], [3, 5], [2, 6], [1, 7], [0, 7]];
        g.fillStyle = C.woodDeep;
        for (const [ox, oy] of oar) g.fillRect(x + (right ? ox : BOAT_W - 1 - ox), y + oy, 1, 1);
      }
    }
  }

  // ---------------------------------------------------------- hovering --
  boxOf(item) {
    if (item.kind === 'boat') {
      const b = this.boats[item.id - 1];
      return b && { x0: b.x - 10, y0: b.y - 10, x1: b.x + 10, y1: b.y + 2 };
    }
    const p = this.people.get(item.id);
    return p && !p.hidden && { x0: p.x - 3, y0: p.y - 9, x1: p.x + 3, y1: p.y + 1 };
  }

  hitTest(x, y) {
    let best = null;
    let bestY = -Infinity;
    const consider = (item, baseY) => {
      const box = this.boxOf(item);
      if (box && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && baseY > bestY) {
        best = item;
        bestY = baseY;
      }
    };
    for (const b of this.boats) consider({ kind: 'boat', id: b.id }, b.y);
    for (const p of this.people.values()) if (!p.hidden) consider({ kind: 'visitor', id: p.id }, p.y);
    return best;
  }

  drawHover() {
    const box = this.boxOf(this.hover);
    if (!box) return;
    const g = this.g;
    const x0 = Math.round(box.x0) - 1;
    const y0 = Math.round(box.y0) - 1;
    const x1 = Math.round(box.x1) + 1;
    const y1 = Math.round(box.y1) + 1;
    g.fillStyle = '#ffffff';
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.fillRect(cx, cy, 1, 1);
      g.fillRect(cx + dx, cy, 1, 1);
      g.fillRect(cx, cy + dy, 1, 1);
    }
  }
}
