"""Data quality, telemetry/diagnostics, patterns, snapshot and agent tools on the mock data."""

import json

import numpy as np
import pytest

from data_engine import agent_tools, diagnostics, patterns


def test_quality_issues_are_categorised_with_fix_status(engine):
    q = engine.quality_report()
    ids = {i["id"]: i for i in q["issues"]}
    assert ids["linkage.operation_material_not_in_trial"]["count"] == 131
    assert ids["temporal.operation_year_mismatch"]["count"] == 144
    assert ids["aggregation.genomic_breeding_value_mean"]["fix_status"] == "applied"
    assert ids["completeness.pedigree_empty"]["fix_status"] == "not_fixable"
    assert all(i["root_cause"] and i["fix"] for i in q["issues"])
    # recomputed aggregates would break parity: evidence that the official verdicts used the reported ones
    w = q["what_if_recomputed_aggregates"]
    assert w["parity_with_recomputed_aggregates"] < w["parity_with_reported_aggregates"]


def test_original_values_are_never_overwritten(engine):
    t = engine.quality.reconciled_trials
    assert {"GBV_MEAN_RECOMPUTED", "GENOMIC_BREEDING_VALUE_MEAN"} <= set(t.columns)
    raw = engine.model.trials.set_index("TRIAL_ID")["GENOMIC_BREEDING_VALUE_MEAN"]
    assert (t.set_index("TRIAL_ID")["GENOMIC_BREEDING_VALUE_MEAN"] == raw).all()


def test_run_report_has_timings_memory_and_numerical_checks(engine):
    r = engine.diagnostics_report()
    names = [s["name"] for s in r["stages"]]
    assert {"canonical_model", "rules_trial", "calibration", "diagnostics"} <= set(names)
    assert all(s["wall_s"] >= 0 and s["cpu_s"] >= 0 for s in r["stages"])
    assert r["hardware"]["memory_budget_bytes"] > 0
    num = r["diagnostics"]["numerical"]
    assert num["passed"], [c for c in num["checks"] if not c["passed"]]
    assert all(c["value"] < 1e-9 for c in num["checks"])  # machine precision, not just "small"
    assert r["diagnostics"]["integrity"]["no_key_lost"]
    json.dumps(r)  # the whole report is valid JSON


def test_run_json_is_saved(engine):
    if engine.run_path is None:
        pytest.skip("runs not saved in this configuration")
    saved = json.loads(open(engine.run_path, encoding="utf-8").read())
    assert saved["stages"] and saved["diagnostics"]["integrity"]["no_key_lost"]


def test_drift_is_zero_against_identical_data(engine):
    fp = engine.diagnostics["fingerprint"]
    frames = {s: __import__("pandas").concat([t.frame for t in engine.tables if t.detection.source == s])
              for s in fp}
    d = diagnostics.drift(fp, frames)
    assert d["status"] == "stable" and d["max_drift"] < 1e-6


def test_h0_persistence_equals_single_linkage_mst():
    rng = np.random.default_rng(0)
    pts = np.vstack([rng.normal(0, 0.1, (20, 2)), rng.normal(5, 0.1, (20, 2))])
    deaths = diagnostics.h0_persistence(pts)
    assert len(deaths) == 39
    assert deaths[-1] > 4.0 and deaths[-2] < 1.0      # exactly one long bar: two clusters
    assert diagnostics.topology(pts)["well_separated_groups"] == 2


def test_identifier_combinatorics(engine):
    rep = engine.patterns_report()
    fam = rep["candidate_id"]["families"][0]
    assert fam["format_regex"] == r"^SYN\-MZ\-\d{5}$" and fam["format_capacity"] == 100_000
    assert fam["counter"]["contiguous"] and fam["counter"]["gaps"] == 0
    assert rep["MATERIAL_GUID"]["families"][0]["sequential"] is True  # synthetic GUIDs are a counter


def test_counter_gaps_reveal_missing_records():
    fam = patterns.analyse_column(["ID-001", "ID-002", "ID-005"])["families"][0]
    assert fam["counter"]["gaps"] == 2 and fam["counter"]["gap_examples"] == [3, 4]


def test_fact_extraction_reads_values_and_keeps_provenance():
    facts = patterns.extract_facts("SYN-MZ-00001: rendimiento de 8,7 t/ha.\nNo value here.", "note.txt", page=2)
    f = next(x for x in facts if x["field"] == "YIELD_T_HA")
    assert f["value"] == 8.7 and f["unit"] == "t/ha" and f["ids"]["candidate_id"] == ["SYN-MZ-00001"]
    assert f["source"] == "note.txt" and f["page"] == 2


def test_agent_tools_never_raise_and_have_no_override(engine):
    names = {t["name"] for t in agent_tools.TOOLS}
    assert not any("override" in n for n in names)  # overrides are human-only
    out = json.loads(agent_tools.call_tool(engine, "get_trial", {"trial_id": "NOPE"}))
    assert out["error"]["code"] == "NOT_FOUND"
    ctx = json.loads(agent_tools.call_tool(engine, "get_candidate_context", {"candidate_id": "SYN-MZ-00001"}))
    assert ctx["colour"] in {"GREEN", "AMBER", "RED"} and ctx["evidence"]


def test_search_and_sql(engine):
    assert engine.search("SYN-MZ-00001")["hits"][0]["id"] == "SYN-MZ-00001"
    res = engine.sql("SELECT colour, COUNT(*) AS n FROM candidate_decisions GROUP BY colour")
    assert sum(r["n"] for r in res["rows"]) == 150
    with pytest.raises(ValueError):
        engine.sql("SELECT 1; DROP TABLE trials")


def test_snapshot_roundtrip(engine, tmp_path):
    pytest.importorskip("duckdb")
    from data_engine.store import snapshot
    import duckdb
    info = snapshot(engine, tmp_path)
    con = duckdb.connect(info["tables"])
    assert con.execute("SELECT COUNT(*) FROM candidate_decisions").fetchone()[0] == 150
    z = np.load(info["spectral"])
    assert z["components"].shape[1] == engine.spectral.k
