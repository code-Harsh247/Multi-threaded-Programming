// The simulation's state, rebuilt purely from the engine's event stream.
// No DOM here, so it runs (and is unit-tested) in Node as well.

export class Sim {
  constructor() {
    this.reset();
  }

  reset() {
    this.config = null;
    this.boats = [];             // index = boat id - 1
    this.visitors = new Map();   // id -> visitor record
    this.waiting = [];           // visitor ids at the jetty, in the order they arrived there
    this.counts = { sightseeing: 0, waiting: 0, riding: 0, left: 0 };
    this.waitTotal = 0;          // simulated minutes, summed over visitors who got a boat
    this.waitCount = 0;
    this.maxWait = 0;
    this.series = [];            // [simulated minute, people waiting] after each change
    this.lastT = 0;              // latest event time (real ms since start)
    this.done = false;
    this.error = null;
  }

  get msPerMin() {
    return this.config ? this.config.ms_per_min : 1;
  }

  minutes(t) {
    return t / this.msPerMin;
  }

  get avgWait() {
    return this.waitCount ? this.waitTotal / this.waitCount : 0;
  }

  apply(ev) {
    if (typeof ev.t === 'number') this.lastT = Math.max(this.lastT, ev.t);
    const v = ev.visitor !== undefined ? this.visitors.get(ev.visitor) : undefined;
    const b = ev.boat !== undefined ? this.boats[ev.boat - 1] : undefined;

    switch (ev.type) {
      case 'config':
        this.reset();
        this.config = ev;
        this.lastT = ev.t;
        this.boats = Array.from({ length: ev.boats }, (_, i) => ({
          id: i + 1, ready: false, rides: 0, visitor: null, rideStartT: null, ride: null,
        }));
        this.series.push([0, 0]);
        break;

      case 'boat_ready':
        if (b) b.ready = true;
        break;

      case 'visitor_arrive':
        this.visitors.set(ev.visitor, {
          id: ev.visitor, sight: ev.sight, ride: ev.ride, state: 'sightseeing',
          arriveT: ev.t, waitT: null, claimT: null, rideStartT: null, rideEndT: null, leaveT: null,
          boat: null,
        });
        this.counts.sightseeing++;
        break;

      case 'visitor_wait':
        if (!v) break;
        v.state = 'waiting';
        v.waitT = ev.t;
        this.waiting.push(v.id);
        this.counts.sightseeing--;
        this.counts.waiting++;
        this.series.push([this.minutes(ev.t), this.counts.waiting]);
        break;

      case 'claim': {
        if (!v) break;
        v.state = 'boarding';
        v.claimT = ev.t;
        v.boat = ev.boat;
        const i = this.waiting.indexOf(v.id);
        if (i >= 0) this.waiting.splice(i, 1);
        this.counts.waiting--;
        const waited = this.minutes(ev.t - v.waitT);
        this.waitTotal += waited;
        this.waitCount++;
        this.maxWait = Math.max(this.maxWait, waited);
        this.series.push([this.minutes(ev.t), this.counts.waiting]);
        break;
      }

      case 'ride_start':
        if (b) {
          b.visitor = ev.visitor;
          b.rideStartT = ev.t;
          b.ride = ev.ride;
          b.rides++;
        }
        if (v) {
          v.state = 'riding';
          v.rideStartT = ev.t;
        }
        this.counts.riding++;
        break;

      case 'ride_end':
        if (b) {
          b.visitor = null;
          b.rideStartT = null;
          b.ride = null;
        }
        if (v) v.rideEndT = ev.t;
        this.counts.riding--;
        break;

      case 'visitor_leave':
        if (!v) break;
        v.state = 'left';
        v.leaveT = ev.t;
        this.counts.left++;
        break;

      case 'done':
        this.done = true;
        break;

      case 'error':
        this.error = ev.message;
        break;

      default:
        break;
    }
    return ev;
  }
}

// Park opens at 9:00 AM; one simulated minute per minute after that.
export function clockText(minutes) {
  const total = 9 * 60 + Math.floor(minutes);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
