"""Verification report for every run: numerical error, integrity, drift, topology.

1. Numerical error. Each identity the maths relies on is re-measured on the
   actual data, with a tolerance and a pass/fail:
     * SVD round trip        ||Xc - U S V^T||_F / ||Xc||_F                 ~ 1e-15
     * orthogonality         max |V^T V - I|, max |U^T U - I|             ~ 1e-15
     * eigen-equation        max_i ||Sigma v_i - lambda_i v_i|| / lambda_1
     * Eckart-Young identity measured truncation error == certified one
     * whitening             max |cov(W) - I|
     * Mahalanobis           element-wise (eigenbasis) vs explicit pseudo-inverse
     * T^2 decomposition     sum of per-feature contributions == T^2
     * encodings             Helmert bases orthonormal, orthogonal to 1
     * evidence re-read      every value cited by the rules equals the table value
   plus the condition numbers and the digits they can cost (log10 kappa).

2. Integrity (no silent data loss): SHA-256 and shape of every input, canonical
   row counts, key coverage (every material/trial key seen in any source is in
   the canonical model), duplicate keys dropped.

3. Drift against the previous run: schema changes, input hash changes, and per
   column the Population Stability Index (PSI, on the previous run's decile
   edges; < 0.1 stable, 0.1-0.25 moderate, > 0.25 major) or the total-variation
   distance for categorical columns.

4. Topology (0-dimensional persistent homology). On the whitened candidate
   cloud, the H0 barcode of the Vietoris-Rips filtration is exactly the set of
   minimum-spanning-tree edge lengths (single linkage). It is coordinate-free
   and stable (bottleneck-stable under perturbations of the points), so it is a
   robust fingerprint of the *shape* of the data: long bars = well-separated
   groups. Between runs we compare the barcodes with the 1-Wasserstein distance
   of the sorted death times. H1 (loops) is added when `ripser` is installed.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .canonical import jsonable
from .encode import helmert_basis

EPS = float(np.finfo(float).eps)


def _check(name: str, value: float, tol: float, note: str = "") -> dict:
    return {"check": name, "value": float(value), "tolerance": tol, "passed": bool(value <= tol), "note": note}


# --------------------------------------------------------------------------- 1. numerical
def numerical(x: np.ndarray, spectral, evidence_mismatches: int | None = None) -> dict:
    xc = x - x.mean(axis=0)
    u, s, vt = np.linalg.svd(xc, full_matrices=False)
    norm = np.linalg.norm(xc)
    n = x.shape[0]
    checks = [
        _check("svd_roundtrip_rel", np.linalg.norm(xc - (u * s) @ vt) / norm, 1e-12,
               "diagonalise and come back: X = U S V^T"),
        _check("orthogonality_V", np.abs(vt @ vt.T - np.eye(len(s))).max(), 1e-12),
        _check("orthogonality_U", np.abs(u.T @ u - np.eye(len(s))).max(), 1e-12),
    ]
    cov = xc.T @ xc / (n - 1)
    lam = s ** 2 / (n - 1)
    resid = max(np.linalg.norm(cov @ vt[i] - lam[i] * vt[i]) for i in range(len(s))) / lam[0]
    checks.append(_check("eigen_equation_residual", resid, 1e-10, "Sigma v = lambda v"))

    if spectral is not None:
        k = spectral.k
        approx = spectral.scores(x) @ spectral.components.T
        measured = np.linalg.norm(xc - approx) ** 2 / norm ** 2
        checks.append(_check("eckart_young_identity", abs(measured - spectral.truncation_error_rel), 1e-10,
                             f"measured {measured:.6g} vs certified {spectral.truncation_error_rel:.6g} (k={k})"))
        w = spectral.whiten(x)
        checks.append(_check("whitening_cov_error", np.abs(np.cov(w, rowvar=False) - np.eye(k)).max(), 1e-8))
        # Mahalanobis via the eigenbasis vs an explicit pseudo-inverse restricted to the same subspace.
        proj = spectral.components @ spectral.components.T
        pinv = np.linalg.pinv(proj @ cov @ proj, rcond=1e-12)
        explicit = np.einsum("ij,jk,ik->i", xc, pinv, xc)
        t2 = spectral.hotelling_t2(x)
        checks.append(_check("mahalanobis_vs_pinv_rel", np.max(np.abs(t2 - explicit) / np.maximum(explicit, 1e-12)),
                             1e-6, "element-wise eigenbasis formula vs explicit inverse"))
        contrib = np.array([spectral.contributions(x[i]).sum() for i in range(n)])
        checks.append(_check("t2_contribution_sum", np.max(np.abs(contrib - t2)), 1e-9))
    helm = max(max(np.abs(helmert_basis(k).T @ helmert_basis(k) - np.eye(k - 1)).max(),
                   np.abs(np.ones(k) @ helmert_basis(k)).max()) for k in range(2, 9))
    checks.append(_check("helmert_orthonormal_and_trivial_free", helm, 1e-12))
    if evidence_mismatches is not None:
        checks.append(_check("evidence_reread_mismatches", evidence_mismatches, 0, "cited value == table value"))

    kappa = float(s[0] / s[-1]) if s[-1] > 0 else float("inf")
    return {
        "checks": checks,
        "passed": all(c["passed"] for c in checks),
        "machine_epsilon": EPS,
        "condition_number_data": kappa,
        "condition_number_covariance": kappa ** 2,
        "digits_at_risk_data": round(float(np.log10(kappa)), 2),
        "digits_at_risk_if_covariance_were_formed": round(float(2 * np.log10(kappa)), 2),
        "reading": "all identities hold to machine precision" if all(c["passed"] for c in checks)
        else "some identities exceed tolerance: see checks",
    }


# --------------------------------------------------------------------------- 2. integrity
def sha256(path: str | Path) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def integrity(tables, model) -> dict:
    """Inputs (hash, shape) and proof that no key was lost on the way to the canonical model."""
    from .detect import canonical_key

    inputs = []
    seen_materials, seen_trials = set(), set()
    for t in tables:
        inputs.append({"table": t.name, "source": t.detection.source, "rows": int(len(t.frame)),
                       "columns": int(t.frame.shape[1]),
                       "sha256": sha256(t.origin) if not str(t.origin).startswith("records:") else None})
        if not t.detection.confident:
            continue
        for col in t.frame.columns:
            key = canonical_key(col)
            if key == "MATERIAL_GUID":
                seen_materials |= set(t.frame[col].dropna())
            elif key == "TRIAL_GUID":
                seen_trials |= set(t.frame[col].dropna())
    lost_m = seen_materials - set(model.materials["MATERIAL_GUID"])
    lost_t = seen_trials - set(model.trials["TRIAL_GUID"])
    return {
        "inputs": inputs,
        "canonical_rows": {"materials": len(model.materials), "trials": len(model.trials),
                           "trial_material": len(model.trial_material), "operations": len(model.operations),
                           "genomics": len(model.genomics), "lab": len(model.lab)},
        "material_keys_seen": len(seen_materials), "material_keys_lost": len(lost_m),
        "trial_keys_seen": len(seen_trials), "trial_keys_lost": len(lost_t),
        "no_key_lost": not lost_m and not lost_t,
    }


# --------------------------------------------------------------------------- 3. drift
def fingerprint(frames: dict[str, pd.DataFrame]) -> dict:
    """Compact, JSON-able description of each source's distribution (stored with every run)."""
    out: dict[str, Any] = {}
    for source, df in frames.items():
        cols: dict[str, Any] = {}
        for c in df.columns:
            s = df[c]
            if pd.api.types.is_numeric_dtype(s) and s.notna().sum() > 1:
                v = s.dropna().astype(float)
                edges = np.unique(np.quantile(v, np.linspace(0, 1, 11)))
                cols[c] = {"type": "numeric", "n": int(len(v)), "mean": float(v.mean()), "std": float(v.std()),
                           "null_ratio": float(s.isna().mean()), "edges": edges.tolist(),
                           "props": _bin_props(v.to_numpy(), edges).tolist()}
            elif s.notna().any() and s.nunique() <= 30:
                cols[c] = {"type": "categorical", "null_ratio": float(s.isna().mean()),
                           "props": {str(k): float(p) for k, p in s.value_counts(normalize=True).items()}}
        out[source] = {"rows": int(len(df)), "schema": list(map(str, df.columns)), "columns": cols}
    return out


def _bin_props(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    if len(edges) < 2:
        return np.array([1.0])
    idx = np.clip(np.searchsorted(edges, values, side="right") - 1, 0, len(edges) - 2)
    counts = np.bincount(idx, minlength=len(edges) - 1).astype(float)
    return counts / max(counts.sum(), 1.0)


def psi(expected: np.ndarray, actual: np.ndarray, floor: float = 1e-4) -> float:
    """Population Stability Index sum (a - e) ln(a / e) with a small floor for empty bins."""
    e, a = np.maximum(expected, floor), np.maximum(actual, floor)
    return float(np.sum((a - e) * np.log(a / e)))


def drift(previous: dict | None, frames: dict[str, pd.DataFrame], prev_inputs: list | None = None,
          cur_inputs: list | None = None) -> dict:
    if not previous:
        return {"baseline": True, "reading": "first run: this fingerprint becomes the drift baseline"}
    report: dict[str, Any] = {"baseline": False, "sources": {}}
    worst = 0.0
    for source, df in frames.items():
        prev = previous.get(source)
        if prev is None:
            report["sources"][source] = {"status": "new source"}
            continue
        added = sorted(set(map(str, df.columns)) - set(prev["schema"]))
        removed = sorted(set(prev["schema"]) - set(map(str, df.columns)))
        cols = {}
        for c, spec in prev["columns"].items():
            if c not in df.columns:
                continue
            if spec["type"] == "numeric" and pd.api.types.is_numeric_dtype(df[c]):
                v = df[c].dropna().astype(float).to_numpy()
                value = psi(np.array(spec["props"]), _bin_props(v, np.array(spec["edges"])))
                cols[c] = {"psi": round(value, 4), "mean_shift_sd": round(
                    (float(v.mean()) - spec["mean"]) / spec["std"], 4) if spec["std"] else 0.0}
                worst = max(worst, value)
            elif spec["type"] == "categorical":
                cur = df[c].value_counts(normalize=True)
                keys = set(spec["props"]) | set(map(str, cur.index))
                tvd = 0.5 * sum(abs(spec["props"].get(k, 0.0) - float(cur.get(k, 0.0))) for k in keys)
                cols[c] = {"tvd": round(tvd, 4)}
                worst = max(worst, tvd)
        report["sources"][source] = {"rows_before": prev["rows"], "rows_now": int(len(df)),
                                     "columns_added": added, "columns_removed": removed, "columns": cols}
    if prev_inputs is not None and cur_inputs is not None:
        before = {i["table"]: i.get("sha256") for i in prev_inputs}
        report["inputs_changed"] = [i["table"] for i in cur_inputs if before.get(i["table"]) != i.get("sha256")]
    report["max_drift"] = round(worst, 4)
    report["status"] = "stable" if worst < 0.1 else "moderate" if worst < 0.25 else "major"
    return report


# --------------------------------------------------------------------------- 4. topology
def h0_persistence(points: np.ndarray) -> np.ndarray:
    """Death times of the H0 barcode (all births at 0) = MST edge lengths, via Prim in O(n^2)."""
    n = len(points)
    if n < 2:
        return np.array([])
    in_tree = np.zeros(n, dtype=bool)
    best = np.full(n, np.inf)
    in_tree[0] = True
    best = np.sqrt(((points - points[0]) ** 2).sum(1))
    best[0] = np.inf
    deaths = []
    for _ in range(n - 1):
        j = int(np.argmin(np.where(in_tree, np.inf, best)))
        deaths.append(best[j])
        in_tree[j] = True
        d = np.sqrt(((points - points[j]) ** 2).sum(1))
        best = np.where(in_tree, np.inf, np.minimum(best, d))
    return np.sort(np.array(deaths))


def topology(points: np.ndarray, previous: dict | None = None) -> dict:
    deaths = h0_persistence(points)
    if deaths.size == 0:
        return {}
    q1, q3 = np.percentile(deaths, [25, 75])
    long_bars = int((deaths > q3 + 3 * (q3 - q1)).sum())
    scales = np.percentile(deaths, [50, 75, 90, 99]).tolist()
    betti0 = {f"eps={e:.3f}": int((deaths > e).sum() + 1) for e in scales}
    out = {"homology": "H0 (Vietoris-Rips = single linkage)", "points": int(len(points)),
           "bars": int(deaths.size), "total_persistence": round(float(deaths.sum()), 4),
           "max_persistence": round(float(deaths.max()), 4),
           "death_quantiles": {k: round(float(v), 4) for k, v in zip(("q25", "q50", "q75", "q95"),
                                                                     np.percentile(deaths, [25, 50, 75, 95]))},
           "betti0_curve": betti0,
           "well_separated_groups": long_bars + 1,
           "reading": ("no persistent cluster structure: one connected cloud (no bar stands out)" if long_bars == 0
                       else f"{long_bars + 1} well-separated groups (bars beyond Q3 + 3 IQR)"),
           "deaths": np.round(deaths, 5).tolist()}
    try:  # optional H1
        from ripser import ripser  # type: ignore
        dgm1 = ripser(points, maxdim=1)["dgms"][1]
        pers = (dgm1[:, 1] - dgm1[:, 0]) if len(dgm1) else np.array([])
        out["h1"] = {"loops": int(len(pers)), "max_persistence": float(pers.max()) if len(pers) else 0.0}
    except Exception:
        out["h1"] = "not computed (install `ripser` for H1)"
    if previous and previous.get("deaths"):
        a, b = np.array(previous["deaths"]), deaths
        m = max(len(a), len(b))
        a, b = np.sort(np.pad(a, (m - len(a), 0))), np.sort(np.pad(b, (m - len(b), 0)))
        out["wasserstein1_vs_previous"] = round(float(np.abs(a - b).mean()), 6)
    return out


def full_report(engine, previous_run: dict | None) -> dict:
    """Assemble the diagnostics block of a run (used by DataEngine)."""
    prev_diag = (previous_run or {}).get("diagnostics", {})
    x = engine.feature_matrix
    evidence_mismatches = engine.evidence_reread_mismatches()
    frames = {s: pd.concat([t.frame for t in engine.tables if t.detection.source == s], ignore_index=True)
              for s in {t.detection.source for t in engine.tables if t.detection.confident}}
    integ = integrity(engine.tables, engine.model)
    if getattr(engine, "profile", "v1") == "v2":
        # In V2 the alias columns changed meaning (FIELD_ID is the trial, ATTACHED_TO_FIELD_ENTITY_ID the plot),
        # so key loss is judged on the explicit references resolved by integrated_v2 instead.
        refs = engine.v2.references
        integ["references"] = refs
        integ["material_keys_lost"] = integ["trial_keys_lost"] = None
        integ["no_key_lost"] = all(r["share"] in (None, 1.0) for r in refs.values())
    rep = {
        "numerical": numerical(x, engine.spectral, evidence_mismatches) if x.shape[1] > 1 else None,
        "integrity": integ,
        "fingerprint": fingerprint(frames),
        "drift": drift(prev_diag.get("fingerprint"), frames, (prev_diag.get("integrity") or {}).get("inputs"),
                       integ["inputs"]),
        "topology": topology(engine.spectral.whiten(x), prev_diag.get("topology")) if engine.spectral else None,
    }
    return jsonable(rep)
