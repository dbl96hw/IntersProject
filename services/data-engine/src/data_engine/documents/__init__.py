"""Layer 0: turn any document into text + tables, with OCR when there is no text.

Deterministic-first again: a PDF with a text layer is *read*, never OCR'd
(OCR can only add errors to text that is already exact). OCR runs only on pages
whose text layer is empty or near-empty (< MIN_CHARS_PER_PAGE characters), and
its confidence is reported per document so low-quality scans are visible.

Back-ends, chosen automatically by file type, availability and size
(override the order with DATA_ENGINE_DOC_BACKENDS="cpp,python,julia,tika,textract"):

  type          fastest -> fallback
  ------------  ------------------------------------------------------------
  PDF text      C++ Poppler  ->  Julia PDFIO  ->  pdfplumber  ->  pypdf  ->  Tika  ->  textract
  PDF tables    pdfplumber (the only one that recovers table structure)
  scanned PDF   C++ Poppler render + Tesseract API (multithreaded)  ->  pypdfium2 + pytesseract
  image         C++ Tesseract API  ->  pytesseract
  DOCX          python-docx (text + tables)  ->  Tika  ->  textract
  PPTX          python-pptx (text + tables)  ->  Tika
  XLSX          openpyxl via pandas (one table per sheet)
  HTML          BeautifulSoup + pandas.read_html (tables)  ->  stdlib parser
  other         Tika (1000+ formats: DOC, RTF, ODT, EPUB, MSG...)  ->  textract

Every back-end is optional; the ones not installed are skipped and the choice
is recorded in `Document.backends`, so the output says exactly how it was made.

Resource use follows the hardware probe: OCR pages run in parallel (threads for
pytesseract, since Tesseract runs out of process; std::threads in C++), with
OMP_THREAD_LIMIT=1 per Tesseract process to avoid oversubscribing cores.
"""

from __future__ import annotations

import hashlib
import os
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

MIN_CHARS_PER_PAGE = int(os.environ.get("DATA_ENGINE_MIN_CHARS_PER_PAGE", 25))
DOC_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp", ".docx", ".pptx",
                  ".html", ".htm", ".txt", ".md", ".epub", ".doc", ".rtf", ".odt", ".ppt", ".msg", ".eml"}


@dataclass
class Document:
    path: str
    kind: str                                  # pdf | image | docx | pptx | xlsx | html | text | other
    sha256: str
    pages_text: list[str] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)   # {"page", "frame", "source"}
    page_method: list[str] = field(default_factory=list)          # per page: "text-layer" | "ocr"
    ocr_confidence: float | None = None
    backends: dict[str, str] = field(default_factory=dict)        # step -> backend actually used
    timings_s: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def text(self) -> str:
        return "\n\f".join(self.pages_text)

    def summary(self) -> dict:
        return {"path": self.path, "kind": self.kind, "sha256": self.sha256, "pages": len(self.pages_text),
                "characters": sum(len(p) for p in self.pages_text), "tables": len(self.tables),
                "ocr_pages": self.page_method.count("ocr"), "ocr_confidence": self.ocr_confidence,
                "backends": self.backends, "timings_s": self.timings_s, "warnings": self.warnings,
                "metadata": self.metadata}


def sniff(path: Path) -> str:
    """File kind from magic bytes first (extensions lie), extension second."""
    with open(path, "rb") as fh:
        head = fh.read(2048)
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith((b"\x89PNG", b"\xff\xd8\xff", b"II*\x00", b"MM\x00*", b"BM", b"GIF8")) or head[8:12] == b"WEBP":
        return "image"
    if head.startswith(b"PK\x03\x04"):
        try:
            names = zipfile.ZipFile(path).namelist()
        except zipfile.BadZipFile:
            return "other"
        if any(n.startswith("word/") for n in names):
            return "docx"
        if any(n.startswith("ppt/") for n in names):
            return "pptx"
        if any(n.startswith("xl/") for n in names):
            return "xlsx"
        return "other"  # epub, odt, ... -> Tika
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return "other"  # legacy OLE (doc/xls/ppt/msg) -> Tika
    low = head.lower()
    if b"<html" in low or b"<!doctype html" in low:
        return "html"
    try:
        head.decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return "other"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def backend_order() -> list[str]:
    raw = os.environ.get("DATA_ENGINE_DOC_BACKENDS", "cpp,julia,python,tika,textract")
    return [b.strip() for b in raw.split(",") if b.strip()]


def available_backends() -> dict[str, Any]:
    from . import native, python_backends as py
    from .julia_backend import julia_pdf_available
    return {"cpp": native.available(), "julia": julia_pdf_available(), **py.available()}


def extract(path: str | Path, ocr: bool = True, lang: str | None = None) -> Document:
    """Extract text (and tables) from one document, choosing back-ends as documented above."""
    from . import native, python_backends as py
    from .julia_backend import julia_pdf_available, julia_pdf_text

    path = Path(path)
    kind = sniff(path)
    doc = Document(str(path), kind, _sha256(path))
    lang = lang or py.default_ocr_lang()
    order = backend_order()
    t0 = time.perf_counter()

    if kind == "pdf":
        # 1) text layer, fastest available back-end
        for b in order:
            if b == "cpp" and native.available():
                doc.pages_text, doc.backends["text"] = native.pdf_text(path), "cpp:poppler"
            elif b == "julia" and julia_pdf_available():
                doc.pages_text, doc.backends["text"] = julia_pdf_text(path), "julia:PDFIO"
            elif b == "python" and py.HAS["pdfplumber"]:
                doc.pages_text, doc.backends["text"] = py.pdf_text_pdfplumber(path), "python:pdfplumber"
            elif b == "python" and py.HAS["pypdf"]:
                doc.pages_text, doc.backends["text"] = py.pdf_text_pypdf(path), "python:pypdf"
            elif b == "tika" and py.HAS["tika"]:
                doc.pages_text, doc.backends["text"] = [py.tika_text(path)], "tika"
            elif b == "textract" and py.HAS["textract"]:
                doc.pages_text, doc.backends["text"] = [py.textract_text(path)], "textract"
            if doc.backends.get("text"):
                break
        doc.timings_s["text"] = round(time.perf_counter() - t0, 4)
        # 2) tables (structure), pdfplumber only
        if py.HAS["pdfplumber"]:
            t1 = time.perf_counter()
            doc.tables = py.pdf_tables(path)
            doc.backends["tables"] = "python:pdfplumber"
            doc.timings_s["tables"] = round(time.perf_counter() - t1, 4)
        # 3) OCR only for pages without a usable text layer
        doc.page_method = ["text-layer" if len(p.strip()) >= MIN_CHARS_PER_PAGE else "ocr" for p in doc.pages_text]
        need = [i for i, m in enumerate(doc.page_method) if m == "ocr"]
        if need and ocr:
            t2 = time.perf_counter()
            if native.available() and len(need) >= len(doc.pages_text) / 2 and "cpp" in order:
                texts, conf = native.pdf_ocr(path, lang)
                for i in need:
                    doc.pages_text[i] = texts[i] if i < len(texts) else ""
                doc.backends["ocr"] = "cpp:poppler+tesseract"
            elif py.HAS["pytesseract"] and py.HAS["pypdfium2"]:
                ocr_texts, conf, plan = py.pdf_ocr_pages(path, need, lang)
                for i, text in zip(need, ocr_texts):
                    doc.pages_text[i] = text
                doc.backends["ocr"] = "python:pypdfium2+pytesseract"
                doc.metadata["ocr_parallel_plan"] = plan
            else:
                conf = None
                doc.warnings.append(f"{len(need)} page(s) have no text layer and no OCR back-end is installed")
            doc.ocr_confidence = conf
            doc.timings_s["ocr"] = round(time.perf_counter() - t2, 4)
        elif need:
            doc.warnings.append(f"{len(need)} page(s) have no text layer (OCR disabled)")

    elif kind == "image":
        if "cpp" in order and native.available():
            text, conf = native.ocr_image(path, lang)
            doc.backends["ocr"] = "cpp:tesseract"
        elif py.HAS["pytesseract"]:
            text, conf = py.ocr_image(path, lang)
            doc.backends["ocr"] = "python:pytesseract"
        else:
            text, conf = "", None
            doc.warnings.append("image input but no OCR back-end installed (install Tesseract + pytesseract)")
        doc.pages_text, doc.page_method, doc.ocr_confidence = [text], ["ocr"], conf
        doc.timings_s["ocr"] = round(time.perf_counter() - t0, 4)

    elif kind == "docx" and py.HAS["docx"]:
        doc.pages_text, doc.tables = py.docx_extract(path)
        doc.backends["text"] = "python:python-docx"
    elif kind == "pptx" and py.HAS["pptx"]:
        doc.pages_text, doc.tables = py.pptx_extract(path)
        doc.backends["text"] = "python:python-pptx"
    elif kind == "xlsx":
        sheets = pd.read_excel(path, sheet_name=None, header=None)
        doc.tables = [{"page": name, "frame": df, "source": "xlsx"} for name, df in sheets.items() if not df.empty]
        doc.pages_text = [f"[sheet {name}]" for name in sheets]
        doc.backends["tables"] = "python:openpyxl"
    elif kind == "html":
        doc.pages_text, doc.tables = py.html_extract(path)
        doc.backends["text"] = "python:" + ("beautifulsoup4" if py.HAS["bs4"] else "html.parser")
    elif kind == "text":
        doc.pages_text = [path.read_text(encoding="utf-8", errors="replace")]
        doc.backends["text"] = "python:read"
    else:
        if py.HAS["tika"]:
            doc.pages_text, doc.backends["text"] = [py.tika_text(path)], "tika"
        elif py.HAS["textract"]:
            doc.pages_text, doc.backends["text"] = [py.textract_text(path)], "textract"
        else:
            doc.warnings.append(f"no back-end for '{path.suffix}' (install Apache Tika: pip install tika + Java)")

    doc.timings_s["total"] = round(time.perf_counter() - t0, 4)
    if not doc.page_method:
        doc.page_method = ["text-layer"] * len(doc.pages_text)
    return doc
