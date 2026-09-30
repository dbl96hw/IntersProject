"""Hardware probe: what this machine can actually give us (CPUs, RAM, limits).

Every resource decision in the engine (Python workers, C++ threads, Julia
threads, chunk sizes) is derived from this single profile, so the same code
adapts to a 2-core laptop, a 64-core server or a memory-capped container.

Principles
* Use what the process may *actually* use: CPU affinity and cgroup limits
  (containers) override the raw hardware numbers.
* Compute-bound native loops (C++ / Julia floating-point kernels) scale with
  *physical* cores; hyper-threads mostly compete for the same FP units.
  I/O-bound or GIL-releasing work may use the *logical* CPUs.
* Never plan to use all available RAM: a fraction (default 50 %) is the
  budget, the rest is headroom for the OS, the API server and the LLM client.

No hard dependency: psutil is used when installed, otherwise /proc (Linux),
sysctl (macOS) or the Win32 API (Windows) are queried directly.
"""

from __future__ import annotations

import ctypes
import os
import platform
import subprocess
import sys
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

MEMORY_FRACTION = float(os.environ.get("DATA_ENGINE_MEMORY_FRACTION", 0.5))


@dataclass(frozen=True)
class HardwareProfile:
    platform: str
    python: str
    logical_cpus: int          # os.cpu_count()
    usable_cpus: int           # respecting affinity / cgroup CPU quota
    physical_cores: int        # best estimate of real cores
    ram_total_bytes: int
    ram_available_bytes: int   # at probe time, capped by the cgroup limit if any
    cgroup_memory_limit_bytes: int | None
    memory_budget_bytes: int   # MEMORY_FRACTION of available RAM

    def compute_threads(self) -> int:
        """Threads for compute-bound native kernels (C++ / Julia)."""
        return max(1, min(self.physical_cores, self.usable_cpus))

    def io_threads(self) -> int:
        """Threads for I/O-bound or GIL-releasing work."""
        return max(1, self.usable_cpus)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["ram_total_gb"] = round(self.ram_total_bytes / 2**30, 2)
        d["ram_available_gb"] = round(self.ram_available_bytes / 2**30, 2)
        d["memory_budget_gb"] = round(self.memory_budget_bytes / 2**30, 2)
        d["compute_threads"] = self.compute_threads()
        d["io_threads"] = self.io_threads()
        return d


# --------------------------------------------------------------------------- CPUs
def _usable_cpus() -> int:
    try:
        n = len(os.sched_getaffinity(0))  # Linux: respects taskset / container cpusets
    except AttributeError:
        n = os.cpu_count() or 1
    quota = _cgroup_cpu_quota()
    return max(1, min(n, quota)) if quota else n


def _cgroup_cpu_quota() -> int | None:
    """CPU quota of a Linux container (cgroup v2 'cpu.max'), rounded up."""
    try:
        raw = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if raw and raw[0] != "max":
            return max(1, -(-int(raw[0]) // int(raw[1])))
    except (OSError, ValueError, IndexError):
        pass
    return None


def _physical_cores(logical: int) -> int:
    try:
        import psutil  # type: ignore
        n = psutil.cpu_count(logical=False)
        if n:
            return n
    except ImportError:
        pass
    if sys.platform.startswith("linux"):
        try:
            pairs = set()
            phys = core = None
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("physical id"):
                    phys = line.split(":")[1].strip()
                elif line.startswith("core id"):
                    core = line.split(":")[1].strip()
                    pairs.add((phys, core))
            if pairs:
                return len(pairs)
        except OSError:
            pass
    if sys.platform == "darwin":
        try:
            return int(subprocess.check_output(["sysctl", "-n", "hw.physicalcpu"]).strip())
        except (OSError, ValueError, subprocess.CalledProcessError):
            pass
    return logical  # conservative fallback: assume no SMT


# --------------------------------------------------------------------------- RAM
def _cgroup_memory_limit() -> int | None:
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            raw = Path(path).read_text().strip()
            if raw != "max" and int(raw) < 2**60:
                return int(raw)
        except (OSError, ValueError):
            continue
    return None


def _ram() -> tuple[int, int]:
    """(total, available) in bytes."""
    try:
        import psutil  # type: ignore
        vm = psutil.virtual_memory()
        return int(vm.total), int(vm.available)
    except ImportError:
        pass
    if sys.platform.startswith("linux"):
        info = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, rest = line.partition(":")
            info[key] = int(rest.split()[0]) * 1024
        return info["MemTotal"], info.get("MemAvailable", info["MemFree"])
    if sys.platform == "win32":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))  # type: ignore[attr-defined]
        return int(stat.ullTotalPhys), int(stat.ullAvailPhys)
    if sys.platform == "darwin":
        total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip())
        return total, total // 2  # macOS has no cheap "available": assume half
    return 8 * 2**30, 4 * 2**30  # unknown platform: conservative defaults


@lru_cache(maxsize=1)
def probe() -> HardwareProfile:
    """Probe once per process (hardware does not change under us)."""
    logical = os.cpu_count() or 1
    usable = _usable_cpus()
    total, available = _ram()
    limit = _cgroup_memory_limit()
    if limit:
        total, available = min(total, limit), min(available, limit)
    return HardwareProfile(
        platform=f"{platform.system()} {platform.machine()}",
        python=platform.python_version(),
        logical_cpus=logical,
        usable_cpus=usable,
        physical_cores=min(_physical_cores(logical), logical),
        ram_total_bytes=total,
        ram_available_bytes=available,
        cgroup_memory_limit_bytes=limit,
        memory_budget_bytes=int(available * MEMORY_FRACTION),
    )


def current_rss_bytes() -> int | None:
    """Resident memory of this process (for telemetry)."""
    try:
        import psutil  # type: ignore
        return int(psutil.Process().memory_info().rss)
    except ImportError:
        pass
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except OSError:
        pass
    return None
