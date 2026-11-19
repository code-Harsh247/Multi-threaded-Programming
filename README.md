# Boating Simulator

A resource scheduler in C that dynamically allocates a pool of shared
resources (boats) among many concurrent client threads (visitors).

**Live demo: [boats.129-225-109-238.sslip.io](https://boats.129-225-109-238.sslip.io)**:
pick the number of boats and visitors, open the park, and watch every
thread's events animated live in pixel art.

## How it works

```
Browser ──POST /api/run──▶ Node.js server ──spawns──▶ boating (C, pthreads)
   ▲                            │                     m boat threads
   └──── NDJSON event stream ◀──┘◀── JSON events ───  n visitor threads
```

- **The engine (`boating.c`)** runs one POSIX thread per boat (5–20) and
  per visitor (20–200). A visitor sightsees, waits for a boat, rides,
  and leaves. Any free boat takes any waiting visitor, decided at
  runtime. Every state change is printed as a JSON event.
- **The server (`web/`)** runs the engine once per request and streams
  its events straight to the browser. Guard rails cap run length and
  the number of runs per visitor and server-wide.
- **The frontend (`web/public/`)** turns the stream into a pixel-art
  lake, jetty and park, with live stats, a queue chart and hover info.
  All the art is drawn in code.

## Highlights

- **A counting semaphore built from scratch** on a mutex and a
  condition variable, with no OS semaphores. It is correct under
  spurious wakeups and with condition queues that aren't FIFO.
- **A race-free boat/visitor handshake.** Semaphores count who is
  ready, one mutex makes "scan and claim a boat" atomic, and a
  per-boat barrier makes the boat start only after its visitor's
  ride time is written.
- **A clean shutdown.** The last boat meets `main` on a barrier, then
  idle boats are woken to exit on their own, every thread is joined,
  and only then are the primitives destroyed.
- **Tested:** 40 automated tests (server, API, engine/server limit
  parity, and the frontend state model replaying real runs), plus
  stress batches of 65 runs across the full range with 0 failures.

## Repository layout

| Path | What it is |
|---|---|
| `boating.c`, `Makefile` | the C simulation engine |
| `tests/check_events.py` | validates an engine run's event stream |
| `web/src/` | Express server: limits, process runner, routes |
| `web/public/` | the pixel-art frontend (plain ES modules, no build step) |
| `web/test/` | `node --test` suites |
| `Dockerfile`, `deploy/` | container image and VM deployment (Caddy + Docker Compose) |

## Run it locally

Needs `gcc`, `make`, a pthreads implementation (glibc on Linux or
MinGW-w64 on Windows), Node.js 22+, and Python 3 for `make check`.

```bash
make                        # build the engine
cd web && npm install
npm start                   # http://localhost:3000
npm test
```

Or with Docker: `docker build -t boating-web . && docker run -p 3000:3000 boating-web`.

## The engine

```bash
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
and validates it with `tests/check_events.py`.

It prints one JSON object per line on stdout, flushed immediately and
in non-decreasing time order. `t` is real milliseconds since start;
ids start at 1.

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

## The web server

| Route | Purpose |
|---|---|
| `GET /api/limits` | allowed range and default for every setting, plus `maxRunSeconds` |
| `POST /api/run` | JSON body `{boats, visitors, msPerMin, sightMin, sightMax, rideMin, rideMax}` (all optional); responds with the engine's events as an NDJSON stream |
| `GET /healthz` | `ok` |
| `/debug.html` | the raw event stream, unanimated |

- The engine is started with an argument list, never a shell, and is
  killed when the client aborts, the run times out, or the server stops.
- Read the stream with `fetch` and stop a run with an
  `AbortController`. EventSource would reconnect when the stream ends
  and start a new run.
- Bad settings get `400`. So does a run whose worst-case time exceeds
  the limit, with the estimate included. Too many runs get `429` (per
  visitor) or `503` (server-wide).
- The browser imports the server's own `src/limits.js`, so validation
  and the run-time estimate exist in one place.

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

## Deployment

The live demo runs on an Oracle Cloud Ampere VM: Docker Compose behind
a shared Caddy proxy that handles HTTPS, set up so the same VM can host
other projects. [`deploy/README.md`](deploy/README.md) covers the
first deploy, updates, and adding another project.

## Background

This started as Lab Assignment 7 of CS39002 (Operating Systems
Laboratory), `LA7.pdf`. The original assignment-format version, which
prints plain text, is commit `6ec87f0`.
