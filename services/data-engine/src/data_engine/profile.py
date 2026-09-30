"""Layer 3: "renormalization" of a table, i.e. keeping only what carries information.

Idea
----
Treat each column as a discrete random variable X over its rows (a missing
value is one more symbol). Its Shannon entropy

    H(X) = - sum_x p(x) log2 p(x)

is zero exactly when the column is constant (including all-empty). Such a
column cannot change any decision, any join or any explanation, so removing it
is lossless: it is not an approximation, it discards degrees of freedom that
carry no information. This is the coarse-graining step: the ~200 raw columns
of the mock exports collapse to a few dozen informative ones.

The remaining columns get a *role*:
    key         canonical join key (MATERIAL_GUID, TRIAL_GUID, LOCATION_GUID or an alias)
    identifier  row-unique technical id (ROWGUID, OPERATION_GUID): provenance only
    label       human-readable id (MATERIAL_ID, TRIAL_ID): shown to breeders
    feature     numeric / categorical / date content the engine reasons on
    text        free text (e.g. the official rationale): kept for evidence, never scored
    drop        zero entropy

The profile is also what the LLM reads instead of raw rows, which is where the
token savings come from (see `token_estimate`).
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from .detect import canonical_key

_GUID_RE = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$", re.I)
_LABEL_COLUMNS = {"MATERIAL_ID", "TRIAL_ID", "SAMPLE_ID", "OBSERVATION_ID", "LINE"}
# Free-text columns by name: kept as evidence, never used as model features.
_TEXT_HINT = re.compile(r"(RATIONALE|REMARK|DESCRIPTION|COMMENT|NOTE)", re.I)


def _is_row_counter(series: pd.Series) -> bool:
    """Integer column that just enumerates rows (1, 2, 3, ...): an identifier, not a feature."""
    values = series.dropna()
    return bool(np.allclose(values, np.round(values)) and values.is_monotonic_increasing)


@dataclass(frozen=True)
class ColumnProfile:
    name: str
    role: str                 # key | identifier | label | feature | text | drop
    kind: str                 # empty | constant | numeric | datetime | categorical | text | id
    entropy_bits: float
    null_ratio: float
    n_unique: int
    canonical_key: str | None

    def as_dict(self) -> dict:
        return asdict(self)


def shannon_entropy(series: pd.Series) -> float:
    """Entropy in bits with missing values counted as their own symbol."""
    counts = series.astype("object").where(series.notna(), "<NA>").value_counts().to_numpy(dtype=float)
    p = counts / counts.sum()
    h = float(-(p * np.log2(p)).sum())
    return 0.0 if abs(h) < 1e-12 else h  # clamp -0.0 / round-off to an exact zero


def _kind(series: pd.Series, n_unique: int) -> str:
    non_null = series.dropna()
    if non_null.empty:
        return "empty"
    if n_unique == 1:
        return "constant"
    if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
        return "numeric"
    sample = non_null.astype(str).head(50)
    if sample.map(lambda v: bool(_GUID_RE.match(v))).all():
        return "id"
    parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
    if parsed.notna().mean() > 0.9 and sample.str.contains(r"\d{4}-\d{2}-\d{2}").mean() > 0.9:
        return "datetime"
    if n_unique <= max(20, int(0.05 * len(non_null))):
        return "categorical"
    return "text"


def profile_column(name: str, series: pd.Series) -> ColumnProfile:
    n_unique = int(series.nunique(dropna=True))
    h = shannon_entropy(series)
    kind = _kind(series, n_unique)
    key = canonical_key(name)
    non_null = int(series.notna().sum())

    all_unique = non_null > 0 and n_unique == non_null
    if h == 0.0:
        role = "drop"
    elif key is not None:
        role = "key"
    elif name in _LABEL_COLUMNS:
        role = "label"
    elif _TEXT_HINT.search(name):
        role = "text"
    elif kind == "id" or (all_unique and kind == "text") or (all_unique and kind == "numeric" and _is_row_counter(series)):
        role = "identifier"
    elif kind == "text":
        role = "text"
    else:
        role = "feature"

    return ColumnProfile(name, role, kind, round(h, 4), round(float(series.isna().mean()), 4), n_unique, key)


@dataclass
class TableProfile:
    columns: list[ColumnProfile]
    n_rows: int

    @property
    def kept(self) -> list[str]:
        return [c.name for c in self.columns if c.role != "drop"]

    @property
    def dropped(self) -> list[str]:
        return [c.name for c in self.columns if c.role == "drop"]

    def by_role(self, role: str) -> list[str]:
        return [c.name for c in self.columns if c.role == role]

    def summary(self) -> dict:
        roles: dict[str, int] = {}
        for c in self.columns:
            roles[c.role] = roles.get(c.role, 0) + 1
        return {"rows": self.n_rows, "columns": len(self.columns), "kept": len(self.kept),
                "dropped": len(self.dropped), "roles": roles,
                "information_bits_per_row": round(sum(c.entropy_bits for c in self.columns), 2)}


def profile_table(df: pd.DataFrame) -> TableProfile:
    return TableProfile([profile_column(c, df[c]) for c in df.columns], len(df))


def renormalize(df: pd.DataFrame, profile: TableProfile | None = None) -> pd.DataFrame:
    """Return the table restricted to its informative columns (lossless)."""
    profile = profile or profile_table(df)
    return df[profile.kept].copy()


def token_estimate(df: pd.DataFrame) -> int:
    """Rough LLM token count of a table serialised as CSV (~4 characters/token).

    Only used to compare raw vs renormalized payloads; the ratio is what matters,
    and it is insensitive to the exact characters-per-token constant.
    """
    return math.ceil(len(df.to_csv(index=False)) / 4)
