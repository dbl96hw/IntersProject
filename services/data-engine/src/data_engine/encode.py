"""Symmetry-aware feature encodings.

Principle: encode each variable according to the group of transformations that
leaves its *meaning* unchanged, and keep only the part of the representation
that carries information (i.e. remove the trivial / invariant component).

    variable type        symmetry group             encoding (this module)
    -------------------  -------------------------  ------------------------------------------
    continuous quantity  affine group x -> a x + b  z-score: quotient by the affine action
    nominal category     permutations S_k           standard irrep of S_k (Helmert basis, k-1 dims)
    ordinal category     order only (no S_k)        centred, scaled ranks
    cyclic (day of year) rotations U(1) = SO(2)     irreps e^{i m theta} -> (cos m theta, sin m theta)

Why this matters, concretely
* Nominal: one-hot vectors live in the permutation representation R^k of S_k,
  which decomposes as trivial (span of 1) + standard (its orthogonal
  complement, irreducible). One-hot columns always sum to 1, which is exactly
  the trivial component: it duplicates the intercept and makes the design
  matrix rank-deficient. Projecting onto the standard irrep with an
  orthonormal (Helmert) basis removes that redundancy *isometrically*: all
  pairwise distances between categories are preserved and equal (sqrt 2).
* Ordinal: S_k symmetry would throw away the order (LOW < MEDIUM < HIGH), which
  is information. The correct group is smaller, so the encoding is different.
* Cyclic: day 365 and day 1 are neighbours. On U(1) the Fourier harmonics are
  the irreducible representations; truncating at m <= M keeps the smooth
  seasonal part, and the truncation error of a smooth periodic signal decays
  with M. M = 1 already encodes "time of season" without the Dec/Jan jump.
  Unknown phase is imputed at the origin (0, 0), the mean of the uniform
  distribution on the circle, i.e. "no seasonal information".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


def helmert_basis(k: int) -> np.ndarray:
    """Orthonormal k x (k-1) basis of the standard irrep of S_k (orthogonal to 1).

    Column j (1-based) is proportional to (1, ..., 1, -j, 0, ..., 0) with j ones.
    """
    if k < 2:
        return np.zeros((k, 0))
    h = np.zeros((k, k - 1))
    for j in range(1, k):
        h[:j, j - 1] = 1.0
        h[j, j - 1] = -float(j)
        h[:, j - 1] /= np.sqrt(j * (j + 1))
    return h


def encode_affine(x: pd.Series) -> tuple[np.ndarray, dict]:
    """z-score. Constant columns map to 0 (they carry no information)."""
    v = pd.to_numeric(x, errors="coerce").astype(float)
    mu, sd = float(np.nanmean(v)), float(np.nanstd(v))
    z = (v - mu) / sd if sd > 0 else v * 0.0
    return np.nan_to_num(z.to_numpy(), nan=0.0)[:, None], {"mean": mu, "std": sd}


def encode_nominal(x: pd.Series, categories: list | None = None) -> tuple[np.ndarray, dict]:
    """Project one-hot onto the standard irrep of S_k (k-1 orthonormal coordinates)."""
    cats = categories or sorted(x.dropna().unique().tolist())
    idx = {c: i for i, c in enumerate(cats)}
    onehot = np.zeros((len(x), len(cats)))
    for r, val in enumerate(x):
        if val in idx:
            onehot[r, idx[val]] = 1.0
        # Missing -> zero row, which maps to the origin of the irrep: the
        # barycentre of all categories, i.e. no preference (same logic as the
        # U(1) imputation for unknown dates).
    return onehot @ helmert_basis(len(cats)), {"categories": cats, "group": f"S_{len(cats)}"}


def encode_ordinal(x: pd.Series, order: list) -> tuple[np.ndarray, dict]:
    """Centred ranks scaled to unit variance over the category set."""
    rank = {c: i for i, c in enumerate(order)}
    r = x.map(rank).astype(float)
    centre, scale = (len(order) - 1) / 2.0, np.std(np.arange(len(order))) or 1.0
    return np.nan_to_num(((r - centre) / scale).to_numpy(), nan=0.0)[:, None], {"order": order}


def encode_cyclic(dates: pd.Series, period: float = 365.25, harmonics: int = 1) -> tuple[np.ndarray, dict]:
    """Day-of-year on U(1): (cos m theta, sin m theta), m = 1..harmonics."""
    d = pd.to_datetime(dates, errors="coerce")
    theta = 2.0 * np.pi * (d.dt.dayofyear.astype(float) - 1.0) / period
    cols = []
    for m in range(1, harmonics + 1):
        cols += [np.cos(m * theta), np.sin(m * theta)]
    out = np.column_stack([np.nan_to_num(np.asarray(c, dtype=float), nan=0.0) for c in cols])
    return out, {"period": period, "harmonics": harmonics, "group": "U(1)"}


@dataclass(frozen=True)
class Spec:
    column: str
    kind: str                      # affine | nominal | ordinal | cyclic
    order: tuple | None = None     # for ordinal
    harmonics: int = 1             # for cyclic


# Encodings for the UC4 candidate and trial features. Marker calls are ordinal:
# FAVOURABLE > NEUTRAL > UNFAVOURABLE carries order, so S_k would lose information.
CANDIDATE_SPECS = [
    Spec("GENOMIC_BREEDING_VALUE", "affine"),
    Spec("QC_CALL_RATE_PCT", "affine"),
    Spec("MARKER_DROUGHT_TOLERANCE", "ordinal", ("UNFAVOURABLE", "NEUTRAL", "FAVOURABLE")),
    Spec("MARKER_DISEASE_RESISTANCE", "ordinal", ("SUSCEPTIBLE", "INTERMEDIATE", "RESISTANT")),
    Spec("MARKER_YIELD_POTENTIAL", "ordinal", ("LOW", "MEDIUM", "HIGH")),
    Spec("MARKER_MATURITY", "ordinal", ("EARLY", "MID", "LATE")),
    Spec("LAB_TRAIT_1", "affine"), Spec("LAB_TRAIT_2", "affine"),
    Spec("LAB_TRAIT_3", "affine"), Spec("LAB_TRAIT_4", "affine"),
    Spec("MEAN_YIELD_T_HA", "affine"), Spec("MEAN_MOISTURE_PCT", "affine"),
    Spec("MEAN_DISEASE_SCORE", "affine"), Spec("MEAN_PLANT_HEIGHT_CM", "affine"),
    Spec("MEAN_FLOWERING_DAYS", "affine"), Spec("FAIL_SHARE", "affine"),
]

TRIAL_SPECS = [
    Spec("YIELD_T_HA", "affine"), Spec("MOISTURE_PCT", "affine"), Spec("DISEASE_SCORE", "affine"),
    Spec("PLANT_HEIGHT_CM", "affine"), Spec("FLOWERING_DAYS", "affine"),
    Spec("GENOMIC_BREEDING_VALUE_MEAN", "affine"), Spec("RESISTANT_MATERIAL_PCT", "affine"),
    Spec("location", "nominal"),
    Spec("PLANTING_DATE", "cyclic", harmonics=1),
]


def encode_frame(df: pd.DataFrame, specs: list[Spec], standardize: bool = True,
                 exclude: set[str] | None = None) -> tuple[np.ndarray, list[str], dict]:
    """Apply the specs present in `df`; returns (matrix, feature names, per-column metadata).

    standardize=False leaves affine columns in their original units (missing ->
    column mean) so that a model pipeline can fit the z-score *inside* each
    cross-validation fold; fitting it on all rows first would leak the test
    folds' mean and variance into training. The other encodings have no fitted
    parameters (fixed bases), so they are leak-free by construction.
    exclude: columns that failed a data-quality gate and must not be used.
    """
    blocks, names, meta = [], [], {}
    for spec in specs:
        if spec.column not in df.columns or (exclude and spec.column in exclude):
            continue
        col = df[spec.column]
        if spec.kind == "affine" and not standardize:
            v = pd.to_numeric(col, errors="coerce").astype(float)
            m, info = v.fillna(v.mean()).to_numpy()[:, None], {"units": "original"}
            labels = [spec.column]
        elif spec.kind == "affine":
            m, info = encode_affine(col)
            labels = [spec.column]
        elif spec.kind == "nominal":
            m, info = encode_nominal(col)
            labels = [f"{spec.column}[h{j + 1}]" for j in range(m.shape[1])]
        elif spec.kind == "ordinal":
            m, info = encode_ordinal(col, list(spec.order))
            labels = [spec.column]
        elif spec.kind == "cyclic":
            m, info = encode_cyclic(col, harmonics=spec.harmonics)
            labels = [f"{spec.column}[{f}{k}]" for k in range(1, spec.harmonics + 1) for f in ("cos", "sin")]
        else:
            raise ValueError(spec.kind)
        if m.shape[1] == 0:
            continue
        blocks.append(m)
        names += labels
        meta[spec.column] = {"kind": spec.kind, **info}
    matrix = np.hstack(blocks) if blocks else np.zeros((len(df), 0))
    return matrix, names, meta
