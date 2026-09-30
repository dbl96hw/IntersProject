"""Adaptive parallelism: decide *whether* and *how much* to parallelise, given
the machine's CPUs **and** RAM (see system.py).

Time model (Amdahl's law with per-task overhead and per-worker start-up)
------------------------------------------------------------------------
For n independent tasks with single-worker costs t_i (seconds),

    T1 = sum_i t_i,      t_i = f + b_i / theta    for file reads of b_i bytes

where f is a fixed per-task overhead (open, sniff, dtype inference: Python code
that holds the GIL) and theta the throughput of the compiled parser. With p
workers of start-up cost c and serial fraction s,

    T(p) = c * p + T1 * (s + (1 - s) / p)          for p >= 2
    T(1) = T1                                        (inline, no start-up)

The serial fraction follows from the model instead of being guessed:
    * threads:   s = (GIL-bound share of the work)  e.g. n * f / T1 for parsers
    * processes: s = s_proc (result transfer and concatenation only)
The speed-up T1 / T(p) saturates at 1 / s (diminishing returns per extra core)
and eventually decreases because of the c * p term; the continuous optimum is
p* = sqrt(T1 (1 - s) / c).

Memory model
------------
Each in-flight task holds roughly  m_i = expansion(kind) * b_i  bytes (pandas
objects are several times larger than the file; a 300-dpi page raster for OCR
is ~25 MB regardless of file size). With a budget B (a fraction of available
RAM), at most  p_mem = floor(B / max_i m_i)  tasks may run at once. So

    p in [1, min(usable CPUs, n, p_mem)]

and if even one task exceeds B the plan says so explicitly (use streaming /
DuckDB for that file) instead of letting the machine swap.

Decision rule: take the executor and p with the smallest predicted time, and
only leave the inline path if the predicted gain is at least `min_gain` (20 %),
a margin that absorbs model error.

Measured check on the hackathon mocks (7 CSV files, ~390 KB, 2 CPUs): inline
50 ms vs 2 threads 57 ms. The model predicts no worthwhile gain and stays
inline, which matches the measurement. Use `karp_flatt` with your own timings
to re-estimate s on other hardware.
"""

from __future__ import annotations

import math
import os
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Callable, Iterable, Sequence, TypeVar

from .system import HardwareProfile, probe

T = TypeVar("T")
R = TypeVar("R")

# Per kind: single-worker throughput of the compiled part (bytes/s), fixed
# per-task overhead (s), GIL behaviour and in-memory expansion factor.
THROUGHPUT = {"csv": 30e6, "xlsx": 2e6, "json": 20e6, "parquet": 300e6, "pdf": 1.5e6,
              "docx": 5e6, "html": 10e6, "ocr": 0.4e6}
PER_FILE_OVERHEAD = {"csv": 5e-3, "xlsx": 20e-3, "json": 2e-3, "parquet": 3e-3, "pdf": 30e-3,
                     "docx": 10e-3, "html": 5e-3, "ocr": 1.5}
# Pure-Python parsers hold the GIL -> threads give no speed-up. OCR runs in an
# external Tesseract process, so threads parallelise it perfectly well.
GIL_BOUND = {"csv": False, "parquet": False, "xlsx": True, "json": True, "pdf": True,
             "docx": True, "html": False, "ocr": False}
MEM_EXPANSION = {"csv": 8.0, "xlsx": 20.0, "json": 6.0, "parquet": 4.0, "pdf": 5.0,
                 "docx": 10.0, "html": 6.0, "ocr": 5.0}
MEM_FIXED = {"ocr": 60e6, "pdf": 20e6}  # per-task floor (page rasters, parser state)
STARTUP_SECONDS = {"thread": 1e-4, "process": 0.12 if os.name == "nt" else 0.06}
PROCESS_SERIAL_FRACTION = 0.05
MIN_GAIN = 0.20


@dataclass(frozen=True)
class ParallelPlan:
    workers: int
    executor: str  # "inline" | "thread" | "process"
    predicted_serial_s: float
    predicted_parallel_s: float
    serial_fraction: float
    startup_s: float
    reason: str
    cpu_limit: int = 1
    memory_limit: int = 1
    peak_task_memory_bytes: int = 0
    memory_budget_bytes: int = 0
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return asdict(self)


def available_cpus() -> int:
    """CPUs this process may actually use (affinity + container quota)."""
    return probe().usable_cpus


def predicted_time(p: int, t1: float, s: float, c: float) -> float:
    """Amdahl time with start-up cost; p = 1 runs inline with no start-up."""
    if p <= 1:
        return t1
    return c * p + t1 * (s + (1.0 - s) / p)


def karp_flatt(speedup: float, p: int) -> float:
    """Experimentally determined serial fraction e = (1/psi - 1/p) / (1 - 1/p).

    e > 1 means parallel overhead exceeds any gain (the run got slower).
    """
    if p <= 1:
        raise ValueError("Karp-Flatt needs p >= 2")
    return (1.0 / speedup - 1.0 / p) / (1.0 - 1.0 / p)


def _best_p(t1: float, s: float, c: float, p_max: int) -> int:
    if p_max < 2:
        return 1
    p_star = math.sqrt(t1 * (1.0 - s) / c) if c > 0 else p_max
    # T(p) is convex for p >= 2: checking the integers around p* is exact.
    candidates = {2, p_max, max(2, min(p_max, math.floor(p_star))), max(2, min(p_max, math.ceil(p_star)))}
    return min(candidates, key=lambda p: predicted_time(p, t1, s, c))


def task_memory(size_bytes: int, kind: str) -> float:
    return max(MEM_FIXED.get(kind, 0.0), MEM_EXPANSION.get(kind, 8.0) * size_bytes)


def plan_tasks(costs: Sequence[float], gil_share: float, peak_memory: Sequence[float],
               gil_bound: bool = False, hw: HardwareProfile | None = None, min_gain: float = MIN_GAIN,
               thread_cpus: int | None = None) -> ParallelPlan:
    """Generic planner: task costs (s), GIL-bound share of the work, per-task peak memory (bytes)."""
    hw = hw or probe()
    n = len(costs)
    t1 = float(sum(costs))
    cpu_limit = max(1, min(thread_cpus or hw.io_threads(), n))
    peak = float(max(peak_memory)) if peak_memory else 0.0
    budget = hw.memory_budget_bytes
    mem_limit = max(1, int(budget // peak)) if peak > 0 else cpu_limit
    warnings: list[str] = []
    if peak > budget:
        warnings.append(f"largest task needs ~{peak / 2**20:.0f} MB, above the {budget / 2**20:.0f} MB "
                        f"memory budget: read it in streaming mode (DuckDB) or raise DATA_ENGINE_MEMORY_FRACTION")
    p_max = max(1, min(cpu_limit, mem_limit))
    common = dict(cpu_limit=cpu_limit, memory_limit=mem_limit, peak_task_memory_bytes=int(peak),
                  memory_budget_bytes=int(budget), warnings=tuple(warnings))

    options: list[tuple[str, int, float, float, float]] = []  # (executor, p, time, s, c)
    if not gil_bound:
        s, c = min(1.0, max(0.0, gil_share)), STARTUP_SECONDS["thread"]
        p = _best_p(t1, s, c, p_max)
        options.append(("thread", p, predicted_time(p, t1, s, c), s, c))
    s, c = PROCESS_SERIAL_FRACTION, STARTUP_SECONDS["process"]
    p = _best_p(t1, s, c, p_max)
    options.append(("process", p, predicted_time(p, t1, s, c), s, c))

    executor, p, t_par, s, c = min(options, key=lambda o: o[2])
    gain = 1.0 - t_par / t1 if t1 > 0 else 0.0
    limits = f"limits: {cpu_limit} by CPU, {mem_limit} by RAM"
    if p < 2 or gain < min_gain:
        return ParallelPlan(1, "inline", t1, t1, s, c,
                            f"inline: best option ({p} {executor} workers, {t_par * 1e3:.1f} ms) gains "
                            f"{gain:.0%} over {t1 * 1e3:.1f} ms serial, below the {min_gain:.0%} margin ({limits})",
                            **common)
    return ParallelPlan(p, executor, t1, t_par, s, c,
                        f"{p} {executor} workers: predicted {t_par * 1e3:.1f} ms vs {t1 * 1e3:.1f} ms serial "
                        f"(speed-up {t1 / t_par:.2f}x, Amdahl ceiling {1 / max(s, 1e-9):.1f}x; {limits})",
                        **common)


def plan(task_sizes: Sequence[int], kind: str = "csv", cpus: int | None = None,
         min_gain: float = MIN_GAIN, hw: HardwareProfile | None = None) -> ParallelPlan:
    """Plan a batch of file reads of one dominant kind (sizes in bytes)."""
    f = PER_FILE_OVERHEAD.get(kind, PER_FILE_OVERHEAD["csv"])
    theta = THROUGHPUT.get(kind, THROUGHPUT["csv"])
    costs = [f + b / theta for b in task_sizes]
    t1 = sum(costs)
    gil_share = (len(costs) * f / t1) if t1 > 0 else 1.0
    return plan_tasks(costs, gil_share, [task_memory(b, kind) for b in task_sizes],
                      gil_bound=GIL_BOUND.get(kind, False), hw=hw, min_gain=min_gain, thread_cpus=cpus)


def run(fn: Callable[[T], R], items: Iterable[T], decision: ParallelPlan) -> list[R]:
    """Execute `fn` over `items` according to a ParallelPlan, preserving order."""
    items = list(items)
    if decision.executor == "inline" or decision.workers <= 1:
        return [fn(x) for x in items]
    pool_cls = ThreadPoolExecutor if decision.executor == "thread" else ProcessPoolExecutor
    with pool_cls(max_workers=decision.workers) as pool:
        return list(pool.map(fn, items))
