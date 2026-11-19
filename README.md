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
