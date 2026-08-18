# Footanical Barden — Boating Simulation

CS39002 Operating Systems Laboratory — Lab Assignment 7 (`LA7.pdf`).

A multithreaded simulation of `m` boats and `n` visitors sharing a
lake at Footanical Barden. Each visitor sightsees for a random time,
then queues for a boat ride of a random duration; each boat serves
visitors one after another for the whole day. Synchronization is
built entirely from pthreads primitives: mutexes, barriers, and a
counting semaphore implemented from scratch on top of a condition
variable (no System V or POSIX semaphores, per the assignment spec).

## Requirements

- A C compiler (`gcc`) and `make`
- A pthreads implementation (glibc on Linux/WSL, or MinGW-w64 on
  Windows)

## Build

```bash
make
```

Produces the `boating` executable.

## Run

```bash
./boating <m> <n>
```

- `m` — number of boats, `5 <= m <= 10`
- `n` — number of visitors, `20 <= n <= 100`

Or via make, with sensible defaults (`m=5 n=20`):

```bash
make run
make run M=8 N=50
```

## Clean

```bash
make clean
```

## Design notes

- `semaphore` is a `{ value, mutex, condvar }` struct; `P()`/`V()`
  implement the standard negative-value counting-semaphore algorithm
  (Dragon Book §6.2.2) on top of a condition variable, guarding
  against spurious wakeups with a `while` re-check.
- Each boat publishes its availability through shared arrays
  (`BA`/`BC`/`BT`) protected by a single mutex, then rendezvous with
  the visitor that claims it via a per-boat `pthread_barrier_t`. This
  lets any free boat pair with any waiting visitor without fixing the
  pairing in advance.
- A boat only publishes its availability *after* it has actually
  acquired a rendezvous token, which is what keeps the handshake
  race-free under heavy contention (verified under `m=5, n=100` and
  other high-load combinations across repeated runs).
- Main waits on an `EOS` (end-of-simulation) barrier that the last
  boat to finish a ride also reaches, then cancels and joins any
  remaining idle boat threads before tearing down synchronization
  objects.

## Sample output

```
Boat    1    Ready
Boat    2    Ready
Visitor 1    Starts sightseeing for  58 minutes
Visitor 1    Ready to ride a boat (ride time =  22)
Visitor 1    Finds boat  2
Boat    2    Start of ride for visiter   1
Boat    2    End of ride for visiter   1 (ride time =  22)
Visitor 1    Leaving
...
--- All visitors have left ---
```
