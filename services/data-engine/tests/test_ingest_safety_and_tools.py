"""Demo-day fixes: an upload can never poison the engine, and the chat tools give totals, not pages."""

import json
from pathlib import Path

import pandas as pd
import pytest

from data_engine import agent_tools


def _fresh(engine):
    from data_engine import DataEngine
    return DataEngine([t for t in engine.raw_tables if not t.meta.get("uploaded")],
                      overrides_path=engine.overrides.path.parent / "fresh-overrides.jsonl", save_runs=False)


def test_a_failing_rebuild_is_rolled_back(engine, mock_dir, monkeypatch):
    """Before: the bad table stayed in raw_tables and every later ingest failed until a restart."""
    from data_engine import quality
    e = _fresh(engine)
    n_tables, candidates = len(e.raw_tables), e.query_candidates()
    real = quality.assess

    def boom(*a, **k):
        raise KeyError("TRIAL_GUID")

    monkeypatch.setattr(quality, "assess", boom)
    rows = pd.read_csv(mock_dir / "operations_synthetic.csv").head(3).to_dict("records")
    res = e.add_records("bad.csv", rows)
    assert res["accepted"] is False and "nothing was changed" in res["message"]
    assert len(e.raw_tables) == n_tables and e.query_candidates() == candidates   # previous model still served
    monkeypatch.setattr(quality, "assess", real)
    assert e.add_records("good.csv", rows)["accepted"] is True                   # and the next ingest works


def test_the_archive_drop_cannot_break_or_duplicate_anything(engine, mock_dir):
    """The 28-Sep drop re-keys the same trials; its operations point to trials that do not exist."""
    arch = Path(mock_dir) / "archive" / "2026-09-28"
    if not arch.exists():
        pytest.skip("archive not present")
    e = _fresh(engine)
    trials = e.add_records("trial_synthetic.csv", pd.read_csv(arch / "trial_synthetic.csv").to_dict("records"))
    assert trials["accepted"] and trials["rows_added"] == 0 and trials["conflicts"] == 72   # same TRIAL_ID, new GUID
    ops = e.add_records("operations_synthetic.csv", pd.read_csv(arch / "operations_synthetic.csv").to_dict("records"))
    assert ops["accepted"] is True                                                  # was a KeyError + poisoned state
    assert len(e.trial_decisions) == 72 and e.model.trials["TRIAL_ID"].is_unique
    assert e.add_records("again", pd.read_csv(mock_dir / "operations_synthetic.csv").head(2)
                         .to_dict("records"))["accepted"] is True


def test_query_candidates_tool_reports_the_total_not_the_page(engine):
    out = json.loads(agent_tools.call_tool(engine, "query_candidates", {"colour": "RED", "limit": 5}))
    reds = engine.apply_scoring()["effective_counts"]["RED"]
    assert out["total"] == reds and out["returned"] == 5 and out["truncated"] is True
    assert len(out["candidates"]) == 5 and all(c["colour"] == "RED" for c in out["candidates"])
    full = json.loads(agent_tools.call_tool(engine, "query_candidates", {"colour": "GREEN", "limit": 200}))
    assert full["truncated"] is False and full["returned"] == full["total"]


def test_apply_scoring_separates_rule_and_effective_colours(engine):
    e = _fresh(engine)
    cid = e.query_candidates(colour="RED", limit=1)[0]["candidate_id"]
    before = e.apply_scoring()
    assert before["counts"] == before["effective_counts"] and before["overridden"] == 0
    e.record_override(candidate_id=cid, new_colour="AMBER", reason_code="FIELD_OBSERVATION", comment="t", user="test")
    after = e.apply_scoring()
    assert after["counts"] == before["counts"]                                   # the rules did not change
    assert after["effective_counts"]["RED"] == before["counts"]["RED"] - 1
    assert after["effective_counts"]["AMBER"] == before["counts"]["AMBER"] + 1 and after["overridden"] == 1
    tool = json.loads(agent_tools.call_tool(e, "query_candidates", {"colour": "RED"}))
    assert tool["total"] == after["effective_counts"]["RED"]                      # the chat and the board agree


def test_llm_context_trial_counts_match_the_trial_list(engine):
    for cid in list(engine.candidate_decisions)[:20]:
        p = engine.llm_context(cid)["payload"]
        c = p["trial_counts"]
        assert c["total"] == len(p["trials"]) == c["PASS"] + c["HOLD"] + c["FAIL"]
        assert c["ambiguous"] == sum("(ambiguous)" in t for t in p["trials"])
        assert c["not_explained_by_data"] == sum("(not explained by data)" in t for t in p["trials"])


def test_system_prompt_asks_for_english_digits_and_totals():
    prompt = agent_tools.SYSTEM_PROMPT
    assert "Always reply in English" in prompt
    assert "apply_scoring" in prompt and "effective_counts" in prompt and "digits" in prompt
    desc = next(t for t in agent_tools.TOOLS if t["name"] == "query_candidates")["description"]
    assert "default 20" in desc and "total" in desc
