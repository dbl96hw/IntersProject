"""Integrated V2 drop (2026-10-02): candidate-level official RAG, bridge, trait dictionary, field updates."""

import json

import pandas as pd
import pytest

from data_engine import agent_tools, detect, ingest

V2_FILES = {
    "candidate_recommendations_synthetic.csv": "candidate_recommendations",
    "genomics_synthetic.csv": "genomics",
    "germplasm_pedigree_synthetic.csv": "germplasm",
    "lab_observations_synthetic.csv": "lab_observations",
    "observation_synthetic.csv": "observations",
    "operations_field_updates_synthetic.csv": "field_operations",
    "trait_dictionary_synthetic.csv": "trait_dictionary",
    "trial_germplasm_bridge_synthetic.csv": "trial_germplasm_bridge",
}


def test_every_v2_file_is_routed_to_its_source(v2_dir):
    for name, source in V2_FILES.items():
        table = ingest.read_file(v2_dir / name)[0]
        d = detect.detect(list(table.frame.columns))
        assert d.confident and d.source == source, (name, d)


def test_official_rag_is_reproduced_150_of_150(engine_v2):
    assert engine_v2.profile == "v2"
    base = engine_v2.baseline()
    assert base["parity"] == {"agree": 150, "total": 150, "accuracy": 1.0}
    assert engine_v2.apply_scoring()["counts"] == {"RED": 65, "AMBER": 53, "GREEN": 32}
    assert base["reason_text_identical"]["agree"] >= 146     # the rest differ only in a rounded last digit


def test_the_official_summary_is_recomputed_from_raw_data(engine_v2):
    """N trials, usable trials, yield vs checks, disease, moisture, germination and fumonisin: all within rounding."""
    rec = engine_v2.v2.recomputation
    assert set(rec) >= {"N_TRIALS", "N_TRIALS_USED", "YIELD_VS_CHECK_PCT", "DISEASE_SCORE_MEAN",
                        "MOISTURE_PCT_MEAN", "GERMINATION_PCT", "FUMONISIN_PPM"}
    assert all(s["outside_tolerance"] == 0 for s in rec.values()), rec
    assert rec["N_TRIALS_USED"]["compared"] == 150


def test_v2_findings_match_the_drop(engine_v2):
    issues = {i["id"]: i for i in engine_v2.quality_report()["issues"]}
    assert issues["design.no_trial_master"]["count"] == 72
    assert issues["design.no_trial_master"]["evidence"]["matching_deprecated_trial_guids"] in (0, None)
    assert issues["decision.breeder_decision_empty"]["count"] == 150
    assert issues["completeness.genotyped_without_trials"]["evidence"]["lines"] == ["SYN-MZ-00149", "SYN-MZ-00150"]
    assert issues["design.commercial_checks"]["evidence"]["checks"] == ["SYN-MZ-CHK01", "SYN-MZ-CHK02"]
    assert issues["operations.delayed"]["count"] == 11
    assert issues["operations.missed"]["count"] == 5
    assert issues["operations.missed"]["evidence"]["candidates_with_one_trial_excluded"] == 30
    assert issues["operations.recorded_offline"]["count"] == 140
    assert issues["integrity.referential"]["count"] == 0
    assert all(r["share"] == 1.0 for r in engine_v2.v2.references.values())
    assert engine_v2.diagnostics["integrity"]["no_key_lost"] is True


def test_keys_and_sizes(engine_v2):
    m = engine_v2.model
    assert len(m.materials) == 152 and m.materials["MATERIAL_GUID"].is_unique
    assert len(m.trials) == 72 and int(m.trials["n_entries"].sum()) == 1728
    assert len(engine_v2.v2.traits) == 6
    assert set(m.lab.columns) >= {"GERMINATION_PCT", "COLD_TEST_PCT", "FUMONISIN_PPM"}   # names, not GUIDs
    assert engine_v2.sql("SELECT COUNT(*) AS n FROM materials")["rows"][0]["n"] == 150     # checks are not candidates
    assert "SYN-MZ-CHK01" not in engine_v2.candidate_decisions


def test_genotyped_only_lines_are_amber_with_the_official_reason(engine_v2):
    for cid in ("SYN-MZ-00149", "SYN-MZ-00150"):
        d = engine_v2.candidate_decisions[cid]
        assert d.colour == "AMBER" and d.reason.startswith("No field data yet")


def test_every_cited_value_is_in_the_export_and_the_numbers_check_out(engine_v2):
    assert engine_v2.evidence_reread_mismatches() == 0
    assert engine_v2.diagnostics["numerical"]["passed"] is True
    rec = engine_v2.v2.recommendations.set_index("MATERIAL_ID")
    for cid, d in list(engine_v2.candidate_decisions.items())[:40]:
        for e in d.evidence:
            if e.field in rec.columns and isinstance(e.value, float):
                assert rec.at[cid, e.field] == pytest.approx(e.value)


def test_candidate_card_context_and_trial_views(engine_v2):
    p = engine_v2.get_candidate_profile("SYN-MZ-00011")
    assert p["colour"] == "GREEN" and len(p["trials"]) == 3
    assert sum(t["engine_verdict"] == "EXCLUDED" for t in p["trials"]) == 1           # irrigation missed
    ctx = engine_v2.llm_context("SYN-MZ-00011")["payload"]
    assert ctx["trial_counts"]["total"] == 3 and ctx["trial_counts"]["EXCLUDED"] == 1
    trial = engine_v2.get_trial("SYN-TR-0001")
    assert len(trial["candidates"]) == 6 and trial["entries"] == 24
    out = json.loads(agent_tools.call_tool(engine_v2, "query_candidates", {"colour": "RED", "limit": 5}))
    assert out["total"] == 65 and out["truncated"] is True


def test_reupload_of_v2_exports_is_idempotent_and_contradictions_are_conflicts(engine_v2, v2_dir):
    from data_engine import DataEngine
    e = DataEngine(list(engine_v2.raw_tables), overrides_path=engine_v2.overrides.path.parent / "o.jsonl",
                   save_runs=False)
    raw = pd.read_csv(v2_dir / "candidate_recommendations_synthetic.csv", dtype=str, keep_default_na=False)
    records = [{k: v for k, v in r.items() if v != ""} for r in raw.to_dict("records")]
    empty = [c for c in raw.columns if (raw[c] == "").all()]
    records[0].update({c: None for c in empty})                                    # typed like Express
    res = e.add_records("candidate_recommendations_synthetic.csv", records)
    assert res["accepted"] and res["rows_added"] == 0 and res["duplicates_ignored"] == 150 and res["conflicts"] == 0
    changed = dict(records[0], SYSTEM_RAG="GREEN")
    res = e.add_records("edited.csv", [changed])
    assert res["conflicts"] == 1 and e.candidate_decisions["SYN-MZ-00001"].colour == "AMBER"    # export wins


def test_api_on_v2(engine_v2, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from data_engine import api
    monkeypatch.setattr(api, "_engine", engine_v2)
    client = TestClient(api.app)
    assert client.get("/health").json()["candidates"] == 150
    assert client.get("/baseline").json()["parity"]["agree"] == 150
    rows = client.get("/candidates", params={"colour": "GREEN"}).json()
    assert len(rows) == 32 and all(r["verdict"] == "PASS" for r in rows)
    assert client.get("/trials/SYN-TR-0004").status_code == 200
    assert client.post("/tools/explain_scoring_logic", json={}).status_code == 200
    assert client.get("/quality").status_code == 200 and client.get("/diagnostics").status_code == 200
