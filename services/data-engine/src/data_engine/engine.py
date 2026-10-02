"""Facade: one object that runs every layer and answers the breeder-facing questions.

Its public methods mirror the MCP tools agreed in the team plan
(query_candidates, get_candidate_profile, compare_candidates, get_lineage,
apply_scoring), so the MCP server, the REST API and the agent tools are thin
wrappers and the agent can only ever cite values that come out of here.

Every build is measured (telemetry.py) and verified (diagnostics.py); the run
report is saved as JSON under <state_dir>/runs/. Expensive, input-determined
steps (the calibration cross-validation) are cached by a content hash of their
inputs, so adding a document or a few records only recomputes what changed.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from . import canonical as canon
from . import detect as det
from . import diagnostics as diag
from . import ingest
from . import profile as prof
from . import quality as qual
from . import relevance as rel
from .audit import REASON_CODES, OverrideLog
from .encode import CANDIDATE_SPECS, encode_frame
from .rules import CandidateRules, Decision, TrialRules
from .settings import data_dir, load_yaml, state_dir
from .spectral import SpectralModel
from .telemetry import Telemetry, previous_run

log = logging.getLogger(__name__)
jsonable = canon.jsonable
_CALIBRATION_CACHE: dict[str, Any] = {}


@dataclass
class IngestedTable:
    name: str
    origin: str
    detection: det.Detection
    profile: prof.TableProfile
    tokens_raw: int
    tokens_renormalized: int
    frame: pd.DataFrame = field(repr=False)


def _frame_hash(df: pd.DataFrame) -> str:
    """Content hash of a table (order-sensitive), used as a cache key."""
    return hashlib.sha256(pd.util.hash_pandas_object(df, index=False).values.tobytes()).hexdigest()


def _trial_counts(trials: list[dict]) -> dict:
    """Counts of the candidate's trials, so an explanation can cite "2 of 5 trials FAIL" instead of
    counting itself. Derived only from `trials` (already in the payload), so it adds no new facts."""
    out = {"total": len(trials), "PASS": 0, "HOLD": 0, "FAIL": 0, "ambiguous": 0, "not_explained_by_data": 0}
    for t in trials:
        if t.get("official_verdict") in ("PASS", "HOLD", "FAIL"):
            out[t["official_verdict"]] += 1
        out["ambiguous"] += bool(t.get("ambiguous"))
        out["not_explained_by_data"] += not t.get("explained_by_data", True)
    return out


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$")


def _canonical_value(v: Any) -> Any:
    """One representation per value, whatever path it took (pandas CSV reader, Express/SheetJS, JSON).

    The same export row arrives as True or "TRUE", 1001 or "1001", "2026-09-21 00:00:00.000" or
    "2026-09-21", and a missing cell as NaN, None or "". Without this, re-uploading an export would
    be reported as hundreds of conflicts. Numbers -> float, booleans -> "bool:true|false",
    ISO dates -> "ts:<isoformat>", empty -> None, anything else -> stripped text.
    """
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, (bool, np.bool_)):
        return f"bool:{bool(v)}".lower()
    if isinstance(v, pd.Timestamp):
        return "ts:" + v.isoformat()
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    s = str(v).strip()
    if s == "" or s.lower() in ("nan", "none", "null", "nat"):
        return None
    if s.lower() in ("true", "false"):
        return f"bool:{s.lower()}"
    try:
        return float(s)
    except ValueError:
        pass
    if _ISO_DATE.match(s):
        try:
            return "ts:" + pd.Timestamp(s).isoformat()
        except ValueError:
            pass
    return s


def _signature_value(v: Any) -> str:
    c = _canonical_value(v)
    return f"{c:.9g}" if isinstance(c, float) else str(c)


_PROFILE_CACHE: dict[str, tuple] = {}
_PROFILE_CACHE_SIZE = 256


def _profiled(frame: pd.DataFrame) -> tuple:
    """Detection + entropy profile + token counts of a table, cached by content.

    These depend only on the table itself, and every ingest rebuilds the engine
    from all raw tables: without the cache, one uploaded row re-profiles every
    export. The key is a content hash (values and column names), so a changed
    table can never reuse a stale profile.
    """
    key = _frame_hash(frame) + "|" + "|".join(map(str, frame.columns))
    if key in _PROFILE_CACHE:
        return (*_PROFILE_CACHE[key], 1)
    d = det.detect(list(frame.columns))
    p = prof.profile_table(frame)
    entry = (d, p, prof.token_estimate(frame), prof.token_estimate(prof.renormalize(frame, p)))
    if len(_PROFILE_CACHE) >= _PROFILE_CACHE_SIZE:
        _PROFILE_CACHE.pop(next(iter(_PROFILE_CACHE)))
    _PROFILE_CACHE[key] = entry
    return (*entry, 0)


def _rejection(ing) -> dict:
    """What is kept about a file that failed the relevance gate: enough to explain, nothing indexed."""
    d = ing.document
    return {"path": d.get("path"), "kind": d.get("kind"), "sha256": d.get("sha256"), "pages": d.get("pages"),
            "relevance": ing.relevance}


class DataEngine:
    def __init__(self, raw_tables: list[ingest.RawTable], parallel_plan: dict | None = None,
                 overrides_path: str | Path | None = None, telemetry: Telemetry | None = None,
                 document_ingestions: list | None = None, export_date: str | None = None,
                 save_runs: bool = True, rejected_documents: list | None = None):
        self.rules_cfg = load_yaml("rules")
        self.parallel_plan = parallel_plan
        self.raw_tables = list(raw_tables)
        self.documents = list(document_ingestions or [])
        self.rejected_documents = list(rejected_documents or [])   # failed the relevance gate; never indexed
        self.export_date = export_date
        self.save_runs = save_runs
        self.overrides = OverrideLog(overrides_path or state_dir() / "overrides.jsonl")
        self._build(telemetry)

    # ------------------------------------------------------------------ build
    @classmethod
    def from_directory(cls, directory: str | Path | None = None, **kw) -> "DataEngine":
        """Read every table and document in a directory (non-recursive) and build the engine."""
        from . import documents as docs
        from .documents.structure import structure

        directory = Path(directory or data_dir())
        tel = Telemetry()
        files = ingest.discover(directory)
        # README / hidden files describe the folder; they are not data.
        doc_files = sorted(p for p in directory.glob("*") if p.is_file() and p.suffix.lower() in docs.DOC_EXTENSIONS
                           and not p.name.lower().startswith(("readme", ".")))
        if not files and not doc_files:
            raise FileNotFoundError(f"No supported files in {directory}. Set DATA_ENGINE_DATA_DIR.")
        with tel.stage("read_tables") as st:
            tables, plan = ingest.load_files(files) if files else ([], None)
            st.rows_out = sum(len(t.frame) for t in tables)
            st.metrics = {"files": len(files), "bytes": sum(p.stat().st_size for p in files),
                          "plan": plan.reason if plan else None}
        ingestions, rejected = [], []
        if doc_files:
            from .patterns import ID_PATTERNS
            known = rel.identifiers(t.frame for t in tables)
            with tel.stage("read_documents") as st:
                for path in doc_files:
                    ing = structure(docs.extract(path))
                    ing.relevance = rel.model().assess(ing.text, [list(t.frame.columns) for t in ing.accepted_tables],
                                                       known, ID_PATTERNS).as_dict()
                    if ing.relevance["decision"] == rel.IRRELEVANT:
                        rejected.append(_rejection(ing))    # same gate as uploads: off-topic files are not indexed
                        continue
                    ingestions.append(ing)
                    tables.extend(ing.accepted_tables)
                st.metrics = {"documents": len(doc_files), "rejected_as_irrelevant": len(rejected),
                              "tables_accepted": sum(len(i.accepted_tables) for i in ingestions),
                              "facts": sum(len(i.facts) for i in ingestions)}
        return cls(tables, parallel_plan=plan.as_dict() if plan else None, telemetry=tel,
                   document_ingestions=ingestions, rejected_documents=rejected, **kw)

    def add_records(self, label: str, records: list[dict[str, Any]]) -> dict:
        """Add structured records (e.g. from the Claude extraction service) and rebuild."""
        table = ingest.from_records(records, label)
        # Unique name per upload so the response reports this call's counts only.
        table.name = f"{label}@{sum(1 for t in self.raw_tables if t.meta.get('uploaded')) + 1}"
        detection = det.detect(list(table.frame.columns))
        if not detection.confident:
            return {"accepted": False, "detection": detection.as_dict(),
                    "message": "no known source matches these fields: needs classification by a human or the LLM"}
        failure = self._rebuild_or_rollback(raw_tables=[*self.raw_tables, table])
        if failure:
            return {"accepted": False, "detection": detection.as_dict(), "rows": len(table.frame),
                    "rows_added": 0, "duplicates_ignored": 0, "conflicts": 0, "conflict_examples": [],
                    "message": failure}
        stats = self.merge_stats.get(table.name, {})
        conflicts = [c for c in self.document_conflicts if c["table"] == table.name]
        return jsonable({"accepted": True, "detection": detection.as_dict(), "rows": len(table.frame),
                         "rows_added": stats.get("added", len(table.frame)),
                         "duplicates_ignored": stats.get("duplicates_ignored", 0),
                         "conflicts": len(conflicts), "conflict_examples": conflicts[:5],
                         "message": (f"{len(conflicts)} row(s) contradict the export and were not applied "
                                     f"(the export wins; see GET /quality)") if conflicts else None,
                         "build_seconds": self.run_report["summary"]["total_wall_s"]})

    def add_document(self, path: str | Path, force: bool = False, document=None) -> dict:
        """OCR / parse a document, check it is about breeding, add its matching tables and facts, rebuild.

        The relevance gate (relevance.py) runs before anything is indexed: an IRRELEVANT file is
        returned with `accepted: false` and its reasons, and the model is not rebuilt. `force=True`
        is the human override ("I know, index it anyway"). An UNCERTAIN file is indexed and flagged
        with `needs_review: true`. `document` lets a caller pass an extraction it already has.
        """
        from . import documents as docs
        from .documents.structure import structure

        tel = Telemetry()
        with tel.stage("read_document") as st:
            ing = structure(document or docs.extract(path), id_patterns=self.id_patterns())
            st.metrics = ing.summary()["backends"] if "backends" in ing.summary() else {}
        with tel.stage("relevance") as st:
            ing.relevance = self.assess_relevance(ing.text, [list(t.frame.columns) for t in ing.accepted_tables])
            st.metrics = {"decision": ing.relevance["decision"], "probability": ing.relevance["probability"]}
        if ing.relevance["decision"] == rel.IRRELEVANT and not force:
            self.rejected_documents.append(_rejection(ing))
            return jsonable({**ing.summary(), "accepted": False, "needs_review": False,
                             "message": "this file does not look like breeding / trial data, so it was not indexed: "
                                        + "; ".join(ing.relevance["reasons"])})
        failure = self._rebuild_or_rollback(raw_tables=[*self.raw_tables, *ing.accepted_tables],
                                            documents=[*self.documents, ing], telemetry=tel)
        if failure:
            return jsonable({**ing.summary(), "accepted": False, "needs_review": False, "message": failure})
        uncertain = ing.relevance["decision"] == rel.UNCERTAIN
        return jsonable({**ing.summary(), "accepted": True, "needs_review": uncertain,
                         "message": ("indexed, but it is unclear whether this file is about breeding: please confirm"
                                     if uncertain else None)})

    def _rebuild_or_rollback(self, raw_tables: list, documents: list | None = None,
                             telemetry: Telemetry | None = None) -> str | None:
        """Rebuild with the new inputs; if anything fails, restore the previous state exactly.

        An ingest is a transaction. Without this, one bad upload stayed in raw_tables and every later
        rebuild failed with the same error (a 500 on every ingest until the process restarted).
        The state is restored by swapping back the attribute dictionary: the new inputs were given as
        new lists, so the old lists were never mutated. Returns None on success, else a message.
        """
        snapshot = dict(self.__dict__)
        self.raw_tables = raw_tables
        if documents is not None:
            self.documents = documents
        try:
            self._build(telemetry)
            return None
        except Exception as exc:  # roll back, report, keep serving the previous model
            log.exception("rebuild failed; previous state restored")
            self.__dict__.clear()
            self.__dict__.update(snapshot)
            return (f"the engine could not integrate this upload ({type(exc).__name__}); nothing was changed and the "
                    "previous data is still served")

    def assess_relevance(self, text: str = "", tables: list[list[str]] | None = None) -> dict:
        """Relevance of a file (text + table headers) to UC4; see relevance.py for the decision ladder."""
        if self._relevance_context is None:
            ids = rel.identifiers(t.frame for t in self.raw_tables if not self._is_upload(t))
            ids |= {str(c).upper() for c in self.candidate_decisions}
            self._relevance_context = (ids, self.id_patterns())
        ids, patterns = self._relevance_context
        return rel.model().assess(text, tables or [], ids, patterns).as_dict()

    def _build(self, telemetry: Telemetry | None = None) -> None:
        tel = telemetry or Telemetry()
        self._relevance_context = None     # known ids change with the data
        with tel.stage("detect_and_renormalize", rows_in=sum(len(t.frame) for t in self.raw_tables)) as st:
            self.tables: list[IngestedTable] = []
            by_source: dict[str, list] = {}
            hits = 0
            for t in self.raw_tables:
                d, p, tok_raw, tok_ren, hit = _profiled(t.frame)
                hits += hit
                self.tables.append(IngestedTable(t.name, t.origin, d, p, tok_raw, tok_ren, t.frame))
                if d.confident:
                    by_source.setdefault(d.source, []).append((t, t.frame))
            merged = self._merge_sources(by_source)
            st.metrics = {"tables": len(self.tables), "sources": sorted(merged),
                          "upload_conflicts": len(self.document_conflicts),
                          "upload_duplicates_ignored": sum(v.get("duplicates_ignored", 0)
                                                           for v in self.merge_stats.values()),
                          "profile_cache_hits": hits,
                          "columns": sum(len(t.profile.columns) for t in self.tables),
                          "informative_columns": sum(len(t.profile.kept) for t in self.tables)}

        with tel.stage("canonical_model") as st:
            self.model = canon.build(merged)
            self.findings = canon.consistency_checks(self.model)
            st.rows_out = len(self.model.materials) + len(self.model.trials)

        with tel.stage("data_quality") as st:
            self.quality = qual.assess(self.model, export_date=self.export_date)
            if self.document_conflicts:
                self.quality.issues.append(qual.Issue(
                    id="provenance.upload_conflicts_export", category="provenance", severity="warning",
                    title="Uploaded rows contradict the system-of-record export",
                    count=len(self.document_conflicts),
                    affected=[f"{c['source']}:{c['key']}" for c in self.document_conflicts][:12],
                    root_cause=("the same key arrives from an upload (document table or posted records) with "
                                "values different from the export"),
                    evidence={"conflicts": self.document_conflicts[:20]}, fix_status="applied",
                    fix="the export wins; the uploaded value is kept as evidence and shown to the breeder",
                    impact="no silent overwrite of exported data by uploads, scans or LLM-extracted records"))
            dupes = sum(s.get("duplicates_ignored", 0) for s in self.merge_stats.values())
            if dupes:
                self.quality.issues.append(qual.Issue(
                    id="provenance.duplicate_uploads_ignored", category="provenance", severity="info",
                    title="Uploaded rows already present were ignored", count=dupes,
                    affected=[name for name, s in self.merge_stats.items() if s.get("duplicates_ignored")][:12],
                    root_cause="the same rows were uploaded again (re-upload of an export or of a previous upload)",
                    evidence={"per_table": self.merge_stats}, fix_status="applied",
                    fix="exact duplicates are not added, so re-uploading is idempotent",
                    impact="counts, quality issues and drift are not inflated by repeated uploads"))
            st.metrics = self.quality.summary()

        with tel.stage("rules_trial", rows_in=len(self.model.trials)) as st:
            # Trial level: official verdict shown, reconstruction explains / flags.
            self.trial_rules = TrialRules(self.rules_cfg)
            self.trial_decisions = {d.record: d for d in self.trial_rules.evaluate(self.model.trials)}
            st.metrics = {"mode": self.rules_cfg["trial_rules"]["verdict"].get("mode"),
                          "agree_with_official": sum(1 for d in self.trial_decisions.values() if d.agrees_with_official)}

        with tel.stage("rules_candidate", rows_in=len(self.model.materials)) as st:
            self.view = canon.material_trial_view(self.model)
            self.candidate_rules = CandidateRules(self.rules_cfg)
            gen = self.model.genomics.set_index("MATERIAL_GUID") if "MATERIAL_GUID" in self.model.genomics else pd.DataFrame()
            trials_by_material = self.view.groupby("MATERIAL_GUID")["TRIAL_ID"].apply(list).to_dict()
            self.candidate_decisions: dict[str, Decision] = {}
            for m in self.model.materials.itertuples():
                tds = [self.trial_decisions[t] for t in trials_by_material.get(m.MATERIAL_GUID, []) if t in self.trial_decisions]
                g = gen.loc[m.MATERIAL_GUID] if m.MATERIAL_GUID in gen.index else None
                self.candidate_decisions[m.candidate_id] = self.candidate_rules.evaluate(m.candidate_id, tds, g)
            st.metrics = self.apply_scoring()["counts"]

        with tel.stage("features_and_spectral") as st:
            self._build_features()
            self._build_spectral()
            st.metrics = {"features": len(self.feature_names),
                          "retained_components": self.spectral.k if self.spectral else None}

        with tel.stage("calibration") as st:
            st.metrics = {"cache_hit": self._build_calibration()}

        with tel.stage("diagnostics") as st:
            runs_dir = state_dir() / "runs"
            prev = previous_run(runs_dir) if self.save_runs else None
            self.diagnostics = diag.full_report(self, prev)
            st.metrics = {"numerical_passed": (self.diagnostics.get("numerical") or {}).get("passed"),
                          "no_key_lost": self.diagnostics["integrity"]["no_key_lost"],
                          "drift": self.diagnostics["drift"].get("status", "baseline")}

        from . import accel
        tel.context["parallel_plan"] = self.parallel_plan
        tel.context["accelerators"] = {"available": {"cpp": accel._cpp() is not None,
                                                     "julia": accel.julia_enabled()},
                                       "last_knn": dict(accel.LAST_RUN)}
        self.run_report = {**tel.as_dict(), "diagnostics": self.diagnostics,
                           "quality": self.quality.summary(),
                           "baseline": {"parity": self.baseline_parity()}}
        self.run_path = tel.save(runs_dir, {"diagnostics": self.diagnostics,
                                            "quality": self.quality.summary()}) if self.save_runs else None

    # Primary key per source, used to reconcile uploaded tables with exports.
    # lab_observations has no single-column key (several rows per material): exact duplicates are
    # removed instead.
    # Readable identifiers that must stay unique next to the GUID. The 28-Sep drop re-keyed the same trials
    # (SYN-TR-0001 under another TRIAL_GUID): merging it as "new keys" would duplicate every trial.
    _NATURAL_KEYS = {"trial": "TRIAL_ID", "germplasm": "MATERIAL_ID"}
    _SOURCE_KEYS = {"genomics": "MATERIAL_GUID", "germplasm": "MATERIAL_GUID", "trial": "TRIAL_GUID",
                    "trial_recommendations": "TRIAL_GUID", "operations": "OPERATION_GUID",
                    "observations": "OBSERVATION_UUID"}

    @staticmethod
    def _is_upload(table: ingest.RawTable) -> bool:
        """Anything that did not come from the export directory: document tables and posted records."""
        return bool(table.meta.get("from_document") or table.meta.get("uploaded"))

    @staticmethod
    def _same(a: Any, b: Any) -> bool:
        """Equality of two cells after canonicalisation (see _canonical_value)."""
        ca, cb = _canonical_value(a), _canonical_value(b)
        if isinstance(ca, float) and isinstance(cb, float):
            return bool(np.isclose(ca, cb))
        return ca == cb

    def _merge_sources(self, by_source: dict[str, list]) -> dict[str, pd.DataFrame]:
        """Concatenate tables per source with the system of record always winning.

        Exports (files in the data directory) are authoritative. Uploaded rows (document tables
        and POST /ingest/records) are reconciled against everything already accepted, in arrival
        order, so the result does not depend on how often a file is uploaded:

          * key already present, same values  -> exact duplicate, ignored (idempotent re-upload)
          * key already present, other values -> conflict: recorded and shown, never applied
          * new key                           -> added (that is new information)

        For sources without a single-column key, exact duplicate rows are dropped.
        Per-table counts are kept in self.merge_stats for the ingest response.
        """
        self.document_conflicts: list[dict] = []
        self.merge_stats: dict[str, dict[str, int]] = {}
        merged: dict[str, pd.DataFrame] = {}
        for source, items in by_source.items():
            exports = [f for t, f in items if not self._is_upload(t)]
            base = pd.concat(exports, ignore_index=True) if exports else pd.DataFrame()
            key = self._SOURCE_KEYS.get(source)
            for t, f in [(t, f) for t, f in items if self._is_upload(t)]:
                stats = {"received": len(f), "added": 0, "duplicates_ignored": 0, "conflicts": 0}
                if base.empty:
                    accepted = f.drop_duplicates()
                    stats["duplicates_ignored"] = len(f) - len(accepted)
                elif key and key in f.columns and key in base.columns:
                    index = base.drop_duplicates(key, keep="first").set_index(key)
                    known = f[key].isin(index.index)
                    for _, row in f[known].iterrows():
                        ref = index.loc[row[key]]
                        diffs = {c: {"export": ref[c], "uploaded": row[c]} for c in f.columns
                                 if c != key and c in index.columns and pd.notna(row[c]) and not self._same(ref[c], row[c])}
                        if diffs:
                            stats["conflicts"] += 1
                            self.document_conflicts.append({
                                "source": source, "key": row[key], "table": t.name,
                                "kind": "document" if t.meta.get("from_document") else "records",
                                "differences": jsonable(diffs)})
                        else:
                            stats["duplicates_ignored"] += 1
                    accepted = f[~known]
                    natural = self._NATURAL_KEYS.get(source)
                    if natural and natural in accepted.columns and natural in base.columns:
                        owner = base.dropna(subset=[natural]).drop_duplicates(natural).set_index(natural)[key]
                        clash = accepted[natural].isin(owner.index)
                        for _, row in accepted[clash].iterrows():
                            stats["conflicts"] += 1
                            self.document_conflicts.append({
                                "source": source, "key": row[natural], "table": t.name,
                                "kind": "document" if t.meta.get("from_document") else "records",
                                "differences": jsonable({key: {"export": owner[row[natural]], "uploaded": row[key]}})})
                        accepted = accepted[~clash]
                else:
                    # No usable key: drop rows identical (on the shared columns) to rows already accepted.
                    shared = [c for c in f.columns if c in base.columns]
                    signature = lambda df: df[shared].apply(lambda col: col.map(_signature_value)).agg("\x1f".join, axis=1)
                    seen = set(signature(base)) if shared else set()
                    mask = ~signature(f).isin(seen) if shared else pd.Series(True, index=f.index)
                    accepted = f[mask].drop_duplicates()
                    stats["duplicates_ignored"] = len(f) - len(accepted)
                stats["added"] = len(accepted)
                self.merge_stats[t.name] = stats
                if not accepted.empty:
                    base = pd.concat([base, accepted], ignore_index=True) if not base.empty else accepted.reset_index(drop=True)
            if not base.empty:
                merged[source] = base
        return merged

    def _build_features(self) -> None:
        """Candidate feature table: identity + genomics + lab + aggregated trial performance."""
        m = self.model.materials[["MATERIAL_GUID", "candidate_id"]]
        f = m.merge(self.model.genomics, on="MATERIAL_GUID", how="left").merge(self.model.lab, on="MATERIAL_GUID", how="left")
        perf_cols = [c for c in ("YIELD_T_HA", "MOISTURE_PCT", "DISEASE_SCORE", "PLANT_HEIGHT_CM", "FLOWERING_DAYS")
                     if c in self.view.columns]
        if perf_cols:
            perf = self.view.groupby("MATERIAL_GUID")[perf_cols].mean().add_prefix("MEAN_")
            fail = self.view.assign(_f=self.view["TRIAL_RECOMMENDATION"] == "FAIL").groupby("MATERIAL_GUID")["_f"].mean()
            perf["FAIL_SHARE"] = fail
            f = f.merge(perf, left_on="MATERIAL_GUID", right_index=True, how="left")
        self.features = f.reset_index(drop=True)
        self.feature_matrix, self.feature_names, self.encoding_meta = encode_frame(self.features, CANDIDATE_SPECS)

    def _build_spectral(self) -> None:
        self.spectral: SpectralModel | None = None
        if self.feature_matrix.shape[0] > self.feature_matrix.shape[1] > 1:
            self.spectral = SpectralModel.fit(self.feature_matrix, self.feature_names,
                                              energy=self.rules_cfg.get("spectral_energy", 0.95),
                                              quantile=self.rules_cfg.get("anomaly_quantile", 0.975))
            self.t2 = self.spectral.hotelling_t2(self.feature_matrix)
            self.q = self.spectral.residual_q(self.feature_matrix)
        self._index = {cid: i for i, cid in enumerate(self.features["candidate_id"])}

    def _build_calibration(self) -> bool:
        """Calibration is the only slow step (100 CV fits): cache it by the hash of its inputs."""
        self.calibration = None
        trials = self.model.trials
        if "TRIAL_RECOMMENDATION" not in trials.columns or trials["TRIAL_RECOMMENDATION"].notna().sum() < 20:
            return False
        exclude = set(self.quality.excluded_features)
        key = _frame_hash(trials) + repr(sorted(self.rules_cfg["trial_rules"].items())) + repr(sorted(exclude))
        if key in _CALIBRATION_CACHE:
            self.calibration = _CALIBRATION_CACHE[key]
            return True
        try:
            from .calibrate import calibrate
            self.calibration = calibrate(trials, self.rules_cfg["trial_rules"],
                                         tuple(self.rules_cfg.get("ambiguity_band", (0.35, 0.65))),
                                         exclude_features=exclude)
            _CALIBRATION_CACHE[key] = self.calibration
        except ImportError:
            log.warning("scikit-learn not installed: calibration layer disabled (rules still decide)")
        except ValueError as exc:  # e.g. a single class present
            log.warning("calibration skipped: %s", exc)
        return False

    def evidence_reread_mismatches(self) -> int:
        """Anti-hallucination check at the source: every cited trial value equals the table value."""
        trials = self.model.trials.set_index("TRIAL_ID")
        bad = 0
        for d in self.trial_decisions.values():
            for e in d.evidence:
                if e.rule == "severity" or e.field not in trials.columns:
                    continue
                if not np.isclose(float(trials.at[d.record, e.field]), float(e.value)):
                    bad += 1
        return bad

    def baseline_parity(self) -> dict:
        ds = [d for d in self.trial_decisions.values() if d.official_verdict is not None]
        agree = sum(1 for d in ds if d.agrees_with_official)
        return {"agree": agree, "total": len(ds), "accuracy": round(agree / len(ds), 4) if ds else None}

    def id_patterns(self) -> dict:
        """ID regexes learned from the data (used to find IDs inside documents)."""
        from .patterns import ID_PATTERNS, learn_id_patterns
        cols = {}
        if "candidate_id" in self.model.materials:
            cols["candidate_id"] = self.model.materials["candidate_id"]
        if "TRIAL_ID" in self.model.trials:
            cols["trial_id"] = self.model.trials["TRIAL_ID"]
        return {**ID_PATTERNS, **learn_id_patterns(cols)}

    # ------------------------------------------------------------ helpers
    def _effective(self, level: str, record: str, decision: Decision) -> dict:
        ov = self.overrides.latest().get((level, record))
        return {"engine_colour": decision.colour,
                "colour": ov.new_colour if ov else decision.colour,
                "overridden": ov is not None,
                "override": None if ov is None else ov.__dict__}

    def _atypical(self, cid: str) -> dict | None:
        if self.spectral is None or cid not in self._index:
            return None
        i = self._index[cid]
        t2 = float(self.t2[i])
        contrib = self.spectral.contributions(self.feature_matrix[i])
        top = np.argsort(-contrib)[:3]
        drivers = []
        for j in top:
            name = self.feature_names[j]
            base = name.split("[")[0]
            raw = self.features.at[i, base] if base in self.features.columns else None
            cohort = self.features[base] if base in self.features.columns else None
            if cohort is not None and pd.api.types.is_numeric_dtype(cohort):
                drivers.append({"feature": base, "value": jsonable(raw), "cohort_mean": jsonable(cohort.mean()),
                                "share_of_t2": round(float(contrib[j] / t2), 3) if t2 else None})
            else:
                drivers.append({"feature": base, "value": jsonable(raw),
                                "share_of_t2": round(float(contrib[j] / t2), 3) if t2 else None})
        return {"hotelling_t2": round(t2, 3), "threshold": round(self.spectral.t2_threshold, 3),
                "atypical": bool(t2 > self.spectral.t2_threshold),
                "residual_q": round(float(self.q[i]), 4), "drivers": drivers}

    def _candidate_row(self, cid: str) -> dict:
        d = self.candidate_decisions[cid]
        eff = self._effective("candidate", cid, d)
        atyp = self._atypical(cid)
        ambiguous = [t for t in d.extras.get("trials", [])
                     if self.calibration and t in self.calibration.ambiguous_trials]
        reason = d.reason
        if atyp and atyp["atypical"]:
            reason += f"; atypical profile (driven by {atyp['drivers'][0]['feature']})"
        # Mean yield over the candidate's trials (the UI table shows it). Read from the feature table,
        # i.e. computed once by the engine; None when the candidate has no trial with a yield.
        mean_yield = None
        i = self._index.get(cid)
        if i is not None and "MEAN_YIELD_T_HA" in self.features.columns:
            v = self.features.at[i, "MEAN_YIELD_T_HA"]
            mean_yield = None if pd.isna(v) else round(float(v), 2)
        return {"candidate_id": cid, **eff, "verdict": d.verdict, "reason": reason,
                "mean_yield_t_ha": mean_yield,
                "n_trials": d.extras.get("n_trials"), "n_fail": d.extras.get("n_fail"),
                "ambiguous_trials": ambiguous, "atypical": bool(atyp and atyp["atypical"]),
                "rule_version": d.rule_version}

    # ------------------------------------------------------------ public API (MCP tools)
    def query_candidates(self, colour: str | None = None, atypical: bool | None = None,
                         min_trials: int | None = None, limit: int | None = None) -> list[dict]:
        """Table of candidates with colour and a one-line reason (the breeder's main view)."""
        rows = [self._candidate_row(cid) for cid in self.candidate_decisions]
        if colour:
            rows = [r for r in rows if r["colour"] == colour.upper()]
        if atypical is not None:
            rows = [r for r in rows if r["atypical"] == atypical]
        if min_trials is not None:
            rows = [r for r in rows if (r["n_trials"] or 0) >= min_trials]
        order = {"RED": 0, "AMBER": 1, "GREEN": 2}
        rows.sort(key=lambda r: (order[r["colour"]], r["candidate_id"]))
        return jsonable(rows[:limit] if limit else rows)

    def get_candidate_profile(self, candidate_id: str) -> dict:
        """Full evidence card: every number cites its source, field and record."""
        if candidate_id not in self.candidate_decisions:
            raise KeyError(candidate_id)
        d = self.candidate_decisions[candidate_id]
        i = self._index.get(candidate_id)
        feat = self.features.iloc[i] if i is not None else pd.Series(dtype=object)
        genomics = {k: feat.get(k) for k in ("GENOMIC_BREEDING_VALUE", "QC_CALL_RATE_PCT", "QC_STATUS_LID",
                                              "MARKER_DROUGHT_TOLERANCE", "MARKER_DISEASE_RESISTANCE",
                                              "MARKER_YIELD_POTENTIAL", "MARKER_MATURITY", "GENOTYPING_DATE")
                    if k in feat.index}
        lab = {k: feat.get(k) for k in self.model.lab_traits if k in feat.index}
        trials = []
        for t in d.extras.get("trials", []):
            td = self.trial_decisions[t]
            row = self.model.trials.loc[self.model.trials["TRIAL_ID"] == t].iloc[0]
            trials.append({"trial_id": t, "location": row.get("location"), "year": row.get("START_YEAR"),
                           "official_verdict": td.official_verdict, "engine_verdict": td.computed_verdict,
                           "explained_by_data": td.agrees_with_official, "reason": td.reason,
                           "ambiguous": bool(self.calibration and t in self.calibration.ambiguous_trials),
                           "p_fail": (self.calibration.oof_probability.get(t) if self.calibration else None)})
        similar = []
        if self.spectral is not None and i is not None:
            for j, dist in self.spectral.nearest(self.feature_matrix, i, k=3):
                other = self.features.at[j, "candidate_id"]
                similar.append({"candidate_id": other, "distance": round(dist, 3),
                                "colour": self.candidate_decisions[other].colour})
        return jsonable({
            **self._candidate_row(candidate_id),
            "evidence": [e.as_dict() for e in d.evidence],
            "genomics": {"source": "genomics", **genomics},
            "lab": {"source": "lab_observations", "trait_ids": self.model.lab_traits, **lab},
            "trials": trials,
            "atypicality": self._atypical(candidate_id),
            "similar_candidates": similar,
            "lineage": self.get_lineage(candidate_id),
            "document_evidence": self.document_facts(candidate_id),
            "data_gaps": self.model.gaps,
        })

    def compare_candidates(self, candidate_ids: list[str]) -> dict:
        keys = ["GENOMIC_BREEDING_VALUE", "MEAN_YIELD_T_HA", "MEAN_DISEASE_SCORE", "MEAN_MOISTURE_PCT",
                "FAIL_SHARE", "MARKER_DISEASE_RESISTANCE", "MARKER_YIELD_POTENTIAL"]
        out, idx = [], []
        for cid in candidate_ids:
            if cid not in self._index:
                raise KeyError(cid)
            i = self._index[cid]
            idx.append(i)
            row = self.features.iloc[i]
            out.append({"candidate_id": cid, **self._effective("candidate", cid, self.candidate_decisions[cid]),
                        "reason": self.candidate_decisions[cid].reason,
                        **{k: row.get(k) for k in keys if k in row.index}})
        distances = None
        if self.spectral is not None and len(idx) > 1:
            w = self.spectral.whiten(self.feature_matrix[idx])
            dmat = np.sqrt(((w[:, None, :] - w[None, :, :]) ** 2).sum(-1))
            distances = {"metric": "Mahalanobis (whitened spectral space)", "candidates": candidate_ids,
                         "matrix": dmat.round(3).tolist()}
        return jsonable({"candidates": out, "distances": distances})

    def get_lineage(self, candidate_id: str) -> dict:
        m = self.model.materials.loc[self.model.materials["candidate_id"] == candidate_id]
        if m.empty:
            raise KeyError(candidate_id)
        row = m.iloc[0]
        guid_to_id = dict(zip(self.model.materials["MATERIAL_GUID"], self.model.materials["candidate_id"]))
        parents = {}
        for role, col in (("female", "FEMALE_PARENT_MATERIAL_GUID"), ("male", "MALE_PARENT_MATERIAL_GUID")):
            g = row.get(col)
            parents[role] = None if g is None or pd.isna(g) else guid_to_id.get(g, g)
        available = any(v is not None for v in parents.values())
        return {"candidate_id": candidate_id, "parents": parents, "pedigree": jsonable(row.get("PEDIGREE")),
                "available": available,
                "note": None if available else "pedigree fields are empty in the germplasm export: lineage unavailable"}

    def apply_scoring(self, level: str = "candidate") -> dict:
        """Colour distribution, both as the rules decided it and as the breeders see it after overrides.

        `counts` is the rule colour (what the engine decided). `effective_counts` applies the latest
        override per record, i.e. what the dashboard and query_candidates show. They differ exactly by
        the overrides, so a chat answer can state both instead of contradicting the board.
        """
        decisions = self.candidate_decisions if level == "candidate" else self.trial_decisions
        counts: dict[str, int] = {c: 0 for c in ("RED", "AMBER", "GREEN")}
        effective: dict[str, int] = dict(counts)
        overridden = 0
        for record, d in decisions.items():
            counts[d.colour] = counts.get(d.colour, 0) + 1
            eff = self._effective(level, record, d)
            effective[eff["colour"]] = effective.get(eff["colour"], 0) + 1
            overridden += eff["colour"] != d.colour
        version = self.candidate_rules.version if level == "candidate" else self.trial_rules.version
        return {"level": level, "rule_version": version, "total": len(decisions),
                "counts": counts, "effective_counts": effective, "overridden": overridden,
                "note": ("counts = colours decided by the rules; effective_counts = colours after the breeders' "
                         "overrides (what the dashboard shows)")}

    def get_trial(self, trial_id: str) -> dict:
        """One trial: official vs engine verdict, evidence, ambiguity, documents mentioning it."""
        d = self.trial_decisions.get(trial_id)
        if d is None:
            raise KeyError(trial_id)
        row = self.model.trials.loc[self.model.trials["TRIAL_ID"] == trial_id].iloc[0]
        candidates = self.view.loc[self.view["TRIAL_ID"] == trial_id, "candidate_id"].tolist()
        return jsonable({"trial_id": trial_id, **self._effective("trial", trial_id, d),
                         "official_verdict": d.official_verdict, "engine_verdict": d.computed_verdict,
                         "explained_by_data": d.agrees_with_official, "reason": d.reason,
                         "location": row.get("location"), "year": row.get("START_YEAR"),
                         "evidence": [e.as_dict() for e in d.evidence],
                         "ambiguous": bool(self.calibration and trial_id in self.calibration.ambiguous_trials),
                         "p_fail": self.calibration.oof_probability.get(trial_id) if self.calibration else None,
                         "candidates": candidates, "document_evidence": self.document_facts(trial_id),
                         "rule_version": d.rule_version})

    # ------------------------------------------------------------ transparency
    def trials(self) -> list[dict]:
        return jsonable([{"trial_id": d.record, "colour": d.colour, "official_verdict": d.official_verdict,
                          "engine_verdict": d.computed_verdict, "explained_by_data": d.agrees_with_official,
                          "reason": d.reason,
                          "ambiguous": bool(self.calibration and d.record in self.calibration.ambiguous_trials)}
                         for d in self.trial_decisions.values()])

    def baseline(self) -> dict:
        """Parity with the official logic + calibration: the 'checked against a baseline' evidence."""
        ds = [d for d in self.trial_decisions.values() if d.official_verdict is not None]
        labels = ["PASS", "HOLD", "FAIL"]
        confusion = {o: {c: sum(1 for d in ds if d.official_verdict == o and d.computed_verdict == c) for c in labels}
                     for o in labels}
        agree = sum(1 for d in ds if d.agrees_with_official)
        return jsonable({
            "rule_version": self.trial_rules.version,
            "mode": self.rules_cfg["trial_rules"]["verdict"].get("mode", "gate"),
            "parity": {"agree": agree, "total": len(ds), "accuracy": round(agree / len(ds), 4) if ds else None},
            "confusion_official_vs_engine": confusion,
            "not_explained": [d.record for d in ds if not d.agrees_with_official],
            "mismatch_root_causes": qual.diagnose_mismatches(self.model.trials, self.rules_cfg["trial_rules"],
                                                             self.calibration),
            "calibration": None if self.calibration is None else
            {k: v for k, v in self.calibration.as_dict().items() if k not in ("oof_probability",)},
        })

    # ------------------------------------------------------------ quality, diagnostics, documents
    def quality_report(self) -> dict:
        """Every data issue: category, root cause, fix status (applied/proposed/not fixable), impact."""
        rep = self.quality.as_dict()
        rep["what_if_recomputed_aggregates"] = qual.what_if_recomputed(self.quality.reconciled_trials, self.trial_rules)
        return jsonable(rep)

    def diagnostics_report(self) -> dict:
        """Last run: timings, memory, numerical checks, integrity, drift, topology (also saved as JSON)."""
        return jsonable({**self.run_report, "run_file": str(self.run_path) if self.run_path else None})

    def documents_report(self) -> list[dict]:
        return jsonable([d.summary() for d in self.documents])

    def document_facts(self, entity_id: str) -> list[dict]:
        """Sentences from ingested documents that mention a candidate or trial id."""
        out = []
        for d in self.documents:
            for f in d.facts:
                if any(entity_id in ids for ids in f["ids"].values()):
                    out.append(f)
        return jsonable(out)

    def patterns_report(self) -> dict:
        """Identifier grammar and combinatorics (capacity, counter gaps) of the key columns."""
        from .patterns import analyse_column
        cols = {"candidate_id": self.model.materials.get("candidate_id"),
                "MATERIAL_GUID": self.model.materials.get("MATERIAL_GUID"),
                "TRIAL_ID": self.model.trials.get("TRIAL_ID"), "TRIAL_GUID": self.model.trials.get("TRIAL_GUID")}
        return jsonable({k: analyse_column(v) for k, v in cols.items() if v is not None})

    def search(self, q: str, limit: int = 20) -> dict:
        """Find candidates / trials by id (exact, partial or learned pattern) and text in reasons and documents."""
        q_norm = q.strip()
        low = q_norm.lower()
        hits: list[dict] = []
        for cid, d in self.candidate_decisions.items():
            if low in cid.lower() or (low and low in d.reason.lower()):
                hits.append({"type": "candidate", "id": cid, "colour": d.colour, "reason": d.reason})
        for tid, d in self.trial_decisions.items():
            if low in tid.lower() or (len(low) > 3 and low in d.reason.lower()):
                hits.append({"type": "trial", "id": tid, "colour": d.colour, "reason": d.reason})
        for guid_col, id_col, kind, table in (("MATERIAL_GUID", "candidate_id", "candidate", self.model.materials),
                                              ("TRIAL_GUID", "TRIAL_ID", "trial", self.model.trials)):
            m = table[table[guid_col].astype(str).str.lower() == low]
            hits += [{"type": kind, "id": r, "matched": "guid"} for r in m[id_col]]
        for d in self.documents:
            for f in d.facts:
                if low in f["sentence"].lower():
                    hits.append({"type": "document", "source": f["source"], "page": f["page"],
                                 "sentence": f["sentence"]})
        return jsonable({"query": q, "total": len(hits), "hits": hits[:limit]})

    def sql(self, query: str, limit: int = 500) -> dict:
        """Read-only SQL (DuckDB) over the canonical tables, for power users and the MCP layer."""
        import duckdb
        text = query.strip().rstrip(";")
        if ";" in text or not text.lower().startswith(("select", "with")):
            raise ValueError("only a single SELECT / WITH statement is allowed")
        con = duckdb.connect(database=":memory:")
        try:
            for name, frame in self.sql_tables().items():
                con.register(name, frame)
            result = con.execute(f"SELECT * FROM ({text}) LIMIT {int(limit)}").fetchdf()
        finally:
            con.close()
        return jsonable({"columns": list(result.columns), "rows": result.to_dict("records")})

    def sql_tables(self) -> dict[str, pd.DataFrame]:
        decisions = pd.DataFrame([{"candidate_id": k, "verdict": d.verdict, "colour": d.colour, "reason": d.reason,
                                   "n_trials": d.extras.get("n_trials"), "n_fail": d.extras.get("n_fail")}
                                  for k, d in self.candidate_decisions.items()])
        trial_dec = pd.DataFrame([{"trial_id": k, "official": d.official_verdict, "engine": d.computed_verdict,
                                   "colour": d.colour, "reason": d.reason} for k, d in self.trial_decisions.items()])
        return {"materials": self.model.materials, "trials": self.quality.reconciled_trials,
                "trial_material": self.model.trial_material, "operations": self.quality.operations_flags,
                "genomics": self.model.genomics, "lab": self.model.lab, "candidate_features": self.features,
                "candidate_decisions": decisions, "trial_decisions": trial_dec}

    def ingestion_report(self) -> dict:
        tables = []
        for t in self.tables:
            s = t.profile.summary()
            tables.append({"table": t.name, "source": t.detection.source, "match_score": t.detection.score,
                           "runner_up": t.detection.runner_up, "runner_up_score": t.detection.runner_up_score,
                           "rows": s["rows"], "columns": s["columns"], "informative_columns": s["kept"],
                           "roles": s["roles"], "tokens_raw": t.tokens_raw, "tokens_renormalized": t.tokens_renormalized})
        raw = sum(t.tokens_raw for t in self.tables)
        ren = sum(t.tokens_renormalized for t in self.tables)
        cols = sum(len(t.profile.columns) for t in self.tables)
        kept = sum(len(t.profile.kept) for t in self.tables)
        return jsonable({"tables": tables, "parallel_plan": self.parallel_plan,
                         "documents_rejected_as_irrelevant": self.rejected_documents,
                         "totals": {"columns": cols, "informative_columns": kept,
                                    "tokens_raw": raw, "tokens_renormalized": ren,
                                    "token_reduction": round(1 - ren / raw, 4) if raw else None},
                         "spectral": self.spectral.certificate() if self.spectral else None,
                         "encoding": self.encoding_meta})

    def consistency(self) -> list[dict]:
        return jsonable([f.as_dict() for f in self.findings])

    def llm_context(self, candidate_id: str) -> dict:
        """Minimal, citation-ready payload for the LLM: only what it may say, nothing else.

        Also reports the token cost of this payload against sending the raw rows
        of every source that mention the candidate (the naive approach).
        """
        p = self.get_candidate_profile(candidate_id)
        payload = {
            "candidate_id": candidate_id, "colour": p["colour"], "engine_colour": p["engine_colour"],
            "verdict": p["verdict"], "reason": p["reason"], "rule_version": p["rule_version"],
            "evidence": [e["statement"] for e in p["evidence"]],
            "trials": [f"{t['trial_id']} {t['location']} {t['year']}: {t['official_verdict']}"
                       + ("" if t["explained_by_data"] else " (not explained by data)")
                       + (" (ambiguous)" if t["ambiguous"] else "") for t in p["trials"]],
            "atypical": p["atypicality"]["atypical"] if p["atypicality"] else None,
            "similar": [s["candidate_id"] for s in p["similar_candidates"]],
            "document_mentions": [f"{f['source']} p.{f['page']}: {f['sentence']}" for f in p["document_evidence"]][:5],
            "data_gaps": p["data_gaps"],
            "trial_counts": _trial_counts(p["trials"]),
            "instructions": "Cite only these values. Never compute new numbers. The breeder decides.",
        }
        guid = self.model.materials.loc[self.model.materials["candidate_id"] == candidate_id, "MATERIAL_GUID"].iloc[0]
        trial_guids = set(self.view.loc[self.view["MATERIAL_GUID"] == guid, "TRIAL_GUID"])
        raw_tokens = 0
        for t in self.tables:
            f = t.frame
            mask = pd.Series(False, index=f.index)
            for col in f.columns:
                key = det.canonical_key(col)
                if key == "MATERIAL_GUID":
                    mask |= f[col] == guid
                elif key == "TRIAL_GUID":
                    mask |= f[col].isin(trial_guids)
            raw_tokens += prof.token_estimate(f[mask]) if mask.any() else 0
        import json
        ctx_tokens = int(np.ceil(len(json.dumps(jsonable(payload))) / 4))
        return jsonable({"payload": payload, "tokens": {"payload": ctx_tokens, "raw_rows": raw_tokens,
                                                          "reduction": round(1 - ctx_tokens / raw_tokens, 4) if raw_tokens else None}})

    def record_override(self, *, candidate_id: str | None = None, trial_id: str | None = None, new_colour: str,
                        reason_code: str, comment: str = "", user: str = "breeder") -> dict:
        if candidate_id:
            level, record, d = "candidate", candidate_id, self.candidate_decisions.get(candidate_id)
        else:
            level, record, d = "trial", trial_id, self.trial_decisions.get(trial_id or "")
        if d is None:
            raise KeyError(record)
        entry = self.overrides.record(user=user, level=level, record=record, engine_colour=d.colour,
                                      new_colour=new_colour.upper(), reason_code=reason_code, comment=comment,
                                      rule_version=d.rule_version)
        return entry.__dict__

    @staticmethod
    def reason_codes() -> dict[str, str]:
        return REASON_CODES
