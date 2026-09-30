"""Optional compiled back-ends for large, dense workloads (C++ and Julia).

What is accelerated, and why only this
--------------------------------------
Dense linear algebra (SVD, matrix products) already runs in compiled
LAPACK/BLAS through NumPy, so rewriting it in C++ or Julia buys nothing. The
operation that *does* benefit is k-nearest-neighbour search over n candidates:

* NumPy computes all squared distances as ||a||^2 + ||b||^2 - 2 a.b with a GEMM.
  Fast, but it materialises an (rows x m) block; we size the block from the RAM
  budget so it never exceeds it (more passes on small machines, fewer on big).
* The C++ / Julia kernels stream over B and keep a size-k heap per query row:
  O(n k) memory, one pass, no temporary matrix, and they run on all physical
  cores. That is the regime where a compiled loop wins (millions of candidates).

Hardware awareness (see system.py)
* C++: thread count = physical cores usable by the process (FP-bound loop).
* Julia: the thread count is fixed at Julia start-up, so PYTHON_JULIACALL_THREADS
  is set from the same probe *before* juliacall is imported.
* NumPy: chunk rows = memory budget / (bytes per row of the distance block).
  BLAS threading is left to the BLAS library (it already uses all cores).

Dispatch (`knn`): numpy for n*m <= DENSE_LIMIT (the demo is 150 x 150),
otherwise the first available of C++ -> Julia -> chunked NumPy. All back-ends
return identical results (tested), so the choice only affects time and memory.

Building: `python -m data_engine.accel.build` compiles the C++ kernels with
g++/clang++ (or MSVC `cl` on Windows). Nothing is compiled at import time.
"""

from __future__ import annotations

import ctypes
import os
import sys
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..system import probe

DENSE_LIMIT = int(os.environ.get("DATA_ENGINE_DENSE_LIMIT", 25_000_000))  # n*m pairs
_HERE = Path(__file__).resolve().parent
LAST_RUN: dict = {}  # telemetry of the most recent knn call (backend, threads, chunk, seconds)


def lib_path(name: str = "knn") -> Path:
    from ..settings import lib_dir
    ext = {"win32": "dll", "darwin": "dylib"}.get(sys.platform, "so")
    return lib_dir() / f"{name}.{ext}"


@lru_cache(maxsize=1)
def _cpp():
    path = lib_path()
    if not path.exists():
        return None
    lib = ctypes.CDLL(str(path))
    dbl_p = ctypes.POINTER(ctypes.c_double)
    lib.knn_sqeuclidean.argtypes = [dbl_p, ctypes.c_long, dbl_p, ctypes.c_long, ctypes.c_long,
                                    ctypes.c_long, ctypes.POINTER(ctypes.c_long), dbl_p, ctypes.c_long]
    lib.knn_sqeuclidean.restype = None
    return lib


def julia_enabled() -> bool:
    """Only touch Julia when it is really there (or explicitly enabled).

    Importing juliacall without a Julia install makes it try to download one,
    which is slow and fails behind restricted networks, so we never do that
    implicitly.
    """
    if os.environ.get("DATA_ENGINE_ENABLE_JULIA") == "1":
        return True
    import shutil
    return bool(shutil.which("julia") or os.environ.get("PYTHON_JULIAPKG_EXE"))


@lru_cache(maxsize=1)
def _julia():
    if not julia_enabled():
        return None
    # Julia fixes its thread count at start-up: set it from the probe first.
    os.environ.setdefault("PYTHON_JULIACALL_THREADS", str(probe().compute_threads()))
    try:
        from juliacall import Main as jl  # type: ignore
        jl.include(str(_HERE / "knn.jl"))
    except Exception:
        return None
    return jl


def available() -> dict[str, bool]:
    return {"numpy": True, "cpp": _cpp() is not None, "julia": _julia() is not None}


def numpy_chunk_rows(m: int, budget_bytes: int | None = None) -> int:
    """Rows of A per GEMM block so that the (rows x m) float64 work arrays fit the RAM budget.

    Per row we hold ~3 float64 arrays of length m (distances, partition buffer,
    gathered values) -> 24 m bytes.
    """
    budget = budget_bytes or probe().memory_budget_bytes
    return int(max(1, min(65_536, budget // max(1, 24 * m))))


def _knn_numpy(a: np.ndarray, b: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    k = min(k, b.shape[0])
    rows = numpy_chunk_rows(b.shape[0])
    bb = np.einsum("ij,ij->i", b, b)
    idx = np.empty((a.shape[0], k), dtype=np.int64)
    dist = np.empty((a.shape[0], k))
    for start in range(0, a.shape[0], rows):
        block = a[start:start + rows]
        d2 = np.einsum("ij,ij->i", block, block)[:, None] + bb[None, :] - 2.0 * block @ b.T
        np.maximum(d2, 0.0, out=d2)  # clamp round-off below zero
        part = np.argpartition(d2, k - 1, axis=1)[:, :k]
        pd_ = np.take_along_axis(d2, part, axis=1)
        order = np.argsort(pd_, axis=1, kind="stable")
        idx[start:start + len(block)] = np.take_along_axis(part, order, axis=1)
        dist[start:start + len(block)] = np.take_along_axis(pd_, order, axis=1)
    LAST_RUN.update(chunk_rows=rows)
    return idx, dist


def _knn_cpp(a: np.ndarray, b: np.ndarray, k: int, threads: int) -> tuple[np.ndarray, np.ndarray]:
    lib = _cpp()
    a = np.ascontiguousarray(a, dtype=np.float64)
    b = np.ascontiguousarray(b, dtype=np.float64)
    k = min(k, b.shape[0])
    c_long_np = np.int64 if ctypes.sizeof(ctypes.c_long) == 8 else np.int32  # c_long is 32-bit on Windows
    idx = np.empty((a.shape[0], k), dtype=c_long_np)
    dist = np.empty((a.shape[0], k), dtype=np.float64)
    dbl_p = ctypes.POINTER(ctypes.c_double)
    lib.knn_sqeuclidean(a.ctypes.data_as(dbl_p), a.shape[0], b.ctypes.data_as(dbl_p), b.shape[0], a.shape[1], k,
                        idx.ctypes.data_as(ctypes.POINTER(ctypes.c_long)), dist.ctypes.data_as(dbl_p), threads)
    return idx.astype(np.int64), dist


def _knn_julia(a: np.ndarray, b: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    jl = _julia()
    idx, dist = jl.knn_sqeuclidean(np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64), min(k, b.shape[0]))
    LAST_RUN.update(julia_threads=int(jl.nthreads_used()))
    return np.asarray(idx, dtype=np.int64) - 1, np.asarray(dist)  # Julia is 1-based


def choose_backend(n: int, m: int) -> str:
    if n * m <= DENSE_LIMIT:
        return "numpy"
    avail = available()
    return "cpp" if avail["cpp"] else "julia" if avail["julia"] else "numpy"


def knn(a: np.ndarray, b: np.ndarray, k: int, backend: str | None = None,
        threads: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """For each row of `a`, indices and squared distances of its k nearest rows of `b` (ascending)."""
    backend = backend or choose_backend(a.shape[0], b.shape[0])
    threads = threads or probe().compute_threads()
    LAST_RUN.clear()
    t0 = time.perf_counter()
    if backend == "cpp":
        out = _knn_cpp(a, b, k, threads)
        LAST_RUN.update(cpp_threads=threads)
    elif backend == "julia":
        out = _knn_julia(a, b, k)
    else:
        out = _knn_numpy(a, b, k)
    LAST_RUN.update(backend=backend, n=int(a.shape[0]), m=int(b.shape[0]), d=int(a.shape[1]), k=int(k),
                    seconds=round(time.perf_counter() - t0, 6))
    return out
