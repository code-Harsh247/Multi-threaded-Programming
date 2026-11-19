#!/usr/bin/env python3
"""Validate the JSON event stream printed by `boating`.

Usage:
    ./boating --boats 8 --visitors 50 --ms-per-min 5 | python3 tests/check_events.py
    python3 tests/check_events.py run.jsonl

Exits 0 if the run is correct, 1 otherwise. Timing that runs longer than
expected is reported as a warning only: a busy machine can delay a thread,
but a sleep can never be shorter than requested.
"""
import json
import sys
from collections import defaultdict

VISITOR_EVENTS = ("visitor_arrive", "visitor_wait", "claim",
                  "ride_start", "ride_end", "visitor_leave")
EARLY_SLACK_MS = 18   # clock rounding + coarse OS timers (Windows ticks are ~15.6 ms)


def check(lines):
    problems, warnings = [], []

    events = []
    for i, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            problems.append(f"line {i} is not valid JSON: {line[:80]}")
    if problems:
        return problems, warnings, None
    if not events:
        return ["no output"], warnings, None

    errors = [e for e in events if e.get("type") == "error"]
    if errors:
        return [f"program reported an error: {errors[0].get('message')}"], warnings, None

    cfg = events[0]
    if cfg.get("type") != "config":
        return ["first event is not 'config'"], warnings, None
    if events[-1].get("type") != "done":
        problems.append("last event is not 'done' (run did not finish)")

    m, n, ms = cfg["boats"], cfg["visitors"], cfg["ms_per_min"]
    smin, smax = cfg["sight"]
    rmin, rmax = cfg["ride"]

    # Time never goes backwards.
    for a, b in zip(events, events[1:]):
        if b["t"] < a["t"]:
            problems.append(f"time went backwards: {a} then {b}")
            break

    # Boats announce themselves exactly once.
    ready = [e["boat"] for e in events if e["type"] == "boat_ready"]
    if sorted(ready) != list(range(1, m + 1)):
        problems.append(f"boat_ready events {sorted(ready)} != boats 1..{m}")
    ready_at = {e["boat"]: idx for idx, e in enumerate(events) if e["type"] == "boat_ready"}

    # Each visitor: exactly one of each event, in causal order.
    seen = defaultdict(dict)    # visitor -> event type -> (index, event)
    for idx, e in enumerate(events):
        if e["type"] in VISITOR_EVENTS:
            v = e["visitor"]
            if e["type"] in seen[v]:
                problems.append(f"visitor {v} has more than one '{e['type']}'")
            seen[v][e["type"]] = (idx, e)
    if sorted(seen) != list(range(1, n + 1)):
        problems.append(f"visitors seen {len(seen)} != {n}")

    waits = []
    for v, ev in seen.items():
        missing = [t for t in VISITOR_EVENTS if t not in ev]
        if missing:
            problems.append(f"visitor {v} is missing {missing}")
            continue
        i = {t: ev[t][0] for t in VISITOR_EVENTS}
        e = {t: ev[t][1] for t in VISITOR_EVENTS}
        if not (i["visitor_arrive"] < i["visitor_wait"] < i["claim"] < i["ride_start"]):
            problems.append(f"visitor {v}: arrive/wait/claim/ride_start out of order")
        if not (i["ride_start"] < i["ride_end"] and i["ride_start"] < i["visitor_leave"]):
            problems.append(f"visitor {v}: ended or left before the ride started")
        b = e["claim"]["boat"]
        if not (e["ride_start"]["boat"] == b == e["ride_end"]["boat"]):
            problems.append(f"visitor {v}: claimed boat {b} but rode another")
        if b in ready_at and ready_at[b] > i["claim"]:
            problems.append(f"visitor {v}: claimed boat {b} before it was ready")
        sight, ride = e["visitor_arrive"]["sight"], e["visitor_arrive"]["ride"]
        if not smin <= sight <= smax:
            problems.append(f"visitor {v}: sight {sight} outside [{smin},{smax}]")
        if not rmin <= ride <= rmax:
            problems.append(f"visitor {v}: ride {ride} outside [{rmin},{rmax}]")
        if e["ride_start"]["ride"] != ride:
            problems.append(f"visitor {v}: boat used ride {e['ride_start']['ride']}, visitor chose {ride}")

        for label, start, end, minutes in (
                ("sightseeing", "visitor_arrive", "visitor_wait", sight),
                ("ride", "ride_start", "ride_end", ride)):
            expected = minutes * ms
            took = e[end]["t"] - e[start]["t"]
            if took < expected - EARLY_SLACK_MS:
                problems.append(f"visitor {v}: {label} took {took} ms, expected {expected}")
            elif took > expected * 1.5 + 250:
                warnings.append(f"visitor {v}: {label} took {took} ms, expected {expected}")
        waits.append((e["claim"]["t"] - e["visitor_wait"]["t"]) / ms)

    # A boat carries one visitor at a time.
    riding = {}
    rides_per_boat = defaultdict(int)
    for e in events:
        if e["type"] == "ride_start":
            if riding.get(e["boat"]) is not None:
                problems.append(f"boat {e['boat']} started a ride while busy")
            riding[e["boat"]] = e["visitor"]
            rides_per_boat[e["boat"]] += 1
        elif e["type"] == "ride_end":
            if riding.get(e["boat"]) != e["visitor"]:
                problems.append(f"boat {e['boat']} ended a ride it was not giving")
            riding[e["boat"]] = None

    if events[-1].get("type") == "done" and events[-1].get("rides") != n:
        problems.append(f"done reports {events[-1].get('rides')} rides, expected {n}")

    summary = {
        "boats": m, "visitors": n, "ms_per_min": ms, "events": len(events),
        "run_ms": events[-1]["t"],
        "avg_wait_min": round(sum(waits) / len(waits), 1) if waits else None,
        "rides_per_boat": [rides_per_boat[b] for b in range(1, m + 1)],
    }
    return problems, warnings, summary


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            lines = f.readlines()
    else:
        lines = sys.stdin.readlines()

    problems, warnings, summary = check(lines)
    for w in warnings[:10]:
        print("WARN", w)
    if problems:
        for p in problems[:20]:
            print("FAIL", p)
        sys.exit(1)
    print("OK", json.dumps(summary))


if __name__ == "__main__":
    main()
