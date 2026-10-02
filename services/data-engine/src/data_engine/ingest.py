"""Layer 1: read any supported input into pandas tables.

Accepted inputs
---------------
* Files: .csv, .tsv (delimiter sniffed), .xlsx/.xlsm (one table per
  sheet), .json (list of records, or {table_name: [records]}), .parquet.
* In-memory records: the structured JSON produced upstream by the Claude-based
  extraction service (PDFs, chat messages) enters through `from_records`, so it
  goes through exactly the same detection / profiling / rules as a file.

Nothing here interprets the data; it only reads it faithfully and records
provenance (file, sheet), which later becomes the "source" in every piece of
evidence shown to the breeder.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from . import parallel

# Tabular inputs. Free-text and binary documents (.pdf, .docx, images, .txt...)
# go through data_engine.documents (text, tables, OCR) instead.
SUPPORTED = {".csv": "csv", ".tsv": "csv", ".xlsx": "xlsx", ".xlsm": "xlsx",
             ".json": "json", ".parquet": "parquet"}


@dataclass
class RawTable:
    """One table as read from its origin, before any interpretation."""

    name: str                 # human label, e.g. "genomics_synthetic.csv" or "book.xlsx#Sheet1"
    frame: pd.DataFrame
    origin: str               # file path or "records:<label>"
    sheet: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def _normalise_headers(df: pd.DataFrame) -> pd.DataFrame:
    """Upper-case, trim and snake-case headers so 'Trial Id ' == 'TRIAL_ID'."""
    df.columns = [str(c).strip().upper().replace(" ", "_").replace("-", "_") for c in df.columns]
    return df


def _read_csv(path: Path) -> list[RawTable]:
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        sample = fh.read(64_000)
    try:
        sep = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        sep = "\t" if path.suffix.lower() == ".tsv" else ","
    df = pd.read_csv(path, sep=sep, encoding="utf-8-sig", low_memory=False)
    return [RawTable(path.name, _normalise_headers(df), str(path), meta={"delimiter": sep})]


def _read_xlsx(path: Path) -> list[RawTable]:
    sheets = pd.read_excel(path, sheet_name=None, engine="openpyxl")
    return [RawTable(f"{path.name}#{name}", _normalise_headers(df), str(path), sheet=name)
            for name, df in sheets.items() if not df.empty]


def _read_json(path: Path) -> list[RawTable]:
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    return from_json_payload(payload, label=path.name, origin=str(path))


def _read_parquet(path: Path) -> list[RawTable]:
    return [RawTable(path.name, _normalise_headers(pd.read_parquet(path)), str(path))]


_READERS = {"csv": _read_csv, "xlsx": _read_xlsx, "json": _read_json, "parquet": _read_parquet}


def read_file(path: str | Path) -> list[RawTable]:
    """Read a single file into one or more RawTables (xlsx -> one per sheet)."""
    path = Path(path)
    kind = SUPPORTED.get(path.suffix.lower())
    if kind is None:
        raise ValueError(f"Unsupported tabular type '{path.suffix}' for {path.name}. "
                         f"Supported: {sorted(SUPPORTED)}. Documents (PDF, DOCX, images...) go through "
                         f"DataEngine.add_document / data_engine.documents.")
    return _READERS[kind](path)


def from_json_payload(payload: Any, label: str, origin: str) -> list[RawTable]:
    """Accept [records] or {table_name: [records]} (the extraction-service contract)."""
    if isinstance(payload, list):
        return [RawTable(label, _normalise_headers(pd.DataFrame(payload)), origin)]
    if isinstance(payload, dict):
        return [RawTable(f"{label}#{name}", _normalise_headers(pd.DataFrame(records)), origin, sheet=name)
                for name, records in payload.items() if isinstance(records, list) and records]
    raise ValueError(f"{label}: JSON must be a list of records or a mapping of table -> records")


def from_records(records: list[dict[str, Any]], label: str) -> RawTable:
    """Entry point for structured records (Express uploads, the Claude extraction service).

    Marked as an upload: such rows never override the exports (see DataEngine._merge_sources).
    """
    return RawTable(label, _normalise_headers(pd.DataFrame(records)), f"records:{label}", meta={"uploaded": True})


def discover(directory: str | Path, recursive: bool = False) -> list[Path]:
    directory = Path(directory)
    pattern = "**/*" if recursive else "*"
    return sorted(p for p in directory.glob(pattern) if p.is_file() and p.suffix.lower() in SUPPORTED)


def load_files(paths: Iterable[str | Path]) -> tuple[list[RawTable], parallel.ParallelPlan]:
    """Read many files with the worker count chosen by the Amdahl policy."""
    paths = [Path(p) for p in paths]
    kinds = [SUPPORTED[p.suffix.lower()] for p in paths]
    # Dominant kind by bytes decides the executor (threads vs processes).
    by_kind: dict[str, int] = {}
    for p, k in zip(paths, kinds):
        by_kind[k] = by_kind.get(k, 0) + p.stat().st_size
    dominant = max(by_kind, key=by_kind.get) if by_kind else "csv"
    decision = parallel.plan([p.stat().st_size for p in paths], kind=dominant)
    nested = parallel.run(read_file, paths, decision)
    return [t for tables in nested for t in tables], decision
