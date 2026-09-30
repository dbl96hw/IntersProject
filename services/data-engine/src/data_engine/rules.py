"""Layer 5: deterministic triage with evidence. THIS LAYER DECIDES THE COLOUR.

Every threshold comes from config/rules.yaml, and every decision carries the
list of checks that produced it, each pointing at (source, field, record,
value, threshold). The LLM downstream may only paraphrase these records; it
never computes or invents a number. That is the anti-hallucination contract.

Two levels:
* Trial level: reconstruction of the official pass/fail logic (SYNTH_V1). This
  is the BASELINE the rubric asks us to check against.
* Candidate level: a candidate (line) is tested in several trials; its colour
  aggregates its trial verdicts with its own genomic value (team proposal v0,
  shown to the breeder as a proposal until the SME confirms it).
"""

from __future__ import annotations

import operator
from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

from .settings import load_yaml

OPS = {">=": operator.ge, "<=": operator.le, ">": operator.gt, "<": operator.lt, "==": operator.eq}
COLOUR = {"PASS": "GREEN", "HOLD": "AMBER", "FAIL": "RED"}


@dataclass(frozen=True)
class Evidence:
    """One check, fully traceable to the data. The unit of explanation."""

    rule: str
    source: str
    field: str
    record: str
    value: Any
    op: str
    threshold: Any
    passed: bool
    statement: str

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Decision:
    level: str                     # "trial" | "candidate"
    record: str                    # TRIAL_ID or candidate_id
    verdict: str                   # PASS | HOLD | FAIL
    colour: str                    # GREEN | AMBER | RED
    reason: str                    # one line for the breeder, built only from evidence
    evidence: list[Evidence]
    rule_version: str
    official_verdict: str | None = None
    computed_verdict: str | None = None   # what our reconstructed rules say (== verdict if no official)
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def agrees_with_official(self) -> bool | None:
        if self.official_verdict is None or self.computed_verdict is None:
            return None
        return self.official_verdict == self.computed_verdict

    def as_dict(self) -> dict:
        d = asdict(self)
        d["agrees_with_official"] = self.agrees_with_official
        return d


def _fmt(value: Any) -> str:
    return f"{value:g}" if isinstance(value, (int, float)) else str(value)


class TrialRules:
    """Reconstructed official trial logic (baseline)."""

    source = "trial_recommendations"

    def __init__(self, config: dict | None = None):
        self.cfg = (config or load_yaml("rules"))["trial_rules"]
        self.version = self.cfg["version"]

    def _check(self, name: str, spec: dict, row: pd.Series, record: str) -> Evidence | None:
        value = row.get(spec["field"])
        if value is None or pd.isna(value):
            return None
        passed = bool(OPS[spec["op"]](value, spec["value"]))
        unit = spec.get("unit", "")
        statement = (f"{spec['ok_text'] if passed else spec['bad_text']} "
                     f"({spec['field']} = {_fmt(value)} {unit}, threshold {spec['op']} {_fmt(spec['value'])})")
        return Evidence(name, self.source, spec["field"], record, value, spec["op"], spec["value"], passed, statement)

    def shortfalls(self, row: pd.Series) -> dict[str, float]:
        """Relative shortfall beyond each threshold, max(0, gap / |threshold|), dimensionless."""
        parts: dict[str, float] = {}
        for name, spec in self.cfg["thresholds"].items():
            value = row.get(spec["field"])
            if value is None or pd.isna(value) or spec["value"] == 0:
                continue
            gap = (spec["value"] - value) if spec["op"] in (">=", ">") else (value - spec["value"])
            if gap > 0:
                parts[name] = float(gap / abs(spec["value"]))
        return parts

    def severity(self, row: pd.Series, weighted: bool | None = None) -> tuple[float, dict[str, float]]:
        """Combined severity of the misses and its per-criterion terms.

        Equal weights: a 10 % yield shortfall counts the same as a disease score
        10 % above its limit. Weighted (mode weighted_severity): each shortfall is
        multiplied by its weight from rules.yaml. Returns (total, {criterion: term}).
        """
        v = self.cfg["verdict"]
        if weighted is None:
            weighted = v.get("mode") == "weighted_severity"
        weights = v.get("severity_weights", {}) if weighted else {}
        terms = {name: weights.get(name, 1.0) * share for name, share in self.shortfalls(row).items()}
        return float(sum(terms.values())), terms

    def cut(self) -> float:
        v = self.cfg["verdict"]
        return v["weighted_severity_cut"] if v.get("mode") == "weighted_severity" else v.get("severity_cut", float("inf"))

    def evaluate_row(self, row: pd.Series) -> Decision:
        record = str(row.get("TRIAL_ID", row.get("TRIAL_GUID")))
        evidence = [e for name, spec in self.cfg["thresholds"].items()
                    if (e := self._check(name, spec, row, record)) is not None]
        by_rule = {e.rule: e for e in evidence}
        v = self.cfg["verdict"]
        missing = [r for r in v["pass_requires_all"] if r not in by_rule]

        extra = v.get("pass_extra")
        extra_ev = None
        if extra and not pd.isna(row.get(extra["field"], float("nan"))):
            val = row[extra["field"]]
            ok = bool(OPS[extra["op"]](val, extra["value"]))
            extra_ev = Evidence("resistance_share", self.source, extra["field"], record, val, extra["op"],
                                extra["value"], ok,
                                f"{'enough' if ok else 'not enough'} resistant material "
                                f"({extra['field']} = {_fmt(val)} %, needs {extra['op']} {_fmt(extra['value'])})")
            evidence.append(extra_ev)

        sev, terms = self.severity(row)
        shares = self.shortfalls(row)
        cut = self.cut()
        weighted = v.get("mode") == "weighted_severity"
        if not missing:
            label = "weighted shortfall" if weighted else "total relative shortfall"
            detail = ", ".join(f"{r} {shares[r]:.0%}" + (f" x{v['severity_weights'].get(r, 1.0):g}" if weighted else "")
                               for r in shares)
            evidence.append(Evidence(
                "severity", self.source, "+".join(self.cfg["thresholds"][r]["field"] for r in shares) or "-",
                record, round(sev, 4), ">", cut, sev <= cut,
                f"{label} {sev:.2f} (cut {cut:g})" + (f": {detail}" if detail else "")))

        failed = [e.statement for e in evidence if not e.passed and e.rule not in ("severity",)]
        if missing:
            verdict = "HOLD"
            reason = f"cannot score: missing {', '.join(missing)}"
        elif all(by_rule[r].passed for r in v["pass_requires_all"]) and (extra_ev is None or extra_ev.passed):
            verdict = "PASS"
            reason = "meets all thresholds: " + "; ".join(by_rule[r].statement for r in v["pass_requires_all"])
        elif v.get("mode", "gate") in ("severity", "weighted_severity"):
            verdict = "FAIL" if sev > cut else v["otherwise"]
            size = "large" if verdict == "FAIL" else "small"
            reason = f"{size} combined shortfall ({sev:.2f} vs cut {cut:g}): " + "; ".join(failed)
        elif any(not by_rule[r].passed for r in v["fail_if_any"]):
            verdict = "FAIL"
            reason = "; ".join(by_rule[r].statement for r in v["fail_if_any"] if not by_rule[r].passed)
        else:
            verdict = v["otherwise"]
            reason = "; ".join(failed) if failed else "borderline"

        official = row.get("TRIAL_RECOMMENDATION")
        official = None if official is None or pd.isna(official) else str(official)
        computed = verdict
        # The system of record wins: when the export already carries an official
        # verdict we show it, and use our reconstruction to explain or to flag it.
        # We never silently overwrite an organisational decision.
        if official is not None and self.cfg.get("prefer_official", True):
            verdict = official
            if computed != official:
                reason = (f"official verdict {official}, but the published fields point to {computed} "
                          f"({reason}): not explained by the data, review with the breeder")
        return Decision("trial", record, verdict, COLOUR[verdict], reason, evidence, self.version,
                        official_verdict=official, computed_verdict=computed)

    def evaluate(self, trials: pd.DataFrame) -> list[Decision]:
        return [self.evaluate_row(r) for _, r in trials.iterrows()]


class CandidateRules:
    """Candidate-level (line) triage: aggregates trial verdicts + own genomics (proposal v0)."""

    def __init__(self, config: dict | None = None):
        self.cfg = (config or load_yaml("rules"))["material_rules"]
        self.version = self.cfg["version"]

    def evaluate(self, candidate_id: str, trial_decisions: list[Decision], genomics: pd.Series | None) -> Decision:
        n = len(trial_decisions)
        n_fail = sum(d.verdict == "FAIL" for d in trial_decisions)
        n_pass = sum(d.verdict == "PASS" for d in trial_decisions)
        share = n_fail / n if n else float("nan")
        gbv = None if genomics is None else genomics.get("GENOMIC_BREEDING_VALUE")
        tested_in = ", ".join(d.record for d in trial_decisions)

        evidence = [Evidence("fail_share", "trial_recommendations", "TRIAL_RECOMMENDATION", candidate_id,
                             round(share, 3) if n else None, "share", None, n_fail == 0,
                             f"failed in {n_fail} of {n} trials ({tested_in})" if n else "not tested in any trial")]
        if gbv is not None and not pd.isna(gbv):
            thr = self.cfg["green"]["genomic_value_gte"]
            evidence.append(Evidence("genomic_value", "genomics", "GENOMIC_BREEDING_VALUE", candidate_id, gbv,
                                     ">=", thr, bool(gbv >= thr),
                                     f"genomic breeding value {_fmt(gbv)} ({'>=' if gbv >= thr else '<'} {_fmt(thr)})"))
        if genomics is not None:
            for marker in ("MARKER_DISEASE_RESISTANCE", "MARKER_YIELD_POTENTIAL", "MARKER_DROUGHT_TOLERANCE"):
                if marker in genomics and not pd.isna(genomics[marker]):
                    evidence.append(Evidence("marker", "genomics", marker, candidate_id, genomics[marker], "info",
                                             None, True, f"{marker.replace('MARKER_', '').replace('_', ' ').lower()}: "
                                                         f"{str(genomics[marker]).lower()}"))

        red, green = self.cfg["red"], self.cfg["green"]
        if n == 0:
            verdict, reason = "HOLD", "no trial data yet: needs evaluation"
        elif share >= red["fail_share_gte"]:
            verdict, reason = "FAIL", f"fails in {n_fail} of {n} trials"
        elif (share <= green["fail_share_lte"] and n >= green["min_trials"]
              and gbv is not None and not pd.isna(gbv) and gbv >= green["genomic_value_gte"]):
            verdict = "PASS"
            reason = f"fails in only {n_fail} of {n} trials, genomic value {_fmt(gbv)}"
        else:
            parts = [f"fails in {n_fail} of {n} trials"]
            if gbv is not None and not pd.isna(gbv) and gbv < green["genomic_value_gte"]:
                parts.append(f"genomic value {_fmt(gbv)} below {_fmt(green['genomic_value_gte'])}")
            if n < green["min_trials"]:
                parts.append(f"only {n} trial(s): too few to judge stability")
            verdict, reason = "HOLD", "; ".join(parts)

        return Decision("candidate", candidate_id, verdict, COLOUR[verdict], reason, evidence, self.version,
                        computed_verdict=verdict, extras={"n_trials": n, "n_fail": n_fail, "n_pass": n_pass,
                                "trials": [d.record for d in trial_decisions]})
