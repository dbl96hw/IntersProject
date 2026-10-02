"""REST API over the engine: consumed by the Express backend, the agent and the MCP server.

Run:  uvicorn data_engine.api:app --port 8001      (docs at http://localhost:8001/docs)

Every response is plain JSON produced by DataEngine; the API adds no logic, so
the same numbers reach the UI, the chat and the MCP tools. Errors follow the
team's API contract (.cursor/rules/70-api-contract.mdc):

    {"error": {"code": "VALIDATION_ERROR", "message": "...", "field": "..."}}
    400 bad input · 404 unknown id · 500 server error (no stack traces leaked)
"""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import logging
import re
import tempfile
from collections import OrderedDict
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import __version__, agent_tools
from .engine import DataEngine
from .system import probe

log = logging.getLogger("data_engine.api")
app = FastAPI(title="UC4 Data Engine", version=__version__,
              description="Deterministic-first triage of breeding candidates with cited evidence.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_engine: DataEngine | None = None


def engine() -> DataEngine:
    global _engine
    if _engine is None:
        _engine = DataEngine.from_directory()
    return _engine


# ------------------------------------------------------------------ error contract
def _error(status: int, code: str, message: str, field: str | None = None) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if field:
        body["field"] = field
    return JSONResponse(status_code=status, content={"error": body})


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None):
        self.status, self.code, self.message, self.field = status, code, message, field


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message, exc.field)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or None
    return _error(400, "VALIDATION_ERROR", first.get("msg", "invalid request"), field)


@app.exception_handler(HTTPException)
async def _http_error(_: Request, exc: HTTPException):
    return _error(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception):
    log.exception("unhandled error")  # full trace in the server log, never in the response
    return _error(500, "INTERNAL_ERROR", "unexpected server error")


def _not_found(exc: KeyError):
    raise ApiError(404, "NOT_FOUND", f"unknown id: {exc.args[0]}")


# ------------------------------------------------------------------ models
class OverrideIn(BaseModel):
    candidate_id: str | None = None
    trial_id: str | None = None
    new_colour: str = Field(pattern="^(GREEN|AMBER|RED)$")
    reason_code: str
    comment: str = ""
    user: str = "breeder"


class RecordsIn(BaseModel):
    label: str
    records: list[dict[str, Any]]


class DocumentIn(BaseModel):
    filename: str
    content_base64: str
    force: bool = False        # index even if the relevance gate says IRRELEVANT (human override)


class RelevanceIn(BaseModel):
    """Either plain text (what Express already extracted) or the file itself, or both."""
    text: str | None = None
    filename: str | None = None
    content_base64: str | None = None
    columns: list[str] | None = None      # header of a table, if the caller has one


class SqlIn(BaseModel):
    query: str
    limit: int = Field(500, ge=1, le=10_000)


# ------------------------------------------------------------------ health & system
@app.get("/health")
def health():
    e = engine()
    return {"healthy": True, "version": __version__, "candidates": len(e.candidate_decisions),
            "trials": len(e.trial_decisions), "calibration": e.calibration is not None,
            "documents": len(e.documents)}


@app.get("/system")
def system():
    from . import accel
    from .documents import available_backends
    return {"hardware": probe().as_dict(),
            "accelerators": {"cpp_knn": accel._cpp() is not None, "julia": accel.julia_enabled()},
            "document_backends": available_backends()}


# ------------------------------------------------------------------ breeder-facing (MCP tools)
@app.get("/candidates")
def candidates(colour: str | None = Query(None, pattern="^(GREEN|AMBER|RED|green|amber|red)$"),
               atypical: bool | None = None, min_trials: int | None = None, limit: int | None = None):
    return engine().query_candidates(colour=colour, atypical=atypical, min_trials=min_trials, limit=limit)


@app.get("/candidates/{candidate_id}")
def candidate(candidate_id: str):
    try:
        return engine().get_candidate_profile(candidate_id)
    except KeyError as exc:
        _not_found(exc)


@app.get("/candidates/{candidate_id}/lineage")
def lineage(candidate_id: str):
    try:
        return engine().get_lineage(candidate_id)
    except KeyError as exc:
        _not_found(exc)


@app.get("/candidates/{candidate_id}/llm-context")
def llm_context(candidate_id: str):
    try:
        return engine().llm_context(candidate_id)
    except KeyError as exc:
        _not_found(exc)


@app.get("/trials")
def trials():
    return engine().trials()


@app.get("/trials/{trial_id}")
def trial(trial_id: str):
    try:
        return engine().get_trial(trial_id)
    except KeyError as exc:
        _not_found(exc)


@app.get("/compare")
def compare(ids: str = Query(..., description="comma-separated candidate ids")):
    try:
        return engine().compare_candidates([i.strip() for i in ids.split(",") if i.strip()])
    except KeyError as exc:
        _not_found(exc)


@app.get("/scoring")
def scoring(level: str = Query("candidate", pattern="^(candidate|trial)$")):
    return engine().apply_scoring(level)


@app.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = 20):
    return engine().search(q, limit)


# ------------------------------------------------------------------ agent integration
@app.get("/tools")
def tools():
    """Claude tool definitions + the system prompt for answer formulation."""
    return {"tools": agent_tools.TOOLS, "system_prompt": agent_tools.SYSTEM_PROMPT}


@app.post("/tools/{name}")
def run_tool(name: str, arguments: dict[str, Any] = Body(default_factory=dict)):
    """Execute one tool; the body is the tool_use `input`. Returns the tool_result content."""
    if name not in {t["name"] for t in agent_tools.TOOLS}:
        raise ApiError(404, "UNKNOWN_TOOL", f"unknown tool '{name}'")
    return {"content": agent_tools.call_tool(engine(), name, arguments)}


# ------------------------------------------------------------------ transparency / verification
@app.get("/baseline")
def baseline():
    return engine().baseline()


@app.get("/quality")
def quality():
    return engine().quality_report()


@app.get("/consistency")
def consistency():
    return engine().consistency()


@app.get("/diagnostics")
def diagnostics():
    """Last build: per-stage time / CPU / memory, numerical checks, integrity, drift, topology."""
    return engine().diagnostics_report()


@app.get("/ingestion")
def ingestion():
    return engine().ingestion_report()


@app.get("/patterns")
def patterns():
    return engine().patterns_report()


@app.post("/sql")
def sql(body: SqlIn):
    try:
        return engine().sql(body.query, body.limit)
    except ValueError as exc:
        raise ApiError(400, "VALIDATION_ERROR", str(exc), "query")
    except Exception as exc:  # SQL errors are user errors, not server errors
        raise ApiError(400, "SQL_ERROR", str(exc).splitlines()[0], "query")


@app.post("/snapshot")
def snapshot():
    from .store import snapshot as take
    return take(engine())


# ------------------------------------------------------------------ overrides (human only)
@app.get("/overrides/reasons")
def override_reasons():
    return DataEngine.reason_codes()


@app.get("/overrides")
def overrides():
    return [o.__dict__ for o in engine().overrides.all()]


@app.post("/overrides", status_code=201)
def create_override(body: OverrideIn):
    if bool(body.candidate_id) == bool(body.trial_id):
        raise ApiError(400, "VALIDATION_ERROR", "give exactly one of candidate_id or trial_id", "candidate_id")
    try:
        return engine().record_override(candidate_id=body.candidate_id, trial_id=body.trial_id,
                                        new_colour=body.new_colour, reason_code=body.reason_code,
                                        comment=body.comment, user=body.user)
    except KeyError as exc:
        _not_found(exc)
    except ValueError as exc:
        raise ApiError(400, "VALIDATION_ERROR", str(exc), "reason_code")


# ------------------------------------------------------------------ ingestion of new data
@app.post("/ingest/records")
def ingest_records(body: RecordsIn = Body(...)):
    """Entry point for the upstream Claude extraction service (structured records)."""
    return engine().add_records(body.label, body.records)


# Extractions are cached by content hash: Express calls /relevance and then /documents/base64 with
# the same bytes, and OCR is the expensive step, so the second call must not repeat it.
_EXTRACTIONS: "OrderedDict[str, Any]" = OrderedDict()
_EXTRACTION_CACHE_SIZE = 8


def _safe_name(filename: str) -> str:
    """The real file name (facts and table labels cite it), stripped of any path or odd characters."""
    name = re.sub(r"[^\w.\-]+", "_", Path(filename or "upload.bin").name).strip("._")
    return name[:120] or "upload.bin"


def _extract_bytes(filename: str, data: bytes):
    from . import documents as docs
    key = hashlib.sha256(data).hexdigest() + ":" + _safe_name(filename)
    if key in _EXTRACTIONS:
        _EXTRACTIONS.move_to_end(key)
        return _EXTRACTIONS[key]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / _safe_name(filename)
        path.write_bytes(data)
        try:
            doc = docs.extract(path)
        except Exception as exc:  # a damaged or unsupported file is bad input, not a server error
            log.warning("could not read %s: %s", _safe_name(filename), exc)
            raise ApiError(400, "VALIDATION_ERROR",
                           f"could not read {_safe_name(filename)} ({type(exc).__name__})", "content_base64")
    doc.path = _safe_name(filename)
    _EXTRACTIONS[key] = doc
    while len(_EXTRACTIONS) > _EXTRACTION_CACHE_SIZE:
        _EXTRACTIONS.popitem(last=False)
    return doc


def _decode(content_base64: str) -> bytes:
    try:
        return base64.b64decode(content_base64, validate=True)
    except ValueError:
        raise ApiError(400, "VALIDATION_ERROR", "content_base64 is not valid base64", "content_base64")


def _ingest_bytes(filename: str, data: bytes, force: bool = False) -> dict:
    doc = _extract_bytes(filename, data)
    result = engine().add_document(doc.path, force=force, document=doc)
    result["path"] = filename
    return result


@app.post("/documents/base64")
def ingest_document_base64(body: DocumentIn):
    """Upload any document (PDF, scan, image, DOCX, PPTX, HTML...) as base64 JSON.

    Off-topic files are refused by the relevance gate (`accepted: false`, with reasons);
    `force: true` indexes them anyway.
    """
    return _ingest_bytes(body.filename, _decode(body.content_base64), body.force)


def _table_text(filename: str, data: bytes) -> tuple[str, list[list[str]]] | None:
    """For spreadsheets / CSV: headers (for the signature rule) and a text sample (for the model)."""
    from . import ingest
    if Path(filename).suffix.lower() not in ingest.SUPPORTED:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / _safe_name(filename)
        path.write_bytes(data)
        try:
            tables = ingest.read_file(path)
        except Exception as exc:   # unreadable spreadsheet: let the caller report it
            raise ApiError(400, "VALIDATION_ERROR", f"could not read the table: {exc}", "content_base64")
    text = "\n".join(t.frame.head(30).to_csv(index=False) for t in tables)
    return text, [list(t.frame.columns) for t in tables]


@app.post("/relevance")
def relevance(body: RelevanceIn):
    """Is this file about breeding / trials? RELEVANT, UNCERTAIN (a person decides) or IRRELEVANT.

    Cheap and deterministic: call it before paying an LLM to extract records from a file.
    """
    if not (body.text or body.content_base64 or body.columns):
        raise ApiError(400, "VALIDATION_ERROR", "send text, columns or content_base64", "text")
    text, tables, file_info = body.text or "", [body.columns] if body.columns else [], None
    if body.content_base64:
        filename = body.filename or "upload.bin"
        data = _decode(body.content_base64)
        as_table = _table_text(filename, data)
        if as_table is not None:
            extra, table_columns = as_table
            tables += table_columns
            file_info = {"filename": filename, "kind": "table", "tables": len(table_columns)}
        else:
            doc = _extract_bytes(filename, data)
            extra = doc.text
            from .documents.structure import normalise_table
            for t in doc.tables:
                frame = normalise_table(t["frame"])
                if frame is not None and not frame.empty:
                    tables.append(list(frame.columns))
            file_info = {"filename": filename, "kind": doc.kind, "pages": len(doc.pages_text),
                         "characters": len(extra), "ocr_pages": doc.page_method.count("ocr")}
        text = f"{text}\n{extra}" if text else extra
    return {**engine().assess_relevance(text, tables), "file": file_info}


@app.get("/relevance/model")
def relevance_model():
    """The gate's model card: examples, thresholds, fitted weights and nested leave-one-out accuracy."""
    from . import relevance as rel
    m = rel.model()
    return {"version": m.version, "examples": {"in_domain": int(m.labels.sum()),
                                               "off_topic": int((m.labels == 0).sum())},
            "thresholds": {"relevant_at": m.relevant_at, "irrelevant_at": m.irrelevant_at},
            "lexicon_terms": len(m.lexicon.weight), "leave_one_out": m.loo_report()}


@app.get("/documents")
def documents():
    return engine().documents_report()


if importlib.util.find_spec("multipart") is not None:  # python-multipart installed -> real file uploads
    from fastapi import File, UploadFile

    @app.post("/documents")
    async def ingest_document(file: UploadFile = File(...), force: bool = Query(False)):
        """Upload any document as multipart/form-data (field name: file); `?force=true` skips the gate."""
        return _ingest_bytes(file.filename or "upload.bin", await file.read(), force)
