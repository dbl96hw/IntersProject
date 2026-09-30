"""From an extracted Document to engine inputs: tables that match a source, and facts.

Tables: the header row is found deterministically (first row whose cells are
mostly non-numeric strings), normalised, and the table is routed through the
same signature detection as any CSV. Tables that match a known source become
ordinary engine inputs (with the document as provenance); the rest are kept as
unclassified evidence rather than guessed.

Text: patterns.extract_facts pulls (id, field, value, unit) with the sentence
it came from. Facts are shown to the breeder as document evidence; they never
change a colour (the engine cannot verify a sentence in a PDF the way it
verifies a row in an export).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

from .. import detect as det
from ..ingest import RawTable
from ..patterns import extract_facts
from . import Document

_NUMERIC = re.compile(r"^-?\d+(?:[.,]\d+)?%?$")


def _header_row(frame: pd.DataFrame, max_scan: int = 5) -> int | None:
    for i in range(min(max_scan, len(frame))):
        cells = [str(c).strip() for c in frame.iloc[i].tolist() if c is not None and str(c).strip() not in ("", "nan", "None")]
        if len(cells) >= max(2, frame.shape[1] // 2) and sum(bool(_NUMERIC.match(c)) for c in cells) <= len(cells) // 4:
            return i
    return None


def normalise_table(frame: pd.DataFrame) -> pd.DataFrame | None:
    if not isinstance(frame.columns, pd.RangeIndex):
        # The parser already promoted a header (e.g. <th> cells in HTML): put it back as row 0
        # so every source goes through the same header detection.
        cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in frame.columns]
        frame = pd.concat([pd.DataFrame([cols]), pd.DataFrame(frame.to_numpy())], ignore_index=True)
    h = _header_row(frame)
    if h is None:
        return None
    body = frame.iloc[h + 1:].reset_index(drop=True)
    body.columns = [str(c).strip().upper().replace(" ", "_").replace("-", "_") for c in frame.iloc[h].tolist()]
    body = body.loc[:, [c for c in body.columns if c and c != "NONE"]]
    # numbers written with decimal commas or units in cells -> numeric where the whole column parses
    for c in body.columns:
        parsed = pd.to_numeric(body[c].astype(str).str.replace(",", ".", regex=False).str.rstrip("%"), errors="coerce")
        if parsed.notna().mean() > 0.9:
            body[c] = parsed
    return body


@dataclass
class DocumentIngestion:
    document: dict
    accepted_tables: list[RawTable] = field(default_factory=list)
    unclassified_tables: list[dict] = field(default_factory=list)
    facts: list[dict] = field(default_factory=list)

    def summary(self) -> dict:
        return {**self.document,
                "tables_accepted": [{"table": t.name, "source": t.meta.get("source"), "rows": len(t.frame)}
                                    for t in self.accepted_tables],
                "tables_unclassified": self.unclassified_tables,
                "facts": len(self.facts),
                "facts_with_values": sum(1 for f in self.facts if f["field"]),
                "entities_mentioned": sorted({i for f in self.facts for ids in f["ids"].values() for i in ids})[:50]}


def structure(doc: Document, id_patterns=None) -> DocumentIngestion:
    out = DocumentIngestion(doc.summary())
    name = doc.path.replace("\\", "/").rsplit("/", 1)[-1]
    for i, t in enumerate(doc.tables):
        table = normalise_table(t["frame"])
        label = f"{name}#table{i + 1}(p{t['page']})"
        if table is None or table.empty:
            out.unclassified_tables.append({"table": label, "reason": "no header row found"})
            continue
        d = det.detect(list(table.columns))
        if d.confident:
            out.accepted_tables.append(RawTable(label, table, doc.path, sheet=str(t["page"]),
                                                meta={"source": d.source, "from_document": True}))
        else:
            out.unclassified_tables.append({"table": label, "reason": "no known source signature",
                                            "columns": list(table.columns)[:20], "best_guess": d.source,
                                            "score": d.score, "runner_up": d.runner_up})
    for page, text in enumerate(doc.pages_text, start=1):
        out.facts.extend(extract_facts(text, source=name, page=page, id_patterns=id_patterns))
    return out
