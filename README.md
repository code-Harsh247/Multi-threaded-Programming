# Footanical Barden — Boating Simulation

A multithreaded simulation of `m` boats and `n` visitors sharing a
lake. Each visitor sightsees for a random time, then queues for a boat
ride of a random duration; any free boat takes any waiting visitor,
one at a time. Synchronization is built entirely from pthreads
primitives: mutexes, barriers, and a counting semaphore implemented
from scratch on top of a condition variable.

Started as CS39002 Operating Systems Lab Assignment 7 (`LA7.pdf`).
This version is the engine for a web simulator: it takes settings as
flags and prints a stream of JSON events. The original
assignment-format version is commit `6ec87f0`.

## Requirements

- `gcc` and `make`
- A pthreads implementation (glibc on Linux, or MinGW-w64 on Windows)
- Python 3, only for `make check`

## Build and run

```bash
make
./boating --boats 8 --visitors 50 --ms-per-min 20
```

| Flag | Meaning | Default | Allowed |
|---|---|---|---|
| `--boats N` | number of boats | 5 | 5–20 |
| `--visitors N` | number of visitors | 20 | 20–200 |
| `--ms-per-min N` | real milliseconds per simulated minute | 100 | 1–200 |
| `--sight-min N`, `--sight-max N` | sightseeing time range (minutes) | 30, 120 | 1–240 |
| `--ride-min N`, `--ride-max N` | ride time range (minutes) | 15, 60 | 1–120 |

Via make: `make run M=8 N=50 SPEED=20`. `make check` does a fast run
and validates its output with `tests/check_events.py`.

## Output

One JSON object per line on stdout, flushed immediately and in
non-decreasing time order. `t` is real milliseconds since start; ids
start at 1.

```
{"type":"config","t":0,"boats":8,"visitors":50,"ms_per_min":20,"sight":[30,120],"ride":[15,60]}
{"type":"boat_ready","t":0,"boat":3}
{"type":"visitor_arrive","t":0,"visitor":7,"sight":71,"ride":36}
{"type":"visitor_wait","t":1420,"visitor":7}
{"type":"claim","t":1421,"visitor":7,"boat":3}
{"type":"ride_start","t":1421,"boat":3,"visitor":7,"ride":36}
{"type":"ride_end","t":2141,"boat":3,"visitor":7}
{"type":"visitor_leave","t":2141,"visitor":7}
{"type":"done","t":9876,"rides":50}
```

| Event | Meaning |
|---|---|
| `config` | the settings in use (always first) |
| `boat_ready` | a boat thread has started |
| `visitor_arrive` | a visitor starts sightseeing; carries its `sight` and `ride` times |
| `visitor_wait` | sightseeing is over; the visitor is waiting at the jetty |
| `claim` | the visitor has claimed a free boat |
| `ride_start` / `ride_end` | the boat's ride with that visitor |
| `visitor_leave` | the visitor has left (can come just before or after `ride_end`) |
| `done` | every ride is finished and every thread has exited (always last) |
| `error` | bad arguments (exit code 2) or a thread could not start (exit code 1) |

## Web server

`web/` is a Node.js (22+) + Express server that runs the engine once
per request and streams its events to the browser.

```bash
make                       # build the engine first
cd web && npm install
npm start                  # http://localhost:3000
npm test
```

`http://localhost:3000` is the simulator: a pixel-art lake, jetty and
park strip where the event stream is animated live.
- **Visitors:** they wander the park while sightseeing, queue in a
  switchback pen, walk to the boat they claimed, row a loop timed to
  their ride, and walk home.
- **Around the scene:** settings, a stats panel with a park clock, a
  queue-length chart, a ride counter at every berth, and hover info for
  any visitor or boat.
- **Art:** all of it is drawn in code from palette grids
  (`public/js/sprites.js`); there are no image files.
- **Raw events:** `/debug.html` shows the stream unanimated.

Frontend code (plain ES modules in `web/public/js`, no build step):

| File | Role |
|---|---|
| `sim.js` | state model built from the events (counts, queue order, waits); tested in Node |
| `scene.js` | the animated canvas: background, people, boats, hit-testing |
| `sprites.js`, `font.js` | pixel art and a 3×5 digit font |
| `chart.js` | queue-length chart |
| `main.js` | settings form, streaming, stats, tooltips |
| `/js/limits.js` | served from `src/limits.js`, so the browser validates with the server's own rules |

| Route | Purpose |
|---|---|
| `GET /api/limits` | allowed range and default for every setting, plus `maxRunSeconds` |
| `POST /api/run` | JSON body `{boats, visitors, msPerMin, sightMin, sightMax, rideMin, rideMax}` (all optional); responds with the engine's events as an NDJSON stream |
| `GET /healthz` | `ok` |

- Read the stream with `fetch` and stop a run with an
  `AbortController`. EventSource would reconnect when the stream ends
  and start a new run.
- Bad settings get `400`. So does a run whose worst-case time exceeds
  the limit, with the estimate included.
- Too many runs get `429` (per visitor) or `503` (server-wide). A run
  that overruns is killed, and the stream ends with a
  `{"type":"error","message":"run timed out"}` line.

Configuration (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | port to listen on |
| `BOATING_BIN` | `../boating` | path to the engine |
| `MAX_CONCURRENT_RUNS` | 4 | simulations at once, server-wide |
| `MAX_RUNS_PER_IP` | 1 | simulations at once, per visitor |
| `RUNS_PER_MINUTE_PER_IP` | 20 | simulations started per minute, per visitor |
| `MAX_RUN_SECONDS` | 180 | longest allowed worst-case run |
| `TRUST_PROXY` | off | set to `1` behind a hosting proxy so visitor IPs are correct |

`docker build -t boating-web . && docker run -p 3000:3000 boating-web`
builds the engine on Linux and runs the server as a non-root user.
To host it on a VM behind HTTPS (alongside other projects), see
[`deploy/README.md`](deploy/README.md).

## Design notes

- `semaphore` is a `{ value, mutex, condvar }` struct. `P()` waits
  `while value <= 0`, then decrements; `V()` increments and signals.
  The `while` re-check makes it safe under spurious wakeups and
  without assuming the condition queue is FIFO.
- A boat first takes a token from the `boat` semaphore, then
  publishes itself in shared arrays (`BA`/`BC`/`BT`, guarded by one
  mutex), signals `rider`, and meets the visitor that claims it on a
  per-boat `pthread_barrier_t`. This lets any free boat pair with any
  waiting visitor without fixing the pairing in advance.
- Visitors' random times are drawn in `main`, because `rand()` is not
  thread-safe.
- Main waits on an end-of-simulation barrier with the boat that
  finishes the last ride, then sets a `done` flag, wakes each idle
  boat so it exits on its own, joins every thread, and only then
  destroys the synchronization objects.
- All output goes through one `emit()` helper under its own lock,
  which stamps the time, writes the whole line and flushes it.
