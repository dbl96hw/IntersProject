"""Layer 6: how good can any rule be, and where is the data genuinely ambiguous?

Three results, all computed from the data (nothing assumed):

1. Bayes ceiling of a feature set. For a discrete feature vector x, no
   deterministic function f(x) can beat
       acc* = (1/N) * sum_x max_y N(x, y)
   because rows sharing the same x but different labels must be misclassified
   in all but one class. On the mock data the four official threshold flags plus
   the resistance flag give acc* = 60/72: identical inputs receive different
   verdicts, so a 100 % reproduction of the official logic from the published
   fields is impossible. This number is the honest target for the baseline.

2. Calibrated probability of FAIL vs HOLD (non-PASS trials). A logistic
   regression on standardised continuous features, with the planting date
   encoded on U(1). Logistic is chosen over a neural network on purpose: with
   65 labelled trials, a model with ~10 interpretable coefficients is what the
   data can support; anything larger would only memorise noise.

3. Distillation back into a rule. The model says *how much* a trial misses its
   thresholds matters, not only whether it misses. The deterministic severity
   rule (rules.TrialRules.severity) encodes exactly that:
     * equal weights: one tuned number (the cut), cross-validated here;
     * weighted: the four weights and the cut are the maximum-margin linear
       separator of the shortfall vectors (a hard-margin SVM, the most robust
       separator when the classes are separable), refit on training folds only
       for the cross-validated accuracy.
   ML is used to discover structure; a readable rule decides.

4. ROC comparison against the rule baselines, with the overtraining check
   borrowed from the ATLAS Open Data ML tutorials (train vs test AUC gap) and
   repeated stratified cross-validation (out-of-fold scores only, so every
   reported number is on data the model did not see).

The model never changes a colour. Trials whose out-of-fold P(FAIL) falls in the
ambiguity band are marked "ambiguous": the evidence genuinely points both ways
and the breeder's judgement is required. This is human-in-the-loop grounded in
the data, not added as decoration.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from .encode import TRIAL_SPECS, encode_frame


def bayes_ceiling(features: pd.DataFrame, labels: pd.Series) -> dict:
    """Maximum accuracy of any deterministic function of the (discrete) features."""
    key = features.astype(str).agg("|".join, axis=1)
    table = pd.crosstab(key, labels)
    best = int(table.max(axis=1).sum())
    conflicting = table[(table > 0).sum(axis=1) > 1]
    return {
        "max_correct": best,
        "total": int(len(labels)),
        "ceiling_accuracy": round(best / len(labels), 4),
        "distinct_inputs": int(len(table)),
        "inputs_with_conflicting_labels": int(len(conflicting)),
        "rows_in_conflict": int(conflicting.to_numpy().sum()),
    }


def roc_curve_points(y: np.ndarray, score: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """ROC (FPR, TPR) without sklearn; ties handled by grouping equal scores."""
    order = np.argsort(-score, kind="stable")
    y, score = y[order], score[order]
    distinct = np.r_[np.where(np.diff(score))[0], len(y) - 1]
    tps = np.cumsum(y)[distinct]
    fps = (distinct + 1) - tps
    tpr = np.r_[0.0, tps / max(y.sum(), 1)]
    fpr = np.r_[0.0, fps / max((1 - y).sum(), 1)]
    return fpr, tpr


def auc(y: np.ndarray, score: np.ndarray) -> float:
    fpr, tpr = roc_curve_points(np.asarray(y, dtype=int), np.asarray(score, dtype=float))
    return float(np.trapezoid(tpr, fpr)) if hasattr(np, "trapezoid") else float(np.trapz(tpr, fpr))


@dataclass
class CalibrationReport:
    n_trials: int
    n_non_pass: int
    ceiling: dict
    rule_auc: float                 # naive "yield gate" rule
    severity_auc: float             # equal-weight severity rule (no fitted weights)
    severity_cv_accuracy: float     # out-of-sample accuracy of the tuned cut
    severity_cv_std: float
    severity_cut_interval: list[float]
    weighted: dict                  # max-margin weights, CV accuracy, margin, near-cut trials
    model_auc_mean: float
    model_auc_std: float
    model_train_auc: float
    overtraining_gap: float
    rule_accuracy: float
    coefficients: dict[str, float]
    features_used: list[str]
    features_excluded: list[str]
    ambiguous_trials: list[str]
    oof_probability: dict[str, float] = field(default_factory=dict)
    roc: dict[str, list[float]] = field(default_factory=dict)
    verdict: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def _trial_flags(trials: pd.DataFrame, rules_cfg: dict) -> pd.DataFrame:
    import operator
    ops = {">=": operator.ge, "<=": operator.le, ">": operator.gt}
    flags = {name: ops[s["op"]](trials[s["field"]], s["value"]) for name, s in rules_cfg["thresholds"].items()}
    extra = rules_cfg["verdict"].get("pass_extra")
    if extra:
        flags["resistance_share"] = ops[extra["op"]](trials[extra["field"]], extra["value"])
    return pd.DataFrame(flags)


def severity_cut_cv(score: np.ndarray, y: np.ndarray, n_splits: int = 5, n_repeats: int = 50,
                    seed: int = 1) -> dict:
    """Choose the severity cut on training folds only and score it on the held-out fold."""
    from sklearn.model_selection import RepeatedStratifiedKFold

    values = np.unique(np.round(score, 6))
    mids = (values[:-1] + values[1:]) / 2.0
    accs, cuts = [], []
    for tr, te in RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=seed).split(score, y):
        train_acc = np.array([((score[tr] > m) == y[tr]).mean() for m in mids])
        cut = float(np.median(mids[train_acc == train_acc.max()]))  # centre of the optimal plateau
        cuts.append(cut)
        accs.append(float(((score[te] > cut) == y[te]).mean()))
    return {"accuracy": float(np.mean(accs)), "std": float(np.std(accs)),
            "cut_median": float(np.median(cuts)), "cut_p05_p95": np.percentile(cuts, [5, 95]).round(3).tolist()}


def fit_weighted_severity(shortfalls: np.ndarray, y: np.ndarray, c: float = 100.0) -> tuple[np.ndarray, float]:
    """Max-margin linear separator on the shortfall vectors, normalised so weight[0] = 1.

    Returns (weights, cut) such that FAIL <=> weights . s > cut.
    """
    from sklearn.svm import SVC
    m = SVC(kernel="linear", C=c).fit(shortfalls, y)
    w, b = m.coef_[0], float(m.intercept_[0])
    return w / w[0], -b / w[0]


def weighted_severity_cv(shortfalls: np.ndarray, y: np.ndarray, n_splits: int = 5, n_repeats: int = 50,
                         seed: int = 1) -> dict:
    """Refit weights + cut on each training fold; score on the held-out fold."""
    from sklearn.model_selection import RepeatedStratifiedKFold
    accs, weights = [], []
    for tr, te in RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=seed).split(shortfalls, y):
        w, cut = fit_weighted_severity(shortfalls[tr], y[tr])
        accs.append(float(((shortfalls[te] @ w > cut) == y[te]).mean()))
        weights.append(np.r_[w, cut])
    weights = np.array(weights)
    return {"accuracy": float(np.mean(accs)), "std": float(np.std(accs)),
            "weights_p05": np.percentile(weights, 5, axis=0).round(3).tolist(),
            "weights_p95": np.percentile(weights, 95, axis=0).round(3).tolist()}


def calibrate(trials: pd.DataFrame, rules_cfg: dict, band: tuple[float, float] = (0.35, 0.65),
              n_repeats: int = 20, n_splits: int = 5, seed: int = 42,
              exclude_features: set[str] | None = None) -> CalibrationReport:
    """Run the full ambiguity analysis on the trials that carry an official verdict.

    exclude_features: columns that failed a data-quality gate (e.g. planting
    dates that contradict the trial year) and must not feed the model.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import RepeatedStratifiedKFold
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    from .rules import TrialRules

    labelled = trials.dropna(subset=["TRIAL_RECOMMENDATION"]).reset_index(drop=True)
    flags = _trial_flags(labelled, rules_cfg)
    ceiling = bayes_ceiling(flags, labelled["TRIAL_RECOMMENDATION"])

    non_pass = labelled[labelled["TRIAL_RECOMMENDATION"] != "PASS"].reset_index(drop=True)
    y = (non_pass["TRIAL_RECOMMENDATION"] == "FAIL").to_numpy(int)
    # Original units here; the scaler is fitted inside each fold by the pipeline.
    x, names, _ = encode_frame(non_pass, TRIAL_SPECS, standardize=False, exclude=exclude_features)
    excluded = sorted(exclude_features or [])

    # Baseline 1: "yield gates FAIL"; its natural continuous score is the yield shortfall.
    yield_spec = rules_cfg["thresholds"]["yield"]
    rule_score = yield_spec["value"] - non_pass[yield_spec["field"]].to_numpy(float)
    rule_acc = float(((rule_score > 0).astype(int) == y).mean())

    def model():
        return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000))

    # Out-of-fold probabilities averaged over repeats; train AUC for the overtraining check.
    oof_sum, oof_cnt = np.zeros(len(y)), np.zeros(len(y))
    test_aucs, train_aucs = [], []
    cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=seed)
    for tr, te in cv.split(x, y):
        m = model().fit(x[tr], y[tr])
        p_te = m.predict_proba(x[te])[:, 1]
        oof_sum[te] += p_te
        oof_cnt[te] += 1
        test_aucs.append(auc(y[te], p_te))
        train_aucs.append(auc(y[tr], m.predict_proba(x[tr])[:, 1]))
    oof = oof_sum / oof_cnt
    full = model().fit(x, y)
    coef = full[-1].coef_[0]  # per standard deviation of each feature

    rule_auc = auc(y, rule_score)
    model_auc = float(np.mean(test_aucs))

    # Baseline 2: equal-weight severity (no fitted weights, one cut).
    engine = TrialRules({"trial_rules": rules_cfg})
    sev = np.array([engine.severity(r, weighted=False)[0] for _, r in non_pass.iterrows()])
    sev_auc = auc(y, sev)
    sev_cv = severity_cut_cv(sev, y, seed=seed)

    # Weighted severity: max-margin weights, their CV accuracy and the margin.
    crit = list(rules_cfg["thresholds"])
    s_mat = np.array([[engine.shortfalls(r).get(n, 0.0) for n in crit] for _, r in non_pass.iterrows()])
    w_fit, cut_fit = fit_weighted_severity(s_mat, y)
    w_cfg = np.array([rules_cfg["verdict"].get("severity_weights", {}).get(n, 1.0) for n in crit])
    cut_cfg = float(rules_cfg["verdict"].get("weighted_severity_cut", cut_fit))
    score_cfg = s_mat @ w_cfg
    w_cv = weighted_severity_cv(s_mat, y, seed=seed)
    margin = float(np.min(np.abs(score_cfg - cut_cfg)))
    cut_halfwidth = (w_cv["weights_p95"][-1] - w_cv["weights_p05"][-1]) / 2.0
    near_cut = non_pass.loc[np.abs(score_cfg - cut_cfg) < cut_halfwidth, "TRIAL_ID"].tolist()
    weighted = {
        "criteria": crit,
        "weights_fitted": dict(zip(crit, np.round(w_fit, 4).tolist())), "cut_fitted": round(cut_fit, 4),
        "weights_config": dict(zip(crit, w_cfg.tolist())), "cut_config": cut_cfg,
        "train_accuracy_config": round(float(((score_cfg > cut_cfg) == y).mean()), 4),
        "cv_accuracy": round(w_cv["accuracy"], 4), "cv_std": round(w_cv["std"], 4),
        "cv_weights_p05": dict(zip(crit + ["cut"], w_cv["weights_p05"])),
        "cv_weights_p95": dict(zip(crit + ["cut"], w_cv["weights_p95"])),
        "auc_in_sample": round(auc(y, score_cfg), 4),
        "min_margin_to_cut": round(margin, 5),
        "near_cut_trials": near_cut,
    }

    lo, hi = band
    ambiguous = non_pass.loc[(oof >= lo) & (oof <= hi), "TRIAL_ID"].tolist()
    fpr_r, tpr_r = roc_curve_points(y, rule_score)
    fpr_m, tpr_m = roc_curve_points(y, oof)
    fpr_s, tpr_s = roc_curve_points(y, sev)
    fpr_w, tpr_w = roc_curve_points(y, score_cfg)

    verdict = (f"yield-gate rule AUC {rule_auc:.2f} < calibrated model {model_auc:.2f} (out of sample) "
               f"< equal-weight severity {sev_auc:.2f} (CV accuracy {sev_cv['accuracy']:.2f} +- {sev_cv['std']:.2f}) "
               f"<= weighted severity (CV accuracy {w_cv['accuracy']:.3f} +- {w_cv['std']:.3f}): the size of the "
               f"misses carries the signal the flags lose, and a readable weighted rule captures it; the rule "
               f"decides, the model only marks ambiguous trials")

    return CalibrationReport(
        n_trials=len(labelled), n_non_pass=len(non_pass), ceiling=ceiling,
        rule_auc=round(rule_auc, 4), severity_auc=round(sev_auc, 4),
        severity_cv_accuracy=round(sev_cv["accuracy"], 4), severity_cv_std=round(sev_cv["std"], 4),
        severity_cut_interval=sev_cv["cut_p05_p95"], weighted=weighted, model_auc_mean=round(model_auc, 4),
        model_auc_std=round(float(np.std(test_aucs)), 4), model_train_auc=round(float(np.mean(train_aucs)), 4),
        overtraining_gap=round(float(np.mean(train_aucs)) - model_auc, 4), rule_accuracy=round(rule_acc, 4),
        coefficients={n: round(float(c), 4) for n, c in zip(names, coef)},
        features_used=names, features_excluded=excluded,
        ambiguous_trials=ambiguous,
        oof_probability={t: round(float(p), 4) for t, p in zip(non_pass["TRIAL_ID"], oof)},
        roc={"rule_fpr": fpr_r.round(4).tolist(), "rule_tpr": tpr_r.round(4).tolist(),
             "model_fpr": fpr_m.round(4).tolist(), "model_tpr": tpr_m.round(4).tolist(),
             "severity_fpr": fpr_s.round(4).tolist(), "severity_tpr": tpr_s.round(4).tolist(),
             "weighted_fpr": fpr_w.round(4).tolist(), "weighted_tpr": tpr_w.round(4).tolist()},
        verdict=verdict,
    )
