"""Julia document back-end (PDFIO.jl), used when Julia is installed.

Same guard as the Julia kNN kernel: never trigger a Julia download implicitly.
Requires `julia> ] add PDFIO` once. Any failure falls back to the Python
back-ends, and the Document records which back-end was actually used.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_JL_FILE = Path(__file__).resolve().parent / "docs.jl"


@lru_cache(maxsize=1)
def _jl():
    from ..accel import _julia
    jl = _julia()
    if jl is None:
        return None
    try:
        jl.include(str(_JL_FILE))
        return jl if bool(jl.seval("pdfio_loaded()")) else None
    except Exception:
        return None


def julia_pdf_available() -> bool:
    try:
        from ..accel import julia_enabled
        return julia_enabled() and _jl() is not None
    except Exception:
        return False


def julia_pdf_text(path: Path) -> list[str]:
    return [str(p) for p in _jl().pdf_text(str(path))]
