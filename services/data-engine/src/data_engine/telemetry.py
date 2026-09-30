"""Run telemetry: how long each stage took, what it cost, and what it produced.

Every engine build is recorded as one JSON document under
`<state_dir>/runs/run-<UTC timestamp>.json` (and `latest.json`), with:

* hardware profile (CPUs, RAM, budget) and the parallel / accelerator plans;
* per stage: wall time, CPU time (process), CPU utilisation (cpu/wall, >1 means
  real parallelism), resident memory before/after, Python heap peak
  (tracemalloc), rows in/out and free-form metrics;
* the diagnostics report (numerical error, integrity, drift, topology).

Why wall AND cpu time: wall time is what the user waits for; cpu/wall tells
whether the time was spent computing (~1 per busy core) or waiting on I/O (<1).
tracemalloc only sees Python allocations (NumPy buffers included), so RSS is
reported too for the native side (C++ / Julia / Tesseract).
"""

from __future__ import annotations

import json
import os
import time
import tracemalloc
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .system import current_rss_bytes, probe

KEEP_RUNS = int(os.environ.get("DATA_ENGINE_KEEP_RUNS", 50))
# Python-heap profiling (tracemalloc) is exact but slows allocation-heavy code ~3-4x,
# so it is opt-in; resident memory (RSS) is always recorded.
TRACE_MEMORY = os.environ.get("DATA_ENGINE_TRACEMALLOC", "0") == "1"


@dataclass
class StageRecord:
    name: str
    wall_s: float = 0.0
    cpu_s: float = 0.0
    cpu_utilisation: float = 0.0
    rss_before_mb: float | None = None
    rss_after_mb: float | None = None
    py_heap_peak_mb: float | None = None
    rows_in: int | None = None
    rows_out: int | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class Telemetry:
    def __init__(self) -> None:
        self.started = datetime.now(timezone.utc)
        self.stages: list[StageRecord] = []
        self.context: dict[str, Any] = {"hardware": probe().as_dict()}
        self._t0 = time.perf_counter()
        self._c0 = time.process_time()

    @contextmanager
    def stage(self, name: str, rows_in: int | None = None) -> Iterator[StageRecord]:
        rec = StageRecord(name=name, rows_in=rows_in)
        rss = current_rss_bytes()
        rec.rss_before_mb = round(rss / 2**20, 2) if rss else None
        tracing = TRACE_MEMORY and not tracemalloc.is_tracing()
        if tracing:
            tracemalloc.start()
        elif TRACE_MEMORY:
            tracemalloc.reset_peak()
        w0, c0 = time.perf_counter(), time.process_time()
        try:
            yield rec
        except Exception as exc:  # record, then re-raise: telemetry never hides failures
            rec.error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            rec.wall_s = round(time.perf_counter() - w0, 6)
            rec.cpu_s = round(time.process_time() - c0, 6)
            rec.cpu_utilisation = round(rec.cpu_s / rec.wall_s, 3) if rec.wall_s > 0 else 0.0
            if TRACE_MEMORY:
                rec.py_heap_peak_mb = round(tracemalloc.get_traced_memory()[1] / 2**20, 3)
                if tracing:
                    tracemalloc.stop()
            rss = current_rss_bytes()
            rec.rss_after_mb = round(rss / 2**20, 2) if rss else None
            self.stages.append(rec)

    def summary(self) -> dict[str, Any]:
        wall = time.perf_counter() - self._t0
        cpu = time.process_time() - self._c0
        slowest = sorted(self.stages, key=lambda s: s.wall_s, reverse=True)[:3]
        return {"total_wall_s": round(wall, 4), "total_cpu_s": round(cpu, 4),
                "cpu_utilisation": round(cpu / wall, 3) if wall > 0 else 0.0,
                "peak_rss_mb": max((s.rss_after_mb or 0) for s in self.stages) if self.stages else None,
                "slowest_stages": [{"stage": s.name, "wall_s": s.wall_s,
                                    "share": round(s.wall_s / wall, 3) if wall else 0} for s in slowest]}

    def as_dict(self) -> dict[str, Any]:
        return {"started_utc": self.started.isoformat(timespec="seconds"), **self.context,
                "summary": self.summary(), "stages": [asdict(s) for s in self.stages]}

    def save(self, directory: Path, extra: dict[str, Any] | None = None) -> Path:
        """Write run-<ts>.json + latest.json and prune old runs."""
        directory.mkdir(parents=True, exist_ok=True)
        doc = {**self.as_dict(), **(extra or {})}
        stamp = self.started.strftime("%Y%m%dT%H%M%S%fZ")
        path = directory / f"run-{stamp}.json"
        text = json.dumps(doc, indent=2, default=str)
        path.write_text(text, encoding="utf-8")
        (directory / "latest.json").write_text(text, encoding="utf-8")
        runs = sorted(directory.glob("run-*.json"))
        for old in runs[:-KEEP_RUNS]:
            old.unlink(missing_ok=True)
        return path


def previous_run(directory: Path, exclude: Path | None = None) -> dict | None:
    """Most recent saved run other than `exclude` (for drift comparison)."""
    runs = [p for p in sorted(directory.glob("run-*.json")) if p != exclude]
    if not runs:
        return None
    try:
        return json.loads(runs[-1].read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
