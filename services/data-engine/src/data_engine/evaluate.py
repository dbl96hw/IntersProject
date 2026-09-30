"""One-command evaluation report: `python -m data_engine.evaluate [--plot roc.png] [--out report.json]`.

Prints the numbers the demo and the one-pager rely on, all recomputed from the
data on every run (nothing is hard-coded): hardware and timings, ingestion and
renormalization, parity with the official logic and its root causes, Bayes
ceiling, ROC comparison, numerical verification, integrity, drift, topology,
data-quality issues and token savings. `--out` writes the full JSON report.
"""

from __future__ import annotations

import argparse
import json
import sys

from .engine import DataEngine


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", help="data directory (default: DATA_ENGINE_DATA_DIR)")
    ap.add_argument("--export-date", default=None, help="date of the export (for stale-status checks)")
    ap.add_argument("--plot", help="write the ROC comparison to this PNG (needs matplotlib)")
    ap.add_argument("--out", help="write the full JSON report to this file")
    ap.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = ap.parse_args(argv)

    e = DataEngine.from_directory(args.data, export_date=args.export_date)
    ing, base, run = e.ingestion_report(), e.baseline(), e.diagnostics_report()
    first = next(iter(e.candidate_decisions))
    ctx = e.llm_context(first)["tokens"]
    report = {"hardware": run["hardware"], "timings": run["summary"],
              "stages": [{k: s[k] for k in ("name", "wall_s", "cpu_s", "cpu_utilisation", "rss_after_mb")}
                         for s in run["stages"]],
              "ingestion": ing["totals"], "parallel_plan": (ing["parallel_plan"] or {}).get("reason"),
              "sources": {t["table"]: t["source"] for t in ing["tables"]},
              "parity": base["parity"], "not_explained": base["not_explained"],
              "mismatch_root_causes": {m: v["by_category"] for m, v in base["mismatch_root_causes"].items()},
              "calibration": base["calibration"] and {k: v for k, v in base["calibration"].items() if k != "roc"},
              "spectral": ing["spectral"], "numerical": run["diagnostics"]["numerical"],
              "integrity": {k: v for k, v in run["diagnostics"]["integrity"].items() if k != "inputs"},
              "drift": {k: v for k, v in run["diagnostics"]["drift"].items() if k != "sources"},
              "topology": {k: v for k, v in (run["diagnostics"]["topology"] or {}).items() if k != "deaths"},
              "quality": e.quality_report()["summary"],
              "quality_issues": [f"[{i['fix_status']}] {i['id']} x{i['count']}: {i['root_cause']}"
                                 for i in e.quality_report()["issues"]],
              "scoring": e.apply_scoring(), "llm_context_tokens_example": {first: ctx},
              "run_file": run.get("run_file")}

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({**report, "full_run": run, "baseline": base, "quality_report": e.quality_report()},
                      fh, indent=2, default=str)
    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        hw, tm = report["hardware"], report["timings"]
        print("== Machine and run")
        print(f"  {hw['platform']}: {hw['usable_cpus']} usable CPUs ({hw['physical_cores']} physical), "
              f"{hw['ram_available_gb']} GB RAM free, budget {hw['memory_budget_gb']} GB")
        print(f"  build {tm['total_wall_s']:.2f} s wall, {tm['total_cpu_s']:.2f} s CPU, peak RSS {tm['peak_rss_mb']} MB")
        for s in report["stages"]:
            print(f"    {s['name']:24s} {s['wall_s']:8.4f} s   cpu/wall {s['cpu_utilisation']:.2f}   rss {s['rss_after_mb']} MB")
        t = report["ingestion"]
        print("== Ingestion / renormalization")
        print(f"  {t['columns']} columns -> {t['informative_columns']} informative (zero-entropy columns dropped)")
        print(f"  per-candidate LLM context: {ctx['raw_rows']} -> {ctx['payload']} tokens ({ctx['reduction']:.0%} less)")
        print(f"  parallel plan: {report['parallel_plan']}")
        p = report["parity"]
        print("== Baseline: official verdicts vs engine")
        print(f"  parity {p['agree']}/{p['total']} ({p['accuracy']:.1%}); not explained: {report['not_explained']}")
        print(f"  root causes of misses per rule mode: {report['mismatch_root_causes']}")
        c = report["calibration"]
        if c:
            w = c["weighted"]
            print(f"  Bayes ceiling of flag-based rules: {c['ceiling']['max_correct']}/{c['ceiling']['total']}")
            print(f"  AUC FAIL vs HOLD: yield gate {c['rule_auc']:.3f} | calibrated model {c['model_auc_mean']:.3f} "
                  f"+- {c['model_auc_std']:.3f} (train {c['model_train_auc']:.3f}) | equal-weight severity "
                  f"{c['severity_auc']:.3f}")
            print(f"  weighted severity: weights {w['weights_config']} cut {w['cut_config']}; "
                  f"CV accuracy {w['cv_accuracy']:.3f} +- {w['cv_std']:.3f}; min margin {w['min_margin_to_cut']}")
            print(f"  features excluded by quality gates: {c['features_excluded']}")
            print(f"  ambiguous trials (human review): {c['ambiguous_trials']}")
        n = report["numerical"]
        print("== Numerical verification", "PASSED" if n["passed"] else "FAILED",
              f"(kappa(X) = {n['condition_number_data']:.2f}, eps = {n['machine_epsilon']:.1e})")
        for chk in n["checks"]:
            print(f"    {chk['check']:38s} {chk['value']:.3e}  (tol {chk['tolerance']:.0e})")
        s = report["spectral"]
        if s:
            print(f"== Spectral: {s['features']} features -> {s['retained_components']} components, energy "
                  f"{s['energy_retained']:.1%}, truncation error {s['truncation_error_rel_frobenius_sq']:.2%} (exact)")
        print(f"== Integrity: no key lost = {report['integrity']['no_key_lost']}; drift: {report['drift']}")
        print(f"== Topology (H0): {report['topology'].get('reading')}")
        print("== Data quality", report["quality"])
        for line in report["quality_issues"]:
            print("  " + line[:200])
        print("== Candidate triage", report["scoring"])
        print(f"== Run saved to {report['run_file']}")

    if args.plot and e.calibration:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        roc, cal = e.calibration.roc, e.calibration
        fig, ax = plt.subplots(figsize=(5.8, 5.2))
        ax.plot(roc["rule_fpr"], roc["rule_tpr"], label=f"yield gate (AUC {cal.rule_auc:.2f})")
        ax.plot(roc["model_fpr"], roc["model_tpr"], label=f"calibrated model, out-of-fold (AUC {cal.model_auc_mean:.2f})")
        ax.plot(roc["severity_fpr"], roc["severity_tpr"], label=f"equal-weight severity (AUC {cal.severity_auc:.2f})")
        ax.plot(roc["weighted_fpr"], roc["weighted_tpr"], ls="--",
                label=f"weighted severity (CV acc. {cal.weighted['cv_accuracy']:.3f})")
        ax.plot([0, 1], [0, 1], ls=":", c="grey", lw=1)
        ax.set_xlabel("False positive rate (HOLD called FAIL)")
        ax.set_ylabel("True positive rate (FAIL called FAIL)")
        ax.set_title("FAIL vs HOLD: rules vs calibrated model")
        ax.legend(loc="lower right", fontsize=7.5)
        fig.tight_layout()
        fig.savefig(args.plot, dpi=150)
        print(f"ROC written to {args.plot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
