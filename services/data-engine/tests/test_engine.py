"""End-to-end tests on the UC4 mock data (skipped if the data is not present)."""

import pandas as pd
import pytest

from data_engine import detect, ingest
from data_engine.profile import profile_table


def test_every_mock_file_is_detected_with_full_score(mock_dir):
    for path in ingest.discover(mock_dir):
        for table in ingest.read_file(path):
            d = detect.detect(list(table.frame.columns))
            assert d.confident and d.score == 1.0, (path.name, d)


def test_unknown_table_is_not_forced_into_a_source():
    d = detect.detect(["FOO", "BAR", "MATERIAL_GUID"])
    assert d.source == detect.UNKNOWN


def test_renormalization_only_drops_zero_entropy_columns(mock_dir):
    for path in ingest.discover(mock_dir):
        df = ingest.read_file(path)[0].frame
        p = profile_table(df)
        for col in p.dropped:
            assert df[col].nunique(dropna=False) <= 1, (path.name, col)


def test_parity_with_official_logic(engine):
    base = engine.baseline()
    assert base["parity"]["agree"] == 72  # weighted severity (default mode)
    # every miss of the equal-weight rule is explained by the weighting
    assert base["mismatch_root_causes"]["severity"]["by_category"] == {"WEIGHTING": 4}
    # PASS must be reproduced exactly: it is fully determined by the published fields.
    conf = base["confusion_official_vs_engine"]
    assert conf["PASS"]["PASS"] == sum(conf["PASS"].values())
    assert sum(conf[o]["PASS"] for o in ("HOLD", "FAIL")) == 0


def test_official_verdict_is_never_overwritten(engine):
    for d in engine.trial_decisions.values():
        if d.official_verdict is not None:
            assert d.verdict == d.official_verdict


def test_bayes_ceiling_and_severity_rule(engine):
    c = engine.calibration
    if c is None:
        pytest.skip("scikit-learn not installed")
    assert c.ceiling["max_correct"] == 60
    assert c.severity_auc > c.model_auc_mean > c.rule_auc
    assert c.overtraining_gap < 0.15
    assert c.weighted["cv_accuracy"] > 0.95 and c.weighted["train_accuracy_config"] == 1.0
    assert "PLANTING_DATE" in c.features_excluded  # failed the date-quality gate


def test_every_evidence_value_exists_in_the_data(engine):
    """Anti-hallucination at the source: each cited number is read back from the canonical tables."""
    trials = engine.model.trials.set_index("TRIAL_ID")
    for d in engine.trial_decisions.values():
        for e in d.evidence:
            if e.rule in ("severity",):
                continue
            assert trials.at[d.record, e.field] == pytest.approx(e.value)


def test_candidate_profile_is_complete_and_serialisable(engine):
    import json
    cid = next(iter(engine.candidate_decisions))
    p = engine.get_candidate_profile(cid)
    json.dumps(p)
    assert p["colour"] in {"GREEN", "AMBER", "RED"} and p["reason"]
    assert p["evidence"] and p["trials"]
    assert p["lineage"]["available"] is False  # pedigree is empty in the mocks, and we say so


def test_llm_context_is_much_smaller_than_raw_rows(engine):
    cid = next(iter(engine.candidate_decisions))
    tokens = engine.llm_context(cid)["tokens"]
    assert tokens["reduction"] > 0.8


def test_override_is_logged_and_does_not_change_engine_colour(engine):
    cid = engine.query_candidates(colour="RED", limit=1)[0]["candidate_id"]
    entry = engine.record_override(candidate_id=cid, new_colour="AMBER", reason_code="FIELD_OBSERVATION",
                                   comment="good vigour in plot 12", user="test")
    row = next(r for r in engine.query_candidates() if r["candidate_id"] == cid)
    assert row["colour"] == "AMBER" and row["engine_colour"] == "RED" and row["overridden"]
    assert engine.overrides.all()[-1].id == entry["id"]
    with pytest.raises(ValueError):
        engine.record_override(candidate_id=cid, new_colour="AMBER", reason_code="OTHER", comment="")


def test_structured_records_from_extraction_service(engine):
    from data_engine import DataEngine
    e = DataEngine(list(engine.raw_tables), overrides_path=engine.overrides.path)
    res = e.add_records("pdf-lab-report", [{"FOO": 1, "BAR": 2}])
    assert res["accepted"] is False  # unknown shape goes back to a human / the LLM
    genomic_row = e.model.genomics.iloc[[0]].to_dict("records")
    assert e.add_records("genomics-from-pdf", genomic_row)["accepted"] is True


def test_api_smoke(engine, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from data_engine import api
    monkeypatch.setattr(api, "_engine", engine)
    client = TestClient(api.app)
    assert client.get("/health").json()["healthy"] is True
    cid = client.get("/candidates", params={"limit": 1}).json()[0]["candidate_id"]
    assert client.get(f"/candidates/{cid}").status_code == 200
    missing = client.get("/candidates/NOPE")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "NOT_FOUND"  # team error contract
    bad = client.post("/overrides", json={"candidate_id": cid, "new_colour": "BLUE", "reason_code": "X"})
    assert bad.status_code == 400 and bad.json()["error"]["field"] == "new_colour"
    assert client.get("/baseline").json()["parity"]["agree"] == 72
    r = client.post("/overrides", json={"candidate_id": cid, "new_colour": "GREEN", "reason_code": "MARKET_FIT"})
    assert r.status_code == 201
    tools = client.get("/tools").json()
    assert {t["name"] for t in tools["tools"]} >= {"query_candidates", "get_candidate_context"}
    out = client.post("/tools/get_trial", json={"trial_id": "SYN-TR-0001"}).json()["content"]
    assert '"trial_id": "SYN-TR-0001"' in out
    assert client.post("/sql", json={"query": "DROP TABLE trials"}).status_code == 400
    assert client.get("/diagnostics").json()["diagnostics"]["numerical"]["passed"] is True


def test_first_drop_schema_is_still_recognised(mock_dir):
    """Schema drift: the 28-Sep drop used a different observation schema; it must not be mis-routed."""
    old = mock_dir / "archive" / "2026-09-28"
    if not old.exists():
        pytest.skip("first drop not present")
    for path in ingest.discover(old):
        d = detect.detect(list(ingest.read_file(path)[0].frame.columns))
        assert d.confident, (path.name, d)
        if path.name.startswith("observation"):
            assert d.source == "observations" and d.variant == 1
