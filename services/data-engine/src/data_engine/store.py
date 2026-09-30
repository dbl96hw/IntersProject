"""Persistent, queryable snapshot of the engine state.

Why: the engine rebuilds in memory from the source files, which is exact but
means nothing survives a restart. A snapshot freezes one build so it can be
queried with SQL (DuckDB), diffed against a later build, or handed over
without re-running anything:

    <state_dir>/snapshot.duckdb   canonical + reconciled tables, decisions, facts, corrections
    <state_dir>/spectral.npz      eigenbasis (V_k), eigenvalues, mean, feature names
    <state_dir>/snapshot.json     run report (timings, diagnostics, quality summary)

Lossless by construction: the canonical tables are stored as they are (the
spectral basis is an *additional* compact view, never a replacement), so no
information is lost by the compression. Without duckdb the tables fall back to
CSV files in <state_dir>/snapshot/.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .settings import state_dir


def snapshot(engine, directory: str | Path | None = None) -> dict:
    out_dir = Path(directory or state_dir())
    out_dir.mkdir(parents=True, exist_ok=True)
    tables = engine.sql_tables()
    facts = pd.DataFrame([{**{k: v for k, v in f.items() if k != "ids"}, "ids": json.dumps(f["ids"])}
                          for d in engine.documents for f in d.facts])
    tables["document_facts"] = facts
    tables["corrections"] = engine.quality.corrections
    written: dict[str, int] = {}
    try:
        import duckdb
        path = out_dir / "snapshot.duckdb"
        path.unlink(missing_ok=True)
        con = duckdb.connect(str(path))
        try:
            for name, frame in tables.items():
                if frame is None or frame.empty:
                    continue
                safe = frame.copy()
                for c in safe.columns:  # nested python objects -> JSON text
                    if safe[c].map(lambda v: isinstance(v, (dict, list))).any():
                        safe[c] = safe[c].map(json.dumps)
                con.register("tmp_frame", safe)
                con.execute(f'CREATE TABLE "{name}" AS SELECT * FROM tmp_frame')
                con.unregister("tmp_frame")
                written[name] = len(safe)
        finally:
            con.close()
        target = str(path)
    except ImportError:
        csv_dir = out_dir / "snapshot"
        csv_dir.mkdir(exist_ok=True)
        for name, frame in tables.items():
            if frame is not None and not frame.empty:
                frame.to_csv(csv_dir / f"{name}.csv", index=False)
                written[name] = len(frame)
        target = str(csv_dir)
    if engine.spectral is not None:
        np.savez_compressed(out_dir / "spectral.npz", components=engine.spectral.components,
                            eigenvalues=engine.spectral.eigenvalues, mean=engine.spectral.mean,
                            singular_values=engine.spectral.all_singular,
                            feature_names=np.array(engine.spectral.feature_names))
    (out_dir / "snapshot.json").write_text(json.dumps(engine.diagnostics_report(), indent=2, default=str),
                                           encoding="utf-8")
    return {"tables": target, "rows": written, "spectral": str(out_dir / "spectral.npz"),
            "report": str(out_dir / "snapshot.json")}
