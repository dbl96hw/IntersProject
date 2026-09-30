"""Layer 4: canonical model over the detected sources.

The exports use three join keys under several names (GID == MATERIAL_GUID,
ATTACHED_TO_FIELD_ENTITY_ID == TRIAL_GUID, FIELD_ID == LOCATION_GUID). We map
every alias to its canonical key and build a small star schema:

    materials      one row per candidate line      (candidate_id = MATERIAL_ID)
    trials         one row per field trial         (trial_id = TRIAL_ID) + official summary
    trial_material which candidates were tested in which trial (from observations)
    operations     planting / irrigation / harvest events
    genomics       one row per candidate
    lab            one row per candidate, one column per lab trait (mean of replicates)

GUIDs never reach the breeder: every entity also gets a human-readable label.
Cross-source consistency checks live here too, because disagreements between
sources are themselves evidence the breeder should see (not something to hide).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .detect import canonical_key


@dataclass
class Finding:
    """A data-quality or consistency observation, surfaced to the breeder as-is."""

    check: str
    severity: str             # info | warning | critical
    message: str
    metric: dict[str, Any] = field(default_factory=dict)
    examples: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Canonical:
    materials: pd.DataFrame
    trials: pd.DataFrame
    trial_material: pd.DataFrame
    operations: pd.DataFrame
    genomics: pd.DataFrame
    lab: pd.DataFrame
    lab_traits: dict[str, str]            # column label -> TRAIT_GUID
    sources_present: list[str]
    gaps: list[str] = field(default_factory=list)


def _canonicalise_keys(df: pd.DataFrame) -> pd.DataFrame:
    """Rename alias key columns to canonical names (only if the target is absent)."""
    rename = {}
    for col in df.columns:
        key = canonical_key(col)
        if key and key != col and key not in df.columns and key not in rename.values():
            rename[col] = key
    return df.rename(columns=rename)


def _first_existing(df: pd.DataFrame, cols: list[str]) -> list[str]:
    return [c for c in cols if c in df.columns]


def build(tables: dict[str, pd.DataFrame]) -> Canonical:
    """Build the canonical model from {source_name: frame} (frames may be concatenated drops)."""
    t = {name: _canonicalise_keys(df.copy()) for name, df in tables.items()}
    gaps: list[str] = []
    empty = pd.DataFrame()

    # --- materials (candidates) -------------------------------------------------
    germ = t.get("germplasm", empty)
    gen = t.get("genomics", empty)
    if not germ.empty:
        materials = germ[_first_existing(germ, ["MATERIAL_GUID", "MATERIAL_ID", "LINE_GUID", "STATUS_LID",
                                                "FEMALE_PARENT_MATERIAL_GUID", "MALE_PARENT_MATERIAL_GUID",
                                                "PEDIGREE", "GENERATION_CODE"])].drop_duplicates("MATERIAL_GUID")
    elif not gen.empty:
        materials = gen[["MATERIAL_GUID"]].drop_duplicates()
        gaps.append("germplasm source missing: candidate labels derived from GUIDs")
    else:
        materials = pd.DataFrame(columns=["MATERIAL_GUID"])
        gaps.append("no candidate master (germplasm/genomics) available")
    if "MATERIAL_ID" not in materials.columns:
        materials = materials.assign(MATERIAL_ID=[f"MAT-{i + 1:05d}" for i in range(len(materials))])
    materials = materials.rename(columns={"MATERIAL_ID": "candidate_id"}).reset_index(drop=True)
    for parent in ("FEMALE_PARENT_MATERIAL_GUID", "MALE_PARENT_MATERIAL_GUID"):
        if parent not in materials.columns or materials[parent].isna().all():
            gaps.append(f"pedigree: {parent} is empty in every record -> lineage cannot be reconstructed")
            break

    # --- genomics ---------------------------------------------------------------
    if not gen.empty:
        if "GENOTYPING_DATE" in gen.columns:
            gen = gen.assign(_d=pd.to_datetime(gen["GENOTYPING_DATE"], errors="coerce"))
            gen = gen.sort_values("_d").drop(columns="_d")
        genomics = gen.drop_duplicates("MATERIAL_GUID", keep="last").reset_index(drop=True)
    else:
        genomics = pd.DataFrame(columns=["MATERIAL_GUID"])
        gaps.append("genomics source missing")

    # --- lab: one column per trait (mean over replicates) -----------------------
    lab_raw = t.get("lab_observations", empty)
    lab_traits: dict[str, str] = {}
    if not lab_raw.empty and {"TRAIT_GUID", "NUMBER_VALUE"} <= set(lab_raw.columns):
        traits = sorted(lab_raw["TRAIT_GUID"].dropna().unique())
        lab_traits = {f"LAB_TRAIT_{i + 1}": g for i, g in enumerate(traits)}
        inverse = {g: k for k, g in lab_traits.items()}
        lab = (lab_raw.assign(trait=lab_raw["TRAIT_GUID"].map(inverse))
               .pivot_table(index="MATERIAL_GUID", columns="trait", values="NUMBER_VALUE", aggfunc="mean")
               .reset_index())
        lab.columns.name = None
        gaps.append(f"lab traits are identified only by TRAIT_GUID ({len(traits)} traits): "
                    f"names and units need the trait dictionary from the SME")
    else:
        lab = pd.DataFrame(columns=["MATERIAL_GUID"])
        gaps.append("lab observations missing")

    # --- trials -----------------------------------------------------------------
    trial = t.get("trial", empty)
    rec = t.get("trial_recommendations", empty)
    if not rec.empty and not trial.empty:
        # The master only contributes columns the summary does not already carry.
        extra = [c for c in _first_existing(trial, ["BEGIN_DATE", "NO_OF_REPLICATIONS", "TRIAL_TYPE_LID"])
                 if c not in rec.columns]
        trials = rec.merge(trial[["TRIAL_GUID"] + extra], on="TRIAL_GUID", how="left")
    elif not rec.empty:
        trials = rec.copy()
    elif not trial.empty:
        trials = trial.copy()
        gaps.append("trial summary (recommendations) missing: no official verdicts to compare against")
    else:
        trials = pd.DataFrame(columns=["TRIAL_GUID"])
        gaps.append("no trial data available")
    trials = trials.drop_duplicates("TRIAL_GUID").reset_index(drop=True)
    if "TRIAL_ID" not in trials.columns:
        trials["TRIAL_ID"] = [f"TR-{i + 1:04d}" for i in range(len(trials))]

    # Human-readable location labels (derived, stable: sorted GUID order).
    loc_guids = sorted(pd.concat([trials.get("LOCATION_GUID", pd.Series(dtype=object)),
                                  t.get("observations", empty).get("LOCATION_GUID", pd.Series(dtype=object))])
                       .dropna().unique())
    loc_label = {g: f"LOC-{i + 1:02d}" for i, g in enumerate(loc_guids)}
    if "LOCATION_GUID" in trials.columns:
        trials["location"] = trials["LOCATION_GUID"].map(loc_label)

    # --- operations and planting phase -----------------------------------------
    ops = t.get("operations", empty)
    if not ops.empty and {"TRIAL_GUID", "OPERATION_TYPE_LID", "OPERATION_DATE"} <= set(ops.columns):
        ops = ops.assign(OPERATION_DATE=pd.to_datetime(ops["OPERATION_DATE"], errors="coerce"))
        planting = (ops[ops["OPERATION_TYPE_LID"] == "PLANTING"]
                    .groupby("TRIAL_GUID")["OPERATION_DATE"].min().rename("PLANTING_DATE"))
        trials = trials.merge(planting, left_on="TRIAL_GUID", right_index=True, how="left")
        n_missing = int(trials["PLANTING_DATE"].isna().sum())
        if n_missing:
            gaps.append(f"{n_missing} trials have no PLANTING operation recorded")
    else:
        ops = pd.DataFrame()
        gaps.append("operations source missing or without TRIAL_GUID / type / date")

    # --- which candidates were tested where --------------------------------------
    obs = t.get("observations", empty)
    if not obs.empty and {"TRIAL_GUID", "MATERIAL_GUID"} <= set(obs.columns):
        agg = {"n_observations": ("MATERIAL_GUID", "size")}
        if "REPLICATION_NO" in obs.columns:
            agg["n_reps"] = ("REPLICATION_NO", "nunique")
        trial_material = obs.groupby(["TRIAL_GUID", "MATERIAL_GUID"]).agg(**agg).reset_index()
    else:
        trial_material = pd.DataFrame(columns=["TRIAL_GUID", "MATERIAL_GUID"])
        gaps.append("observations missing: cannot link candidates to trials")

    return Canonical(materials, trials, trial_material, ops,
                     genomics, lab, lab_traits, sorted(tables), gaps)


# ---------------------------------------------------------------------------
# Cross-source consistency checks
# ---------------------------------------------------------------------------

def consistency_checks(c: Canonical, tolerance_gbv: float = 1.0, tolerance_pct: float = 5.0) -> list[Finding]:
    findings: list[Finding] = []
    tm = c.trial_material

    # 1. Referential integrity: every linked material/trial exists in its master.
    if not tm.empty:
        orphan_m = set(tm["MATERIAL_GUID"]) - set(c.materials["MATERIAL_GUID"])
        orphan_t = set(tm["TRIAL_GUID"]) - set(c.trials["TRIAL_GUID"])
        sev = "critical" if (orphan_m or orphan_t) else "info"
        findings.append(Finding("referential_integrity", sev,
                                f"{len(orphan_m)} observed materials and {len(orphan_t)} observed trials "
                                f"are missing from their master tables",
                                {"orphan_materials": len(orphan_m), "orphan_trials": len(orphan_t)}))

    # 2. Trial-level genomic summaries vs the genomics of the materials actually observed.
    if not tm.empty and "GENOMIC_BREEDING_VALUE_MEAN" in c.trials.columns and "GENOMIC_BREEDING_VALUE" in c.genomics.columns:
        g = tm.merge(c.genomics[["MATERIAL_GUID", "GENOMIC_BREEDING_VALUE"] +
                                _first_existing(c.genomics, ["MARKER_DISEASE_RESISTANCE"])], on="MATERIAL_GUID")
        agg = g.groupby("TRIAL_GUID").agg(gbv_recomputed=("GENOMIC_BREEDING_VALUE", "mean"))
        if "MARKER_DISEASE_RESISTANCE" in g.columns:
            agg["resistant_pct_recomputed"] = g.groupby("TRIAL_GUID")["MARKER_DISEASE_RESISTANCE"].apply(
                lambda s: 100.0 * (s == "RESISTANT").mean())
        j = c.trials.merge(agg, left_on="TRIAL_GUID", right_index=True)
        d_gbv = (j["GENOMIC_BREEDING_VALUE_MEAN"] - j["gbv_recomputed"]).abs()
        n_bad = int((d_gbv > tolerance_gbv).sum())
        worst = j.assign(delta=d_gbv).nlargest(3, "delta")
        findings.append(Finding(
            "trial_gbv_reconciliation", "warning" if n_bad else "info",
            f"{n_bad}/{len(j)} trials report a GENOMIC_BREEDING_VALUE_MEAN that differs by more than "
            f"{tolerance_gbv} from the mean of the materials observed in them (median gap {d_gbv.median():.1f})",
            {"trials_checked": len(j), "trials_inconsistent": n_bad, "median_abs_gap": round(float(d_gbv.median()), 2),
             "max_abs_gap": round(float(d_gbv.max()), 2)},
            [{"trial_id": r.TRIAL_ID, "reported": r.GENOMIC_BREEDING_VALUE_MEAN,
              "recomputed": round(r.gbv_recomputed, 1)} for r in worst.itertuples()]))
        if "resistant_pct_recomputed" in j.columns and "RESISTANT_MATERIAL_PCT" in j.columns:
            d_res = (j["RESISTANT_MATERIAL_PCT"] - j["resistant_pct_recomputed"]).abs()
            n_bad = int((d_res > tolerance_pct).sum())
            findings.append(Finding(
                "trial_resistance_reconciliation", "warning" if n_bad else "info",
                f"{n_bad}/{len(j)} trials report a RESISTANT_MATERIAL_PCT that differs by more than "
                f"{tolerance_pct} points from the resistant share of their observed materials",
                {"trials_inconsistent": n_bad, "median_abs_gap_pts": round(float(d_res.median()), 1)}))

    # 3. Operations recorded for materials never observed in that trial.
    if not c.operations.empty and not tm.empty and {"TRIAL_GUID", "MATERIAL_GUID"} <= set(c.operations.columns):
        m = c.operations.merge(tm[["TRIAL_GUID", "MATERIAL_GUID"]], how="left", indicator=True)
        n_bad = int((m["_merge"] == "left_only").sum())
        findings.append(Finding(
            "operations_vs_observations", "warning" if n_bad else "info",
            f"{n_bad}/{len(m)} field operations refer to a material that has no observation in that trial",
            {"operations": len(m), "unmatched": n_bad}))

    # 4. Trial design: can across-environment stability (G x E) be assessed at all?
    if not tm.empty and {"location", "START_YEAR"} <= set(c.trials.columns):
        env = tm.merge(c.trials[["TRIAL_GUID", "location", "START_YEAR"]], on="TRIAL_GUID")
        n_env = env.groupby("MATERIAL_GUID").apply(lambda g: g[["location", "START_YEAR"]].drop_duplicates().shape[0],
                                                     include_groups=False)
        single = int((n_env == 1).sum())
        findings.append(Finding(
            "trial_design_environments", "warning" if single else "info",
            f"{single}/{len(n_env)} candidates were tested in a single location-year: stability across "
            f"environments (G x E) cannot be assessed; repeated trials there are not independent environments",
            {"single_environment_candidates": single, "max_environments": int(n_env.max())}))

    # 5. Genomic QC.
    if "QC_STATUS_LID" in c.genomics.columns:
        n_fail = int((c.genomics["QC_STATUS_LID"] != "PASS").sum())
        findings.append(Finding("genomics_qc", "warning" if n_fail else "info",
                                f"{n_fail}/{len(c.genomics)} genomic samples did not pass QC",
                                {"failed": n_fail}))

    for gap in c.gaps:
        findings.append(Finding("data_gap", "info", gap))
    return findings


def material_trial_view(c: Canonical) -> pd.DataFrame:
    """Long view: one row per (candidate, trial) with the trial summary attached."""
    cols = _first_existing(c.trials, ["TRIAL_GUID", "TRIAL_ID", "location", "START_YEAR", "YIELD_T_HA",
                                      "MOISTURE_PCT", "DISEASE_SCORE", "PLANT_HEIGHT_CM", "FLOWERING_DAYS",
                                      "TRIAL_RECOMMENDATION"])
    v = c.trial_material.merge(c.trials[cols], on="TRIAL_GUID", how="left")
    return v.merge(c.materials[["MATERIAL_GUID", "candidate_id"]], on="MATERIAL_GUID", how="left")


def jsonable(value: Any) -> Any:
    """Convert numpy / pandas scalars and containers into plain JSON types."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        if not np.isfinite(value):
            return None
        v = float(value)
        # 6 decimals for ordinary numbers; 4 significant digits for tiny ones, so
        # numerical-error diagnostics (1e-16) are not rounded away to 0.
        return round(v, 6) if v == 0.0 or abs(v) >= 1e-4 else float(f"{v:.4g}")
    if isinstance(value, (pd.Timestamp,)):
        return value.isoformat() if not pd.isna(value) else None
    if value is pd.NaT or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, np.bool_):
        return bool(value)
    return value
