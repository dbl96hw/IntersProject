"""Document extraction: text layer, tables, OCR, and the Python/C++ back-ends agreeing.

Each test skips when the library or binary it needs is not installed, so the
suite passes on a minimal install and gets stricter as back-ends are added.
"""

import os
from pathlib import Path

import pytest

import doc_fixtures as fx
from data_engine import documents
from data_engine.documents import native, python_backends as py
from data_engine.documents.structure import normalise_table, structure


@pytest.fixture
def docs_dir(tmp_path):
    return tmp_path


def _need(path):
    if path is None:
        pytest.skip("generator library not installed")
    return path


def test_sniff_uses_magic_bytes_not_extension(docs_dir):
    html = fx.html_with_table(docs_dir / "page.html")
    renamed = html.with_suffix(".pdf")
    html.rename(renamed)
    assert documents.sniff(renamed) == "html"  # the extension lies, the bytes do not


def test_html_table_becomes_a_genomics_input(docs_dir):
    ing = structure(documents.extract(fx.html_with_table(docs_dir / "page.html")))
    assert [t.meta["source"] for t in ing.accepted_tables] == ["genomics"]
    assert "var x" not in ing.document["path"] and ing.facts


def test_docx_text_and_table(docs_dir):
    if not py.HAS["docx"]:
        pytest.skip("python-docx not installed")
    ing = structure(documents.extract(_need(fx.docx_with_table(docs_dir / "note.docx"))))
    assert ing.accepted_tables and ing.accepted_tables[0].meta["source"] == "genomics"
    fields = {f["field"] for f in ing.facts if f["field"]}
    assert {"YIELD_T_HA", "DISEASE_SCORE"} <= fields


def test_native_pdf_is_read_not_ocrd(docs_dir, monkeypatch):
    if not py.HAS["pdfplumber"]:
        pytest.skip("pdfplumber not installed")
    monkeypatch.setenv("DATA_ENGINE_DOC_BACKENDS", "python")
    doc = documents.extract(_need(fx.native_pdf_with_table(docs_dir / "native.pdf")))
    assert doc.page_method[0] == "text-layer" and "SYN-MZ-00012" in doc.text
    assert doc.tables  # pdfplumber recovered the table structure


def test_scanned_pdf_is_ocrd(docs_dir, monkeypatch):
    if not (py.HAS["pytesseract"] and py.HAS["pypdfium2"]):
        pytest.skip("Tesseract / pypdfium2 not installed")
    monkeypatch.setenv("DATA_ENGINE_DOC_BACKENDS", "python")
    doc = documents.extract(_need(fx.scanned_pdf(docs_dir / "scan.pdf")))
    assert doc.page_method == ["ocr"] and doc.ocr_confidence and doc.ocr_confidence > 60
    ing = structure(doc)
    assert any(f["field"] == "YIELD_T_HA" and f["value"] == 9.4 for f in ing.facts)


def test_cpp_and_python_ocr_agree(docs_dir, monkeypatch):
    if not (native.available() and py.HAS["pytesseract"]):
        pytest.skip("C++ docs back-end not built or Tesseract missing")
    img = _need(fx.text_image(docs_dir / "photo.png", fx.NOTE_LINES))
    text_cpp, _ = native.ocr_image(Path(img), "eng")
    text_py, _ = py.ocr_image(Path(img), "eng")
    norm = lambda s: " ".join(s.split()).lower()
    assert norm(text_cpp) == norm(text_py)


def test_table_header_detection_skips_title_rows():
    import pandas as pd
    frame = pd.DataFrame([["Lab report", None, None], ["MATERIAL_GUID", "TRAIT_GUID", "NUMBER_VALUE"],
                          ["a", "t1", "1,5"], ["b", "t2", "2,0"]])
    table = normalise_table(frame)
    assert list(table.columns) == ["MATERIAL_GUID", "TRAIT_GUID", "NUMBER_VALUE"]
    assert table["NUMBER_VALUE"].tolist() == [1.5, 2.0]  # decimal commas parsed


def test_document_rows_never_overwrite_exports(engine, docs_dir):
    from data_engine import DataEngine
    if not py.HAS["docx"]:
        pytest.skip("python-docx not installed")
    e = DataEngine(list(engine.raw_tables), overrides_path=engine.overrides.path, save_runs=False)
    guid = fx.GENOMICS_ROW[1]
    before = e.model.genomics.set_index("MATERIAL_GUID").at[guid, "GENOMIC_BREEDING_VALUE"]
    e.add_document(fx.docx_with_table(docs_dir / "conflict.docx"))
    after = e.model.genomics.set_index("MATERIAL_GUID").at[guid, "GENOMIC_BREEDING_VALUE"]
    assert before == after
    assert e.document_conflicts and "GENOMIC_BREEDING_VALUE" in e.document_conflicts[0]["differences"]
    assert e.document_facts("SYN-MZ-00012")  # the document's sentences are still searchable evidence
