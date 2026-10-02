"""Append-only override log: the breeder has the last word, and it is recorded.

Each override stores who, when, what the engine said, what the breeder decided,
why (a reason code from a fixed list plus free text) and the rule version in
force. The engine's own verdict is never modified: the effective colour shown
is the latest override, and the disagreement itself becomes data (a future
"disagreements panel", and input for the SME to refine the rules).

Storage is a JSON-Lines file (one immutable record per line). The interface is
deliberately tiny so a Supabase/Postgres adapter can replace it without
touching the engine.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

REASON_CODES = {
    "FIELD_OBSERVATION": "Breeder saw something in the field the data does not capture",
    "DATA_ERROR": "The underlying data is wrong or incomplete",
    "MARKET_FIT": "Commercial / market considerations",
    "PEDIGREE_KNOWLEDGE": "Knowledge of the line's pedigree or crosses",
    "ENVIRONMENT_CONTEXT": "Unusual season, location or disease pressure",
    "STRATEGIC_KEEP": "Kept for a breeding-programme reason (e.g. donor of a trait)",
    "OTHER": "Other (explain in the comment)",
}
COLOURS = {"GREEN", "AMBER", "RED"}


@dataclass(frozen=True)
class Override:
    id: str
    timestamp_utc: str
    user: str
    level: str                 # candidate | trial
    record: str                # candidate_id or TRIAL_ID
    engine_colour: str
    new_colour: str
    reason_code: str
    comment: str
    rule_version: str


class OverrideLog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def record(self, *, user: str, level: str, record: str, engine_colour: str, new_colour: str,
               reason_code: str, comment: str, rule_version: str) -> Override:
        if new_colour not in COLOURS:
            raise ValueError(f"new_colour must be one of {sorted(COLOURS)}")
        if reason_code not in REASON_CODES:
            raise ValueError(f"reason_code must be one of {sorted(REASON_CODES)}")
        if reason_code == "OTHER" and not comment.strip():
            raise ValueError("reason_code OTHER requires a comment")
        entry = Override(str(uuid.uuid4()), datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         user or "unknown", level, record, engine_colour, new_colour, reason_code,
                         comment.strip(), rule_version)
        with self._lock, open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(entry)) + "\n")
        return entry

    def all(self) -> list[Override]:
        if not self.path.exists():
            return []
        with open(self.path, encoding="utf-8") as fh:
            return [Override(**json.loads(line)) for line in fh if line.strip()]

    def latest(self) -> dict[tuple[str, str], Override]:
        """Most recent override per (level, record).

        Cached by the file's (mtime, size): the table view asks this once per candidate, and the log
        only changes on append, so re-reading it 150 times per request is pure waste.
        """
        try:
            st = self.path.stat()
            stamp = (st.st_mtime_ns, st.st_size)
        except FileNotFoundError:
            stamp = None
        cached = getattr(self, "_latest_cache", None)
        if cached is not None and cached[0] == stamp:
            return cached[1]
        out: dict[tuple[str, str], Override] = {}
        for o in self.all():
            out[(o.level, o.record)] = o
        self._latest_cache = (stamp, out)
        return out
