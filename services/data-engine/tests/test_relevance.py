"""Relevance gate: off-topic files are stopped, breeding files go through, and the doubtful are flagged."""

import base64

import pytest

from data_engine import relevance as rel

# Held-out texts: NOT in config/relevance.yaml (the model never saw them).
HELD_OUT_IN = [
    "Resumen del ensayo 2025 en Guanacaste: el híbrido de sandía tuvo buen rendimiento pero más mildiu en la segunda repetición.",
    "The breeding team reviewed 40 pepper lines; lines with high Phytophthora scores were dropped before the next cycle.",
    "Lab report: germination 92%, seed purity 99.1%, moisture 7.2% for lot 23-118 of the cucumber hybrid.",
    "Notas de campo: plantas de tomate con buen vigor, floración temprana y frutos uniformes en el bloque 3.",
    "Marker panel results: 96 SNPs, call rate 98%, resistance allele present in 31 of 48 entries.",
    "Please check the yield data from the Brazil trial before the advancement meeting on Friday.",
]
HELD_OUT_OFF = [
    "Minutes of the board meeting: approved the annual budget and the new office lease.",
    "El partido terminó empatado; los aficionados celebraron en la plaza central.",
    "Your order has shipped and will arrive on Thursday.",
    "Kubernetes deployment failed because the container image could not be pulled.",
    "Syllabus: linear algebra, eigenvalues, Fourier series and partial differential equations.",
    "Hola mamá, llego tarde a la cena, guárdame un plato por favor.",
    "Insurance claim form: policy number, date of accident, description of damages.",
    "Our quarterly marketing campaign increased website traffic by 12 percent.",
]


@pytest.fixture(scope="module")
def model():
    return rel.model()


def test_nested_leave_one_out_makes_no_wrong_decision(model):
    report = model.loo_report()
    assert report["wrong_decisions"] == []            # errors only ever land in UNCERTAIN
    assert report["accuracy_at_0_5"] >= 0.9
    assert report["decided"] >= 0.8 * report["n"]


@pytest.mark.parametrize("text", HELD_OUT_IN)
def test_held_out_breeding_text_is_never_rejected(model, text):
    assert model.assess(text).decision != rel.IRRELEVANT


@pytest.mark.parametrize("text", HELD_OUT_OFF)
def test_held_out_off_topic_text_is_never_accepted(model, text):
    assert model.assess(text).decision != rel.RELEVANT


def test_held_out_accuracy(model):
    right = sum(model.assess(t).decision == rel.RELEVANT for t in HELD_OUT_IN)
    right += sum(model.assess(t).decision == rel.IRRELEVANT for t in HELD_OUT_OFF)
    assert right >= 0.85 * (len(HELD_OUT_IN) + len(HELD_OUT_OFF))


def test_company_name_alone_is_not_enough(model):
    a = model.assess("Syngenta reported third-quarter sales of 7.1 billion dollars; EBITDA margin improved.")
    assert a.decision != rel.RELEVANT


def test_rules_decide_before_the_model(model, mock_dir):
    import pandas as pd
    ids = rel.identifiers([pd.read_csv(mock_dir / "trial_synthetic.csv")])
    known = next(iter(ids))
    a = model.assess(f"see {known} (short note)", known_ids=ids)
    assert a.decision == rel.RELEVANT and a.probability == 1.0 and "already holds" in a.reasons[0]
    header = list(pd.read_csv(mock_dir / "genomics_synthetic.csv", nrows=1).columns)
    b = model.assess("", tables=[header])
    assert b.decision == rel.RELEVANT and b.signals["table_sources"][0]["source"] == "genomics"


def test_numbers_are_not_identifiers():
    import pandas as pd
    ids = rel.identifiers([pd.DataFrame({"SEASON_ID": ["2024", "2025"], "TRIAL_ID": ["SYN-TR-0001", "A1"]})])
    assert ids == {"SYN-TR-0001"}


def test_empty_or_tiny_text_is_uncertain_not_rejected(model):
    assert model.assess("").decision == rel.UNCERTAIN
    assert model.assess("hello").decision == rel.UNCERTAIN


def test_the_model_is_deterministic(model):
    text = HELD_OUT_IN[0]
    assert rel.RelevanceModel().assess(text).probability == model.assess(text).probability


def test_engine_refuses_off_topic_documents_unless_forced(engine, tmp_path):
    from data_engine import DataEngine
    e = DataEngine(list(engine.raw_tables), overrides_path=engine.overrides.path, save_runs=False)
    off = tmp_path / "invoice.txt"
    off.write_text("Invoice 4821: two laptops and a monitor. Subtotal, tax and total due in 30 days. "
                   "Please pay by bank transfer to the account below.", encoding="utf-8")
    n_docs = len(e.documents)
    res = e.add_document(off)
    assert res["accepted"] is False and res["relevance"]["decision"] == rel.IRRELEVANT
    assert len(e.documents) == n_docs and e.rejected_documents[-1]["path"].endswith("invoice.txt")
    assert e.add_document(off, force=True)["accepted"] is True       # the human override
    note = tmp_path / "note.txt"
    note.write_text("Field note: SYN-MZ-00012 in SYN-TR-0007 showed yield 9.4 t/ha.", encoding="utf-8")
    ok = e.add_document(note)
    assert ok["accepted"] and ok["relevance"]["decision"] == rel.RELEVANT and not ok["needs_review"]


def test_relevance_api(engine, monkeypatch, mock_dir):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from data_engine import api
    monkeypatch.setattr(api, "_engine", engine)
    client = TestClient(api.app)
    r = client.post("/relevance", json={"text": "Recipe: mix flour, sugar and eggs and bake for 30 minutes."})
    assert r.status_code == 200 and r.json()["decision"] == rel.IRRELEVANT
    csv = (mock_dir / "operations_synthetic.csv").read_bytes()
    r = client.post("/relevance", json={"filename": "ops.csv", "content_base64": base64.b64encode(csv).decode()})
    body = r.json()
    assert body["decision"] == rel.RELEVANT and body["file"]["kind"] == "table"
    assert client.post("/relevance", json={}).status_code == 400
    card = client.get("/relevance/model").json()
    assert card["leave_one_out"]["wrong_decisions"] == [] and card["examples"]["off_topic"] > 0
