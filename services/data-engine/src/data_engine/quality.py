"""Data-quality layer: find, categorise, explain and (where it is honest) fix errors.

"Fix" has a strict meaning here:
* We NEVER overwrite a value exported by the system of record. A breeder or the
  SME must be able to see exactly what Syngenta's systems said.
* APPLIED fixes are derived, reproducible and reversible: a recomputed field
  next to the original, a quarantine flag that keeps a bad record out of a
  computation, a key normalisation. Each has provenance (method, inputs).
* PROPOSED fixes need a human decision (e.g. which trial an orphan operation
  really belongs to when several are possible).
* NOT_FIXABLE issues are reported with the question the SME must answer.

Every issue gets: a category, severity, count, affected records, a root-cause
hypothesis backed by a measurement, the fix status and its impact.

The module also root-causes the trials whose official verdict the rules do not
reproduce (per rule mode), into:
    WEIGHTING         the weighted rule explains it (equal weights were the cause)
    BOUNDARY          within the uncertainty band of the cut (cannot be resolved)
    LABEL_CONFLICT    most similar trials agree with the engine, not the label
    MISSING_FACTOR    similar trials agree with the label: a factor is missing
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .canonical import Canonical, jsonable


@dataclass
class Issue:
    id: str
    category: str              # linkage | temporal | status | aggregation | completeness | design | labels
    severity: str              # info | warning | critical
    title: str
    count: int
    affected: list[str]
    root_cause: str
    evidence: dict[str, Any]
    fix_status: str            # applied | proposed | not_fixable | none_needed
    fix: str
    impact: str
    sme_question: str | None = None

    def as_dict(self) -> dict:
        return jsonable(asdict(self))


@dataclass
class QualityReport:
    issues: list[Issue]
    reconciled_trials: pd.DataFrame
    operations_flags: pd.DataFrame
    corrections: pd.DataFrame                     # one row per applied/proposed fix (provenance log)
    excluded_features: set[str] = field(default_factory=set)

    def summary(self) -> dict:
        by_status: dict[str, int] = {}
        for i in self.issues:
            by_status[i.fix_status] = by_status.get(i.fix_status, 0) + 1
        return {"issues": len(self.issues), "by_fix_status": by_status,
                "records_flagged": int(sum(i.count for i in self.issues)),
                "excluded_features": sorted(self.excluded_features)}

    def as_dict(self) -> dict:
        return jsonable({"summary": self.summary(), "issues": [i.as_dict() for i in self.issues],
                         "corrections": self.corrections.to_dict("records")})


def _ids(series: pd.Series, limit: int = 12) -> list[str]:
    vals = [str(v) for v in series.dropna().unique()]
    return vals[:limit] + ([f"... +{len(vals) - limit} more"] if len(vals) > limit else [])


def assess(c: Canonical, export_date: str | None = None, date_consistency_min: float = 0.8) -> QualityReport:
    """Run every check on the canonical model and build the reconciled views."""
    issues: list[Issue] = []
    corrections: list[dict] = []
    trials = c.trials.copy()
    tm = c.trial_material
    ops = c.operations.copy() if not c.operations.empty else pd.DataFrame()
    id_of_trial = dict(zip(trials["TRIAL_GUID"], trials["TRIAL_ID"]))
    id_of_mat = dict(zip(c.materials["MATERIAL_GUID"], c.materials["candidate_id"]))

    # ---------------------------------------------------------------- aggregation
    if not tm.empty and "GENOMIC_BREEDING_VALUE" in c.genomics.columns:
        g = tm.merge(c.genomics[["MATERIAL_GUID", "GENOMIC_BREEDING_VALUE", "MARKER_DISEASE_RESISTANCE"]],
                     on="MATERIAL_GUID", how="left")
        agg = g.groupby("TRIAL_GUID").agg(
            GBV_MEAN_RECOMPUTED=("GENOMIC_BREEDING_VALUE", "mean"),
            RESISTANT_PCT_RECOMPUTED=("MARKER_DISEASE_RESISTANCE", lambda s: 100.0 * (s == "RESISTANT").mean()),
            N_MATERIALS_OBSERVED=("MATERIAL_GUID", "nunique"))
        trials = trials.merge(agg, left_on="TRIAL_GUID", right_index=True, how="left")
        for field_rep, field_rec, tol, label in (
                ("GENOMIC_BREEDING_VALUE_MEAN", "GBV_MEAN_RECOMPUTED", 1.0, "genomic breeding value mean"),
                ("RESISTANT_MATERIAL_PCT", "RESISTANT_PCT_RECOMPUTED", 5.0, "resistant-material share")):
            if field_rep not in trials.columns:
                continue
            gap = (trials[field_rep] - trials[field_rec]).abs()
            bad = trials[gap > tol]
            corr = float(np.corrcoef(trials[field_rep], trials[field_rec])[0, 1])
            trials[f"{field_rep}_CONSISTENT"] = gap <= tol
            for r in bad.itertuples():
                corrections.append({"record": r.TRIAL_ID, "field": field_rep, "original": getattr(r, field_rep),
                                    "derived": round(getattr(r, field_rec), 2), "status": "applied",
                                    "method": f"recomputed from the {int(r.N_MATERIALS_OBSERVED)} materials observed "
                                              f"in the trial; original kept, derived stored as {field_rec}"})
            issues.append(Issue(
                id=f"aggregation.{field_rep.lower()}", category="aggregation", severity="warning",
                title=f"Trial {label} does not match the materials observed in the trial",
                count=len(bad), affected=_ids(bad["TRIAL_ID"]),
                root_cause=(f"the trial summary is not derived from the observed materials: correlation between "
                            f"reported and recomputed values is {corr:.2f} (1.0 if one were computed from the other); "
                            f"the summary was probably generated from a different material set or independently"),
                evidence={"median_abs_gap": round(float(gap.median()), 2), "max_abs_gap": round(float(gap.max()), 2),
                          "tolerance": tol, "correlation_reported_vs_recomputed": round(corr, 3)},
                fix_status="applied",
                fix=(f"derived column {field_rec} added next to the original; the rules keep the reported value "
                     f"because the official verdicts were computed on it"),
                impact="see what_if_recomputed_aggregates in the quality report",
                sme_question=f"Which material set is the trial-level {label} computed from?"))

    # ---------------------------------------------------------------- operations
    op_flags = pd.DataFrame()
    exclude: set[str] = set()
    if not ops.empty and {"TRIAL_GUID", "MATERIAL_GUID", "OPERATION_DATE"} <= set(ops.columns):
        op_flags = ops.merge(trials[["TRIAL_GUID", "TRIAL_ID", "START_YEAR", "location"]], on="TRIAL_GUID", how="left")
        op_flags["candidate_id"] = op_flags["MATERIAL_GUID"].map(id_of_mat)

        # (a) linkage: material never observed in that trial
        linked = set(zip(tm["TRIAL_GUID"], tm["MATERIAL_GUID"]))
        op_flags["LINK_OK"] = [(t, m) in linked for t, m in zip(op_flags["TRIAL_GUID"], op_flags["MATERIAL_GUID"])]
        obs_loc = tm.merge(trials[["TRIAL_GUID", "location"]], on="TRIAL_GUID")
        candidates_per_op, proposal = [], []
        for r in op_flags.itertuples():
            if r.LINK_OK:
                candidates_per_op.append(0)
                proposal.append(None)
                continue
            options = obs_loc[(obs_loc["MATERIAL_GUID"] == r.MATERIAL_GUID) & (obs_loc["location"] == r.location)]
            candidates_per_op.append(len(options))
            proposal.append(id_of_trial.get(options["TRIAL_GUID"].iloc[0]) if len(options) == 1 else None)
        op_flags["LINK_CANDIDATE_TRIALS"] = candidates_per_op
        op_flags["PROPOSED_TRIAL_ID"] = proposal
        orphans = op_flags[~op_flags["LINK_OK"]]
        if len(orphans):
            same_loc = int((orphans["LINK_CANDIDATE_TRIALS"] > 0).sum())
            unique = int((orphans["LINK_CANDIDATE_TRIALS"] == 1).sum())
            for r in orphans.itertuples():
                corrections.append({"record": str(r.OPERATION_GUID), "field": "TRIAL_GUID", "original": r.TRIAL_ID,
                                    "derived": r.PROPOSED_TRIAL_ID, "status": "proposed" if r.PROPOSED_TRIAL_ID else "quarantined",
                                    "method": f"material observed in {r.LINK_CANDIDATE_TRIALS} trial(s) at the same "
                                              f"location; operation excluded from trial-level features"})
            issues.append(Issue(
                id="linkage.operation_material_not_in_trial", category="linkage", severity="warning",
                title="Field operations reference a material that was not observed in that trial",
                count=len(orphans), affected=_ids(orphans["OPERATION_GUID"].astype(str)),
                root_cause=(f"wrong trial key on the operation: in {same_loc}/{len(orphans)} cases the material IS "
                            f"observed at the same location, in another trial of the same season, i.e. the operation "
                            f"was booked against a sibling trial"),
                evidence={"orphans": len(orphans), "material_observed_same_location": same_loc,
                          "unique_reassignment_possible": unique,
                          "candidate_trials_distribution": orphans["LINK_CANDIDATE_TRIALS"].value_counts().to_dict()},
                fix_status="applied" if unique == 0 else "proposed",
                fix=("quarantined: excluded from every trial-level computation; a unique reassignment is proposed "
                     "when only one sibling trial contains the material" + ("" if unique else
                     " (none is unique here: each material appears in 4-5 sibling trials, so a human must decide)")),
                impact="no effect on verdicts (operations do not enter the rules); planting dates use linked operations only",
                sme_question="Are operations recorded per trial or per location/season block?"))

        # (b) temporal: operation year vs trial year
        op_flags["YEAR_OK"] = op_flags["OPERATION_DATE"].dt.year == op_flags["START_YEAR"]
        bad_year = op_flags[~op_flags["YEAR_OK"]]
        if len(bad_year):
            offsets = (bad_year["OPERATION_DATE"].dt.year - bad_year["START_YEAR"]).value_counts().to_dict()
            span = f"{op_flags['OPERATION_DATE'].min().date()} .. {op_flags['OPERATION_DATE'].max().date()}"
            issues.append(Issue(
                id="temporal.operation_year_mismatch", category="temporal", severity="critical",
                title="Operation dates fall in a different year than their trial",
                count=len(bad_year), affected=_ids(bad_year["TRIAL_ID"]),
                root_cause=(f"every operation is dated within {span} whatever the trial year: the dates look like "
                            f"export/generation timestamps rather than field dates"),
                evidence={"year_offsets": offsets, "date_span": span},
                fix_status="applied",
                fix="dates flagged YEAR_OK=False; they are not used for seasonality features",
                impact="planting-date seasonality removed from the calibrated model (see excluded_features)",
                sme_question="Is OPERATION_DATE the field date or the record's creation date?"))

        # (c) temporal: operation order inside a trial
        piv = op_flags[op_flags["LINK_OK"]].pivot_table(index="TRIAL_ID", columns="OPERATION_TYPE_LID",
                                                        values="OPERATION_DATE", aggfunc="min")
        seq_bad: list[str] = []
        if {"PLANTING", "HARVEST"} <= set(piv.columns):
            seq_bad += piv.index[(piv["HARVEST"] < piv["PLANTING"])].tolist()
        if {"PLANTING", "IRRIGATION"} <= set(piv.columns):
            seq_bad += piv.index[(piv["IRRIGATION"] < piv["PLANTING"])].tolist()
        seq_bad = sorted(set(seq_bad))
        if seq_bad:
            both = piv.dropna(subset=[c for c in ("PLANTING", "HARVEST") if c in piv.columns])
            offs = (both["HARVEST"] - both["PLANTING"]).dt.days if len(both) else pd.Series(dtype=float)
            issues.append(Issue(
                id="temporal.operation_order", category="temporal", severity="critical",
                title="Harvest or irrigation dated before planting",
                count=len(seq_bad), affected=_ids(pd.Series(seq_bad)),
                root_cause=(f"planting-to-harvest offsets are not physically consistent (median "
                            f"{offs.median():.0f} d, std {offs.std():.0f} d, min {offs.min():.0f} d): the dates are "
                            f"not usable as a timeline" if len(offs) else "inconsistent operation dates"),
                evidence={"trials": len(seq_bad), "harvest_minus_planting_days": {
                    "median": float(offs.median()) if len(offs) else None, "std": float(offs.std()) if len(offs) else None,
                    "min": float(offs.min()) if len(offs) else None}},
                fix_status="not_fixable",
                fix="flagged; not imputed (the offset dispersion is too large for any defensible imputation)",
                impact="no timeline features are derived from operations"))

        # (d) status: PLANNED but dated in the past (relative to the export)
        ref = pd.Timestamp(export_date) if export_date else op_flags["OPERATION_DATE"].max()
        stale = op_flags[(op_flags.get("OPERATION_STATUS_LID") == "PLANNED") & (op_flags["OPERATION_DATE"] <= ref)]
        if len(stale):
            # reindex, not .loc: an uploaded operation may point to a trial the exports do not contain.
            status = trials.drop_duplicates("TRIAL_GUID").set_index("TRIAL_GUID")["STATUS_LID"] \
                if "STATUS_LID" in trials.columns else pd.Series(dtype=object)
            done_trials = int(status.reindex(stale["TRIAL_GUID"].unique()).eq("COMPLETE").sum())
            issues.append(Issue(
                id="status.planned_in_the_past", category="status", severity="warning",
                title="Operations still PLANNED although their date has passed",
                count=len(stale), affected=_ids(stale["OPERATION_GUID"].astype(str)),
                root_cause=(f"status not updated after execution: {done_trials} of the affected trials are already "
                            f"COMPLETE"),
                evidence={"reference_date": str(ref.date()), "planned_past": len(stale)},
                fix_status="proposed", fix="propose status COMPLETED where the parent trial is COMPLETE",
                impact="none on verdicts; affects any operational dashboard"))
            for r in stale.itertuples():
                corrections.append({"record": str(r.OPERATION_GUID), "field": "OPERATION_STATUS_LID", "original": "PLANNED",
                                    "derived": "COMPLETED", "status": "proposed",
                                    "method": "date passed and parent trial COMPLETE"})

        # (e) missing planting operation per trial
        planted = set(op_flags.loc[op_flags["OPERATION_TYPE_LID"] == "PLANTING", "TRIAL_GUID"])
        missing = trials[~trials["TRIAL_GUID"].isin(planted)]
        if len(missing):
            issues.append(Issue(
                id="completeness.missing_planting", category="completeness", severity="info",
                title="Trials without a PLANTING operation", count=len(missing), affected=_ids(missing["TRIAL_ID"]),
                root_cause="operations are sampled (3 per trial) rather than complete per trial",
                evidence={"trials_without_planting": len(missing)},
                fix_status="not_fixable",
                fix="not imputed: see temporal.operation_order (offsets are not consistent enough)",
                impact="planting seasonality unavailable for these trials"))

        # Quality gate for the seasonality feature: use planting dates only if
        # most of them are in the trial's own year and correctly linked.
        planting = op_flags[op_flags["OPERATION_TYPE_LID"] == "PLANTING"]
        share_ok = float((planting["YEAR_OK"] & planting["LINK_OK"]).mean()) if len(planting) else 0.0
        if share_ok < date_consistency_min:
            exclude.add("PLANTING_DATE")

    # ---------------------------------------------------------------- completeness / design
    for parent in ("FEMALE_PARENT_MATERIAL_GUID", "MALE_PARENT_MATERIAL_GUID"):
        if parent not in c.materials.columns or c.materials[parent].isna().all():
            issues.append(Issue(
                id="completeness.pedigree_empty", category="completeness", severity="warning",
                title="Pedigree parents are empty for every candidate", count=len(c.materials), affected=[],
                root_cause="the germplasm export carries the pedigree columns but no values",
                evidence={"column": parent}, fix_status="not_fixable",
                fix="lineage reported as unavailable (never guessed)", impact="get_lineage returns no parents",
                sme_question="Can the export include FEMALE/MALE_PARENT_MATERIAL_GUID or the PEDIGREE string?"))
            break
    if c.lab_traits:
        issues.append(Issue(
            id="completeness.lab_trait_dictionary", category="completeness", severity="info",
            title="Lab traits identified only by GUID", count=len(c.lab_traits), affected=list(c.lab_traits),
            root_cause="the trait dictionary (name, unit, direction) is not part of the export",
            evidence={"traits": c.lab_traits}, fix_status="not_fixable",
            fix="traits shown as LAB_TRAIT_1..4 with their GUID", impact="lab traits cannot enter the rules",
            sme_question="What are the names, units and 'higher is better' direction of the four lab traits?"))
    if not tm.empty and {"location", "START_YEAR"} <= set(trials.columns):
        env = tm.merge(trials[["TRIAL_GUID", "location", "START_YEAR"]], on="TRIAL_GUID")
        n_env = env.groupby("MATERIAL_GUID")[["location", "START_YEAR"]].apply(lambda g: len(g.drop_duplicates()))
        single = int((n_env == 1).sum())
        if single:
            issues.append(Issue(
                id="design.single_environment", category="design", severity="warning",
                title="Each candidate was tested in a single location-year", count=single, affected=[],
                root_cause="trial design: the ~5 trials of a candidate share one location and year",
                evidence={"single_environment_candidates": single, "candidates": int(len(n_env))},
                fix_status="not_fixable", fix="reported; candidate rule counts trials, not environments",
                impact="G x E stability cannot be assessed",
                sme_question="Is advancement decided across locations/years in the real programme?"))

    return QualityReport(issues, trials, op_flags, pd.DataFrame(corrections), exclude)


def what_if_recomputed(trials: pd.DataFrame, trial_rules) -> dict:
    """How many verdicts would change if the rules used the recomputed aggregates?"""
    if "GBV_MEAN_RECOMPUTED" not in trials.columns:
        return {}
    alt = trials.copy()
    alt["GENOMIC_BREEDING_VALUE_MEAN"] = alt["GBV_MEAN_RECOMPUTED"]
    if "RESISTANT_PCT_RECOMPUTED" in alt.columns:
        alt["RESISTANT_MATERIAL_PCT"] = alt["RESISTANT_PCT_RECOMPUTED"]
    base = {d.record: d.computed_verdict for d in trial_rules.evaluate(trials)}
    new = {d.record: d.computed_verdict for d in trial_rules.evaluate(alt)}
    changed = [t for t in base if base[t] != new[t]]
    official = dict(zip(trials["TRIAL_ID"], trials.get("TRIAL_RECOMMENDATION", pd.Series(dtype=object))))
    parity_now = sum(base[t] == official.get(t) for t in base)
    parity_alt = sum(new[t] == official.get(t) for t in new)
    return {"verdicts_changed": len(changed), "changed_trials": changed[:20],
            "parity_with_reported_aggregates": parity_now,
            "parity_with_recomputed_aggregates": parity_alt,
            "reading": (f"parity drops from {parity_now} to {parity_alt} of {len(base)} when the recomputed "
                        f"aggregates replace the reported ones: the official verdicts were computed on the reported "
                        f"trial summaries, so the rules keep using those and the recomputed values stay as evidence")
                       if parity_alt < parity_now else
                       "recomputed aggregates reproduce the official verdicts at least as well as the reported ones"}


def diagnose_mismatches(trials: pd.DataFrame, rules_cfg: dict, calibration=None, k: int = 5) -> dict:
    """Root-cause every official-vs-engine disagreement, for each rule mode."""
    import copy

    from .rules import TrialRules

    crit_fields = [s["field"] for s in rules_cfg["thresholds"].values()]
    extra = rules_cfg["verdict"].get("pass_extra", {}).get("field")
    cols = crit_fields + ([extra] if extra else [])
    labelled = trials.dropna(subset=["TRIAL_RECOMMENDATION"]).set_index("TRIAL_ID")
    z = (labelled[cols] - labelled[cols].mean()) / labelled[cols].std(ddof=0)
    weighted_engine = TrialRules({"trial_rules": {**rules_cfg, "verdict": {**rules_cfg["verdict"],
                                                                          "mode": "weighted_severity"}}})
    weighted = {d.record: d.computed_verdict for d in weighted_engine.evaluate(labelled.reset_index())}
    band = None
    if calibration is not None:
        lo, hi = calibration.severity_cut_interval
        band = (lo, hi)

    out: dict[str, Any] = {}
    for mode in ("gate", "severity", "weighted_severity"):
        cfg = copy.deepcopy(rules_cfg)
        cfg["verdict"]["mode"] = mode
        eng = TrialRules({"trial_rules": cfg})
        cases = []
        for d in eng.evaluate(labelled.reset_index()):
            if d.agrees_with_official is not False:
                continue
            t = d.record
            nn = ((z - z.loc[t]) ** 2).sum(axis=1).drop(t).nsmallest(k).index
            nn_labels = labelled.loc[nn, "TRIAL_RECOMMENDATION"].tolist()
            agree_engine = sum(v == d.computed_verdict for v in nn_labels)
            agree_label = sum(v == d.official_verdict for v in nn_labels)
            sev_equal = eng.severity(labelled.loc[t], weighted=False)[0]
            if mode != "weighted_severity" and weighted.get(t) == d.official_verdict:
                category, why = "WEIGHTING", "the weighted-severity rule reproduces the official verdict"
            elif mode == "severity" and band and band[0] <= sev_equal <= band[1]:
                category, why = "BOUNDARY", f"severity {sev_equal:.3f} lies inside the CV cut interval {band}"
            elif agree_engine > agree_label:
                category, why = "LABEL_CONFLICT", f"{agree_engine}/{k} most similar trials carry the engine's verdict"
            else:
                category, why = "MISSING_FACTOR", f"{agree_label}/{k} most similar trials carry the official verdict"
            cases.append({"trial_id": t, "official": d.official_verdict, "engine": d.computed_verdict,
                          "category": category, "why": why,
                          "shortfalls": {n: round(v, 3) for n, v in eng.shortfalls(labelled.loc[t]).items()},
                          "p_fail_model": None if calibration is None else calibration.oof_probability.get(t),
                          "nearest_trials": dict(zip(nn, nn_labels))})
        counts: dict[str, int] = {}
        for c_ in cases:
            counts[c_["category"]] = counts.get(c_["category"], 0) + 1
        out[mode] = {"mismatches": len(cases), "by_category": counts, "cases": cases}
    return jsonable(out)
