"""Layer 2: deterministic source detection by header signature.

Why deterministic: classifying a table is a set-inclusion question on its
headers, which has an exact, auditable answer. Sending it to an LLM would add
cost, latency and a non-zero error rate for no gain. The LLM (or a human) is
only consulted for tables that match no known signature (score < min_score).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .settings import load_yaml

UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class Detection:
    source: str               # logical source name or UNKNOWN
    score: float              # signature recall in [0, 1]
    variant: int              # which signature variant matched (schema version)
    matched: tuple[str, ...]
    missing: tuple[str, ...]
    runner_up: str | None
    runner_up_score: float

    @property
    def confident(self) -> bool:
        return self.source != UNKNOWN

    def as_dict(self) -> dict:
        return asdict(self)


def detect(columns: list[str], config: dict | None = None) -> Detection:
    """Return the best-matching source for a set of (normalised) column names."""
    config = config or load_yaml("sources")
    headers = {c.strip().upper() for c in columns}
    scored: list[tuple[float, str, int, set[str]]] = []
    for name, spec in config["sources"].items():
        for i, signature in enumerate(spec["variants"]):
            sig = set(signature)
            scored.append((len(headers & sig) / len(sig), name, i, sig))
    scored.sort(key=lambda t: t[0], reverse=True)

    best_score, best_name, best_variant, best_sig = scored[0]
    runner = next((t for t in scored[1:] if t[1] != best_name), None)
    source = best_name if best_score >= config["min_score"] else UNKNOWN
    return Detection(
        source=source,
        score=round(best_score, 3),
        variant=best_variant,
        matched=tuple(sorted(headers & best_sig)),
        missing=tuple(sorted(best_sig - headers)),
        runner_up=runner[1] if runner else None,
        runner_up_score=round(runner[0], 3) if runner else 0.0,
    )


def canonical_key(column: str, config: dict | None = None) -> str | None:
    """Map an alias (e.g. GID) to its canonical key (MATERIAL_GUID), if any."""
    config = config or load_yaml("sources")
    for key, aliases in config["keys"].items():
        if column.upper() in aliases:
            return key
    return None
