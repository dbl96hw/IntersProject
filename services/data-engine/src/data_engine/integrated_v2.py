"""Integrated V2 drop (2026-10-02, "integrated V2 (fixed)"): canonical model, recomputation, quality.

What changed against the 29-Sep drop, and how the engine reads it:

* The official suggestion is per CANDIDATE: candidate_recommendations.SYSTEM_RAG (GREEN / AMBER / RED)
  with SYSTEM_REASON and CAVEATS. There is no trial summary (trial_recommendations) and no trial master.
* trial_germplasm_bridge has one row per trial entry (plot): TRIAL_ENTRY_GUID, TRIAL_GUID, TRIAL_ID,
  MATERIAL_GUID, FIELD_ENTITY_ID and the role (TRIAL_ENTRY or CHECK). 72 trials x 24 entries = 1728.
* observation rows point to the entry (TRIAL_ENTRY_RELATIONSHIP_GUID) and the trait (TRAIT_GUID /
  TRAIT_CODE); trait_dictionary gives the name, unit and better direction of all 6 traits.
  In this drop FIELD_ID is the trial and ATTACHED_TO_FIELD_ENTITY_ID the plot entity (in the 29-Sep drop
  they were the location and the trial). Their meaning changed between drops, so they are read
  explicitly here and never through the generic key aliases of sources.yaml.
* operations_field_updates are attached to a plot entity: planned vs actual date, status, delay and
  the channel the update came in by (EXCEL, FIELD_APP, PAPER, WHATSAPP, PDF_REPORT).

Every number of the official summary is recomputed from the raw tables (trials, usable trials, yield
vs checks, disease, moisture, germination, fumonisin) and compared with the reported value. Agreement
within rounding is the proof that the sources were joined correctly; a disagreement is a finding.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .canonical import Canonical, Finding
from .quality import Issue, QualityReport, _ids

V2_SOURCES = {"candidate_recommendations", "trial_germplasm_bridge"}
MAT, TRIAL, ENTRY = "MATERIAL_GUID", "TRIAL_GUID", "TRIAL_ENTRY_GUID"
OFFLINE_CHANNELS = ("PAPER", "WHATSAPP", "PDF_REPORT")
# Reported value -> (recomputed column, tolerance). The tolerance is half a unit of the last decimal the
# export prints (plus float noise): anything inside it is rounding, anything outside is a real difference.
RECOMPUTED = {"N_TRIALS": ("n_trials", 0.0), "N_TRIALS_USED": ("n_trials_used", 0.0),
              "YIELD_VS_CHECK_PCT": ("yield_vs_check_pct", 0.0501), "DISEASE_SCORE_MEAN": ("disease_mean", 0.00501),
              "MOISTURE_PCT_MEAN": ("moisture_mean", 0.0501), "GERMINATION_PCT": ("lab_GERMINATION_PCT", 0.0501),
              "FUMONISIN_PPM": ("lab_FUMONISIN_PPM", 0.00501)}


def is_v2(merged: dict[str, pd.DataFrame]) -> bool:
    return V2_SOURCES <= set(merged)


@dataclass
class V2Model:
    canonical: Canonical
    recommendations: pd.DataFrame          # candidate_recommendations as exported (system of record)
    candidates: pd.DataFrame               # recomputed candidate metrics, one row per MATERIAL_GUID
    trial_material: pd.DataFrame           # per (trial, material): role, trait means, check yield, used
    operations: pd.DataFrame               # field updates with TRIAL_GUID and flags
    traits: pd.DataFrame                   # trait dictionary
    excluded_trials: set[str]
    recomputation: dict[str, Any] = field(default_factory=dict)
    references: dict[str, Any] = field(default_factory=dict)


def _ref(child: pd.Series, parent: pd.Series) -> dict:
    vals = child.dropna()
    ok = int(vals.isin(set(parent.dropna())).sum())
    return {"references": int(len(vals)), "resolved": ok, "share": round(ok / len(vals), 4) if len(vals) else None}


def build(merged: dict[str, pd.DataFrame], cfg: dict) -> V2Model:
    empty = pd.DataFrame()
    ped = merged.get("germplasm", empty)
    rec = merged["candidate_recommendations"].drop_duplicates(MAT).reset_index(drop=True)
    br = merged["trial_germplasm_bridge"].drop_duplicates(ENTRY)
    obs = merged.get("observations", empty)
    ops = merged.get("field_operations", empty)
    lab_raw = merged.get("lab_observations", empty)
    gen = merged.get("genomics", empty)
    td = merged.get("trait_dictionary", empty)
    gaps: list[str] = []

    # --- traits: names instead of GUIDs --------------------------------------------------------
    code_of = dict(zip(td.get("TRAIT_GUID", []), td.get("TRAIT_CODE", [])))

    # --- materials: the pedigree is the master (150 candidates + 2 commercial checks) -------------
    roles = br.groupby(MAT)["ENTRY_ROLE_LID"].agg(lambda s: "check" if (s == "CHECK").any() else "entry")
    master = ped if not ped.empty else rec
    keep = [c for c in (MAT, "MATERIAL_ID", "LINE_GUID", "HIGHNAME", "STATUS_LID", "FEMALE_PARENT_MATERIAL_GUID",
                        "MALE_PARENT_MATERIAL_GUID", "PEDIGREE", "GENERATION_CODE") if c in master.columns]
    materials = master[keep].drop_duplicates(MAT).rename(columns={"MATERIAL_ID": "candidate_id"}).reset_index(drop=True)
    is_candidate = materials[MAT].isin(set(rec[MAT]))
    materials["role"] = ["candidate" if c else ("check" if roles.get(g) == "check" else "other")
                         for g, c in zip(materials[MAT], is_candidate)]
    for parent in ("FEMALE_PARENT_MATERIAL_GUID", "MALE_PARENT_MATERIAL_GUID"):
        if parent not in materials.columns or materials[parent].isna().all():
            gaps.append(f"pedigree: {parent} is empty in every record -> lineage cannot be reconstructed")
            break

    # --- operations: plot entity -> trial; flags ---------------------------------------------------
    entity_trial = dict(zip(br["FIELD_ENTITY_ID"], br[TRIAL]))
    trial_id_of = dict(zip(br[TRIAL], br["TRIAL_ID"]))
    if not ops.empty:
        ops = ops.copy()
        ops[TRIAL] = ops["ATTACHED_TO_FIELD_ENTITY_ID"].map(entity_trial)
        ops["TRIAL_ID"] = ops[TRIAL].map(trial_id_of)
        for col in ("PLANNED_DATE", "ACTUAL_DATE", "SEEDSDL_UPDATE_DATE"):
            if col in ops.columns:
                ops[col] = pd.to_datetime(ops[col], errors="coerce")
        status = ops["STATUS_LID"].astype(str).str.upper()
        ops["IS_DELAYED"] = status.eq("DELAYED")
        ops["IS_MISSED"] = status.eq("MISSED")
        ops["IS_OFFLINE"] = ops["RECORDED_VIA"].astype(str).str.upper().isin(OFFLINE_CHANNELS)
        excluded = set(ops.loc[ops["IS_MISSED"] & ops["OPERATION_TYPE_LID"].astype(str).str.upper()
                               .isin([s.upper() for s in cfg.get("exclude_trial_if_missed", [])]), TRIAL].dropna())
    else:
        excluded = set()
        gaps.append("field operations missing: no trial can be excluded for a missed operation")

    # --- observations: plot values -> per (trial, material) means --------------------------------
    entries = br[[ENTRY, TRIAL, "TRIAL_ID", MAT, "ENTRY_ROLE_LID", "REPLICATION_NO"]].rename(
        columns={"REPLICATION_NO": "ENTRY_REP"})
    if not obs.empty and "TRIAL_ENTRY_RELATIONSHIP_GUID" in obs.columns:
        o = obs.copy()
        o["trait"] = o["TRAIT_CODE"] if "TRAIT_CODE" in o.columns else o["TRAIT_GUID"].map(code_of)
        o = o.drop(columns=[c for c in (TRIAL, MAT, "TRIAL_ID") if c in o.columns]).merge(
            entries, left_on="TRIAL_ENTRY_RELATIONSHIP_GUID", right_on=ENTRY, how="inner")
        tm = (o.pivot_table(index=[TRIAL, "TRIAL_ID", MAT, "ENTRY_ROLE_LID"], columns="trait",
                            values="NUMBER_VALUE", aggfunc="mean").reset_index())
        tm.columns.name = None
        n_reps = o.groupby([TRIAL, MAT])["ENTRY_REP"].nunique().rename("n_reps")
        tm = tm.merge(n_reps, left_on=[TRIAL, MAT], right_index=True, how="left")
    else:
        tm = entries.groupby([TRIAL, "TRIAL_ID", MAT, "ENTRY_ROLE_LID"]).size().rename("n_entries").reset_index()
        gaps.append("observations missing: no trait values per trial")
    if "YIELD_T_HA" in tm.columns:
        check_yield = tm[tm["ENTRY_ROLE_LID"] == "CHECK"].groupby(TRIAL)["YIELD_T_HA"].mean().rename("CHECK_YIELD_T_HA")
        tm = tm.merge(check_yield, left_on=TRIAL, right_index=True, how="left")
        tm["YIELD_VS_CHECK_PCT"] = 100.0 * tm["YIELD_T_HA"] / tm["CHECK_YIELD_T_HA"]
    tm["used"] = (tm["ENTRY_ROLE_LID"] == "TRIAL_ENTRY") & ~tm[TRIAL].isin(excluded)
    tm["excluded_reason"] = tm[TRIAL].map(lambda t: "irrigation missed" if t in excluded else None)

    # --- lab: one column per trait code ------------------------------------------------------------
    if not lab_raw.empty and {"TRAIT_GUID", "NUMBER_VALUE"} <= set(lab_raw.columns):
        lab = (lab_raw.assign(trait=lab_raw["TRAIT_GUID"].map(code_of).fillna(lab_raw["TRAIT_GUID"]))
               .pivot_table(index=MAT, columns="trait", values="NUMBER_VALUE", aggfunc="mean").reset_index())
        lab.columns.name = None
        lab_traits = {c: g for g, c in code_of.items() if c in lab.columns}
    else:
        lab, lab_traits = pd.DataFrame(columns=[MAT]), {}
        gaps.append("lab observations missing")

    genomics = gen.drop_duplicates(MAT, keep="last").reset_index(drop=True) if not gen.empty \
        else pd.DataFrame(columns=[MAT])

    # --- recompute the official candidate summary from the raw tables -------------------------------
    ent = tm[tm["ENTRY_ROLE_LID"] == "TRIAL_ENTRY"]
    used = ent[ent["used"]]
    cand = pd.DataFrame({MAT: rec[MAT]}).set_index(MAT)
    cand["n_trials"] = ent.groupby(MAT)[TRIAL].nunique()
    cand["n_trials_used"] = used.groupby(MAT)[TRIAL].nunique()
    cand[["n_trials", "n_trials_used"]] = cand[["n_trials", "n_trials_used"]].fillna(0).astype(int)
    if "YIELD_VS_CHECK_PCT" in used.columns:
        grp = used.groupby(MAT)
        # Ratio of means over the usable trials (not the mean of per-trial ratios): this is what
        # reproduces the export to the printed decimal.
        cand["yield_vs_check_pct"] = 100.0 * grp["YIELD_T_HA"].mean() / grp["CHECK_YIELD_T_HA"].mean()
        cand["MEAN_YIELD_T_HA"] = grp["YIELD_T_HA"].mean()
    for col, name in (("DISEASE_SCORE", "disease_mean"), ("MOISTURE_PCT", "moisture_mean")):
        if col in used.columns:
            cand[name] = used.groupby(MAT)[col].mean()
    cand = cand.join(lab.set_index(MAT).add_prefix("lab_"), how="left").reset_index()

    recomputation: dict[str, Any] = {}
    joined = rec.merge(cand, on=MAT, how="left")
    for reported, (mine, tol) in RECOMPUTED.items():
        if reported not in joined.columns or mine not in joined.columns:
            continue
        a = pd.to_numeric(joined[reported], errors="coerce")
        b = pd.to_numeric(joined[mine], errors="coerce")
        both = a.notna() & b.notna()
        diff = (a[both] - b[both]).abs()
        off = joined.loc[both[both].index[diff > tol], "MATERIAL_ID"].tolist() if len(diff) else []
        recomputation[reported] = {"compared": int(both.sum()), "max_abs_diff": round(float(diff.max()), 4) if len(diff) else None,
                                   "tolerance": tol, "outside_tolerance": len(off), "examples": off[:5],
                                   "missing_on_one_side": int((a.notna() ^ b.notna()).sum())}

    # --- trials: only what the bridge and the operations can tell ------------------------------------
    trials = br.groupby([TRIAL, "TRIAL_ID"]).agg(
        n_entries=(ENTRY, "size"), n_materials=(MAT, "nunique"),
        n_checks=("ENTRY_ROLE_LID", lambda s: int((s == "CHECK").sum())),
        n_reps=("REPLICATION_NO", "nunique")).reset_index()
    if not ops.empty and "ACTUAL_DATE" in ops.columns:
        sowing = ops[ops["OPERATION_TYPE_LID"].astype(str).str.upper() == "SOWING"]
        date = sowing.groupby(TRIAL)["ACTUAL_DATE"].min().combine_first(sowing.groupby(TRIAL)["PLANNED_DATE"].min())
        trials = trials.merge(date.rename("SOWING_DATE"), left_on=TRIAL, right_index=True, how="left")
        trials["START_YEAR"] = trials["SOWING_DATE"].dt.year       # derived: the drop has no trial master
        flags = ops.groupby(TRIAL)[["IS_DELAYED", "IS_MISSED", "IS_OFFLINE"]].sum().astype(int)
        trials = trials.merge(flags, left_on=TRIAL, right_index=True, how="left")
    trials["location"] = None
    trials["excluded_for_candidates"] = trials[TRIAL].isin(excluded)
    if "CHECK_YIELD_T_HA" in tm.columns:
        trials = trials.merge(tm.groupby(TRIAL)["CHECK_YIELD_T_HA"].first(), left_on=TRIAL, right_index=True,
                              how="left")
    gaps.append("no trial master in the V2 drop: trial location is unknown and the year is derived from the "
                "SOWING operation date")
    if "BREEDER_DECISION" in rec.columns and rec["BREEDER_DECISION"].isna().all():
        gaps.append(f"BREEDER_DECISION is empty for all {len(rec)} candidates: no decision has been recorded yet")

    trial_material = tm.rename(columns={"ENTRY_ROLE_LID": "role"})
    canonical = Canonical(materials, trials, trial_material[[TRIAL, MAT, "role", "used"]
                                                             + [c for c in ("n_reps",) if c in trial_material]],
                          ops, genomics, lab, lab_traits, sorted(merged), gaps)

    references = {}
    pedigree_keys = materials[MAT]
    if not br.empty:
        references["bridge.MATERIAL_GUID -> pedigree"] = _ref(br[MAT], pedigree_keys)
    if not obs.empty:
        references["observation.TRIAL_ENTRY_RELATIONSHIP_GUID -> bridge"] = _ref(obs.get("TRIAL_ENTRY_RELATIONSHIP_GUID", pd.Series(dtype=object)), br[ENTRY])
        references["observation.FIELD_ID -> bridge.TRIAL_GUID"] = _ref(obs.get("FIELD_ID", pd.Series(dtype=object)), br[TRIAL])
        references["observation.GID -> pedigree"] = _ref(obs.get("GID", pd.Series(dtype=object)), pedigree_keys)
        references["observation.TRAIT_GUID -> trait dictionary"] = _ref(obs.get("TRAIT_GUID", pd.Series(dtype=object)), td.get("TRAIT_GUID", pd.Series(dtype=object)))
    if not ops.empty:
        references["operations.ATTACHED_TO_FIELD_ENTITY_ID -> bridge"] = _ref(ops["ATTACHED_TO_FIELD_ENTITY_ID"], br["FIELD_ENTITY_ID"])
    if not lab_raw.empty:
        references["lab.MATERIAL_GUID -> pedigree"] = _ref(lab_raw[MAT], pedigree_keys)
        references["lab.TRAIT_GUID -> trait dictionary"] = _ref(lab_raw["TRAIT_GUID"], td.get("TRAIT_GUID", pd.Series(dtype=object)))
    if not gen.empty:
        references["genomics.MATERIAL_GUID -> pedigree"] = _ref(gen[MAT], pedigree_keys)
    references["candidate_recommendations.MATERIAL_GUID -> pedigree"] = _ref(rec[MAT], pedigree_keys)

    return V2Model(canonical, rec, cand, trial_material, ops, td, excluded, recomputation, references)


def trial_verdict(row: pd.Series, rag: dict) -> str:
    """The candidate's result in ONE trial with the official thresholds (an engine view, not official):
    FAIL if a must-pass fails there (yield vs checks, disease), HOLD if a target fails, else PASS."""
    if not row.get("used", True):
        return "EXCLUDED"
    c = rag["criteria"]
    yvc, dis, moi = row.get("YIELD_VS_CHECK_PCT"), row.get("DISEASE_SCORE"), row.get("MOISTURE_PCT")
    if (yvc is not None and yvc < c["yield_vs_check"]["must_pass"]) or (dis is not None and dis > c["disease"]["must_pass"]):
        return "FAIL"
    if (yvc is not None and yvc < c["yield_vs_check"]["target"]) or (dis is not None and dis > c["disease"]["target"]) \
            or (moi is not None and moi > c["moisture"]["target"]):
        return "HOLD"
    return "PASS"


def trial_statement(row: pd.Series) -> str:
    parts = []
    if pd.notna(row.get("YIELD_T_HA")):
        parts.append(f"yield {row['YIELD_T_HA']:.2f} t/ha")
    if pd.notna(row.get("YIELD_VS_CHECK_PCT")):
        parts.append(f"{row['YIELD_VS_CHECK_PCT']:.1f}% of checks")
    if pd.notna(row.get("DISEASE_SCORE")):
        parts.append(f"disease {row['DISEASE_SCORE']:.2f}")
    if pd.notna(row.get("MOISTURE_PCT")):
        parts.append(f"moisture {row['MOISTURE_PCT']:.1f}%")
    text = ", ".join(parts)
    reason = row.get("excluded_reason")
    return text + (f" (excluded: {reason})" if isinstance(reason, str) and reason else "")


def quality(v: V2Model, old_trials: pd.DataFrame | None = None) -> QualityReport:
    """The V2 data issues, each with its root cause and what the engine does about it."""
    issues: list[Issue] = []
    rec, ops, c = v.recommendations, v.operations, v.canonical

    overlap = None
    if old_trials is not None and "TRIAL_GUID" in old_trials.columns:
        overlap = int(c.trials["TRIAL_GUID"].isin(set(old_trials["TRIAL_GUID"])).sum())
    issues.append(Issue(
        id="design.no_trial_master", category="design", severity="warning",
        title="No trial table in the V2 drop: trial location and year are unknown",
        count=len(c.trials), affected=_ids(c.trials["TRIAL_ID"]),
        root_cause=("the drop ships the trial-germplasm bridge but no trial master; its TRIAL_GUIDs do not match "
                    "the deprecated trial table" + (f" ({overlap} of {len(c.trials)} match)" if overlap is not None else "")
                    + ", so location and year cannot be joined"),
        evidence={"trials": len(c.trials), "matching_deprecated_trial_guids": overlap,
                  "year_source": "SOWING operation date (derived)"},
        fix_status="not_fixable", fix="season year derived from the SOWING date; location left empty, never guessed",
        impact="G x E (location / year effects) cannot be assessed; candidate colours do not depend on it",
        sme_question="Can you share the V2 trial master (location, year, design)?"))

    if "BREEDER_DECISION" in rec.columns:
        empty = rec["BREEDER_DECISION"].isna()
        if empty.any():
            rag = rec["SYSTEM_RAG"].value_counts().to_dict() if "SYSTEM_RAG" in rec.columns else {}
            issues.append(Issue(
                id="decision.breeder_decision_empty", category="completeness", severity="info",
                title="No breeder decision recorded yet", count=int(empty.sum()),
                affected=_ids(rec.loc[empty, "MATERIAL_ID"]),
                root_cause=f"BREEDER_DECISION and BREEDER_COMMENT are empty for {int(empty.sum())} of {len(rec)} "
                           f"candidates; the system suggestion is {rag}",
                evidence={"empty": int(empty.sum()), "system_rag": rag},
                fix_status="proposed", fix="the Breeder's Desk records it: pass / no pass per candidate and colour "
                                           "overrides with a reason, append-only",
                impact="this is the gap the product closes: suggestion -> decision with an audit trail"))

    no_field = rec.loc[pd.to_numeric(rec.get("N_TRIALS_USED"), errors="coerce").fillna(0) == 0, "MATERIAL_ID"]
    if len(no_field):
        issues.append(Issue(
            id="completeness.genotyped_without_trials", category="completeness", severity="info",
            title="Lines genotyped but not yet in any trial", count=len(no_field), affected=_ids(no_field),
            root_cause="present in pedigree and genomics, absent from the trial-germplasm bridge",
            evidence={"lines": no_field.tolist()}, fix_status="none_needed",
            fix="kept AMBER with the official reason 'No field data yet (genotyped only)'",
            impact="no performance claim is made for them"))

    checks = c.materials.loc[c.materials["role"] == "check", "candidate_id"]
    if len(checks):
        n_check_entries = int((v.trial_material["role"] == "CHECK").sum())
        issues.append(Issue(
            id="design.commercial_checks", category="design", severity="info",
            title="Commercial checks are reference entries, not candidates", count=len(checks), affected=_ids(checks),
            root_cause="the bridge marks them ENTRY_ROLE_LID = CHECK; they are in the pedigree but not in the "
                       "candidate recommendations",
            evidence={"checks": checks.tolist(), "check_plots_per_trial_material": n_check_entries},
            fix_status="none_needed", fix="used only as the yield reference ('yield vs checks'); never triaged",
            impact="yield vs checks is recomputed per trial against the mean of both checks"))

    if not ops.empty:
        delayed, missed, offline = ops[ops["IS_DELAYED"]], ops[ops["IS_MISSED"]], ops[ops["IS_OFFLINE"]]
        if len(delayed):
            d = pd.to_numeric(delayed.get("DELAY_DAYS"), errors="coerce")
            issues.append(Issue(
                id="operations.delayed", category="temporal", severity="info",
                title="Field operations done late", count=len(delayed), affected=_ids(delayed["TRIAL_ID"]),
                root_cause="actual date after the planned date",
                evidence={"by_type": delayed["OPERATION_TYPE_LID"].value_counts().to_dict(),
                          "delay_days": {"min": float(d.min()), "median": float(d.median()), "max": float(d.max())}},
                fix_status="none_needed", fix="reported; delays do not exclude a trial in the official rule",
                impact="context for the breeder"))
        if len(missed):
            affected_cands = v.trial_material.loc[(v.trial_material["role"] == "TRIAL_ENTRY")
                                                  & v.trial_material["TRIAL_GUID"].isin(v.excluded_trials), "MATERIAL_GUID"]
            names = rec.loc[rec["MATERIAL_GUID"].isin(set(affected_cands)), "MATERIAL_ID"]
            issues.append(Issue(
                id="operations.missed", category="completeness", severity="warning",
                title="Field operations not done (trial excluded for its candidates)", count=len(missed),
                affected=_ids(missed["TRIAL_ID"]),
                root_cause="STATUS_LID = MISSED; a missed IRRIGATION makes the trial unusable",
                evidence={"by_type": missed["OPERATION_TYPE_LID"].value_counts().to_dict(),
                          "trials_excluded": sorted(missed["TRIAL_ID"].dropna().unique().tolist()),
                          "candidates_with_one_trial_excluded": int(names.nunique())},
                fix_status="applied",
                fix="those trials are excluded from the candidates' usable trials, as in the official caveat "
                    "'1 trial(s) excluded: irrigation missed'",
                impact=f"{int(names.nunique())} candidates are judged on fewer trials"))
        if len(offline):
            issues.append(Issue(
                id="operations.recorded_offline", category="provenance", severity="warning",
                title="Field updates that arrived outside the system (paper, WhatsApp, PDF)", count=len(offline),
                affected=_ids(offline["TRIAL_ID"]),
                root_cause="RECORDED_VIA is PAPER, WHATSAPP or PDF_REPORT: the data was re-typed by hand",
                evidence={"by_channel": offline["RECORDED_VIA"].value_counts().to_dict(),
                          "all_channels": ops["RECORDED_VIA"].value_counts().to_dict()},
                fix_status="proposed",
                fix="upload the original PDF / photo / note: the engine reads it (OCR when needed), checks it is "
                    "about breeding, and links the candidates and trials it names",
                impact="the unstructured channel this use case is about"))

    for gap in c.gaps:
        if gap.startswith("pedigree:"):
            issues.append(Issue(
                id="completeness.pedigree_empty", category="completeness", severity="info",
                title="Pedigree parents empty", count=len(c.materials), affected=[],
                root_cause="FEMALE_PARENT_MATERIAL_GUID and MALE_PARENT_MATERIAL_GUID are exported without values",
                evidence={}, fix_status="not_fixable", fix="lineage reported as unavailable",
                impact="no parent-based reasoning"))

    bad_refs = {k: r for k, r in v.references.items() if r["share"] is not None and r["share"] < 1}
    issues.append(Issue(
        id="integrity.referential", category="linkage", severity="warning" if bad_refs else "info",
        title="Referential integrity across the V2 tables",
        count=sum(r["references"] - r["resolved"] for r in v.references.values()), affected=sorted(bad_refs)[:12],
        root_cause=("every reference resolves" if not bad_refs else "some references point to missing keys"),
        evidence=v.references, fix_status="none_needed" if not bad_refs else "proposed",
        fix="checked on every build", impact="no row is silently dropped by a join"))

    off = {k: s for k, s in v.recomputation.items() if s["outside_tolerance"]}
    issues.append(Issue(
        id="consistency.summary_recomputed", category="aggregation", severity="warning" if off else "info",
        title="Official candidate summary recomputed from the raw tables",
        count=sum(s["outside_tolerance"] for s in v.recomputation.values()),
        affected=[f"{k}: {s['examples']}" for k, s in off.items()][:12],
        root_cause=("all metrics agree with the export within rounding" if not off else
                    "some metrics differ from the export beyond rounding"),
        evidence=v.recomputation, fix_status="none_needed" if not off else "proposed",
        fix="yield vs checks = mean candidate yield / mean check yield over the usable trials; disease and "
            "moisture are means over usable trials; lab values are means over replicates",
        impact="the colours rest on numbers the engine can reproduce from the plots"))

    ops_flags = ops if not ops.empty else pd.DataFrame()
    return QualityReport(issues, c.trials, ops_flags, pd.DataFrame(columns=["record", "field", "original", "derived",
                                                                           "status", "method"]))


def findings(v: V2Model) -> list[Finding]:
    out = [Finding("recomputed_summary", "info" if not s["outside_tolerance"] else "warning",
                   f"{k}: recomputed for {s['compared']} candidates, max |diff| {s['max_abs_diff']} "
                   f"(tolerance {s['tolerance']})", {"outside_tolerance": s["outside_tolerance"]})
           for k, s in v.recomputation.items()]
    out += [Finding("data_gap", "info", g) for g in v.canonical.gaps]
    return out
