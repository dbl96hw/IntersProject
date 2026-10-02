# Contracts

The data engine is the only component that produces numbers. Everything downstream (Express, agent, MCP server, UI) consumes these shapes and may only cite them.

## Errors (team API contract)

```json
{"error": {"code": "VALIDATION_ERROR", "message": "new_colour: String should match pattern ...", "field": "new_colour"}}
```

| Situation | Status | `code` |
|---|---|---|
| Bad input | 400 | `VALIDATION_ERROR`, `SQL_ERROR` |
| Unknown id / tool | 404 | `NOT_FOUND`, `UNKNOWN_TOOL` |
| Server error | 500 | `INTERNAL_ERROR` (no stack trace in the response; logged on the server) |

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health`, `/system` | liveness; hardware profile + available back-ends |
| GET | `/candidates`, `/candidates/{id}`, `/candidates/{id}/lineage`, `/candidates/{id}/llm-context` | triage table, evidence card, lineage, compact LLM payload |
| GET | `/trials`, `/trials/{id}`, `/compare?ids=a,b`, `/scoring`, `/search?q=` | trials, comparison, counts, search |
| GET / POST | `/tools`, `/tools/{name}` | Claude tool definitions + system prompt; tool execution |
| GET | `/baseline`, `/quality`, `/consistency`, `/diagnostics`, `/ingestion`, `/patterns` | parity + root causes, data issues, run report, renormalization, ID combinatorics |
| POST | `/sql` `{"query", "limit"}` | read-only SQL (a single SELECT/WITH) over the canonical tables |
| POST | `/snapshot` | DuckDB + eigenbasis snapshot on disk |
| GET / POST | `/overrides`, `/overrides/reasons` | human overrides (audit log) |
| POST | `/ingest/records`, `/documents`, `/documents/base64`; GET `/documents` | new data |
| POST / GET | `/relevance`, `/relevance/model` | is a file about breeding? (gate); the gate's model card |

## Input 1: files

Tables: CSV/TSV (the delimiter is sniffed), XLSX (one table per sheet), JSON, Parquet. Documents: PDF (native or scanned), PNG/JPG/TIFF, DOCX, PPTX, HTML, TXT; any other format through Apache Tika when it is installed. Headers are normalised (trimmed, upper-cased, spaces → `_`). A table is routed by header signature (`config/sources.yaml`). If no source reaches a score of 0.6, the table is returned as `UNKNOWN` instead of being guessed.

## Input 2: records from the Claude extraction service

`POST /ingest/records`

```json
{
  "label": "lab-report-2026-09-30.pdf",
  "records": [
    {"MATERIAL_GUID": "1FC9E916-...", "GENOMIC_BREEDING_VALUE": 104.2, "QC_CALL_RATE_PCT": 97.1, "...": "..."}
  ]
}
```

Rules for the extraction service:

1. Use the **original column names** of the source the record belongs to (see `config/sources.yaml`), so detection is deterministic.
2. One call per logical table. Do not mix sources in one list.
3. Never invent values. Omit a field that could not be extracted; do not fill it with a guess.

Response when a source matches:

```json
{
  "accepted": true, "detection": {"source": "genomics", "score": 1.0, "...": "..."},
  "rows": 3, "rows_added": 1, "duplicates_ignored": 1, "conflicts": 1,
  "conflict_examples": [{"source": "genomics", "key": "1FC9E916-...", "table": "lab-report.pdf#genomics@2", "kind": "records",
                         "differences": {"GENOMIC_BREEDING_VALUE": {"export": 104.2, "uploaded": 140.0}}}],
  "message": "1 row(s) contradict the export and were not applied (the export wins; see GET /quality)",
  "build_seconds": 0.5
}
```

Posted records are **uploads**, never a new system of record. They are reconciled with the exports by the source's key (`MATERIAL_GUID`, `TRIAL_GUID`, `OPERATION_GUID`, `OBSERVATION_UUID`; whole-row match for `lab_observations`):

| Uploaded row | What happens | Counted in |
|---|---|---|
| key unknown | added once | `rows_added` |
| key known, same values | ignored, so re-uploading an export is idempotent | `duplicates_ignored` |
| key known, different values | **not applied**; the export wins and the difference is shown (`GET /quality` → `provenance.upload_conflicts_export`) | `conflicts`, `conflict_examples` (first 5) |

`{"accepted": false, "detection": {...}, "message": ...}` when no source matches (the file then needs classification by a human or the LLM).

Every ingest is a transaction. If the rebuild fails for any reason, the engine restores the previous state and answers `{"accepted": false, "message": "the engine could not integrate this upload (KeyError); nothing was changed ..."}` with status 200; it keeps serving the previous data and the next ingest works. Readable ids stay unique: an uploaded `trial` row whose `TRIAL_ID` already exists under another `TRIAL_GUID` (or a `germplasm` row with a known `MATERIAL_ID`) is a conflict, not a new record.

## Input 3: relevance gate (`POST /relevance`)

Call it before paying an LLM to extract records from a file. Send `text`, `columns`, or the file itself (`filename` + `content_base64`), or a mix.

```json
{
  "decision": "IRRELEVANT",          // RELEVANT | UNCERTAIN | IRRELEVANT
  "relevant": false, "needs_review": false, "probability": 0.0123,
  "reasons": ["breeding vocabulary: 0 distinct term(s) (none)", "closer to off-topic examples (similarity 0.09 vs 0.21)"],
  "signals": {"known_entities": [], "id_grammar_matches": [], "table_sources": [],
              "lexicon": {"weighted_hits": 0, "words": 32, "distinct_terms": 0, "top_terms": []},
              "similarity": {"in_domain": 0.09, "off_topic": 0.21, "nearest_in_domain": "...", "nearest_off_topic": "..."}},
  "model": {"version": "3f2a...", "probability": 0.0123, "thresholds": {"relevant_at": 0.7, "irrelevant_at": 0.3}},
  "file": {"filename": "invoice.pdf", "kind": "pdf", "pages": 1, "characters": 812, "ocr_pages": 0}
}
```

Order of decision: (1) an id or GUID the engine holds, or an id with its learned format → RELEVANT; (2) a table with a known source layout → RELEVANT; (3) otherwise the model (lexicon + few-shot n-gram contrast, logistic) → RELEVANT / UNCERTAIN / IRRELEVANT. UNCERTAIN means a person decides; it is never silently dropped. Examples, terms and thresholds live in `config/relevance.yaml`; `GET /relevance/model` returns the fitted weights and the nested leave-one-out result.

Besides the document summary, `POST /documents` and `/documents/base64` return `entities_mentioned` (candidate ids, trial ids and GUIDs found in the text, max 50) and `entities_in_tables` (key values of the tables accepted from the document, max 500). Express uses them to list the candidates a document touched.

The document endpoints run the same gate. An IRRELEVANT document returns `{"accepted": false, "relevance": {...}, "message": ...}` and is not indexed; `force: true` (JSON) or `?force=true` (multipart) indexes it anyway. An UNCERTAIN document is indexed with `needs_review: true`. Off-topic files found in the data directory at start-up are skipped and listed in `GET /ingestion` → `documents_rejected_as_irrelevant`.

## Output: candidate row (`GET /candidates`)

```json
{
  "candidate_id": "SYN-MZ-00001",
  "colour": "RED",               // effective colour (latest override wins)
  "engine_colour": "RED",        // what the rules decided
  "overridden": false,
  "override": null,
  "verdict": "FAIL",
  "reason": "fails in 3 of 5 trials",
  "mean_yield_t_ha": 10.65,      // mean over the candidate's trials (null if none has a yield)
  "n_trials": 5, "n_fail": 3,
  "ambiguous_trials": ["SYN-TR-0025"],
  "atypical": false,
  "rule_version": "UC4_MATERIAL_V0"
}
```

## Output: evidence item (inside `GET /candidates/{id}` → `evidence`, and every trial decision)

```json
{
  "rule": "disease",
  "source": "trial_recommendations",
  "field": "DISEASE_SCORE",
  "record": "SYN-TR-0001",
  "value": 7.7,
  "op": "<=",
  "threshold": 5.0,
  "passed": false,
  "statement": "disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5)"
}
```

The agent must quote `statement` or `value`, and must not compute anything new.

## Output: scoring (`GET /scoring`, tool `apply_scoring`)

```json
{"level": "candidate", "rule_version": "UC4_MATERIAL_V0", "total": 150,
 "counts": {"RED": 54, "AMBER": 71, "GREEN": 25},            // as the rules decided
 "effective_counts": {"RED": 53, "AMBER": 72, "GREEN": 25},  // after the latest override per candidate (the board)
 "overridden": 1, "note": "..."}
```

## Output: tool `query_candidates` (`POST /tools/query_candidates`)

The REST `GET /candidates` still returns the plain list. The tool wraps it so the model never mistakes a page for the total:

```json
{"total": 54, "returned": 20, "truncated": true, "limit": 20, "candidates": [ /* candidate rows, red first */ ]}
```

## Output: LLM context (`GET /candidates/{id}/llm-context`)

```json
{
  "payload": {
    "candidate_id": "...", "colour": "...", "verdict": "...", "reason": "...", "rule_version": "...",
    "evidence": ["..."], "trials": ["SYN-TR-0001 LOC-01 2024: FAIL"], "atypical": false,
    "similar": ["..."], "data_gaps": ["..."],
    "trial_counts": {"total": 5, "PASS": 2, "HOLD": 0, "FAIL": 3, "ambiguous": 1, "not_explained_by_data": 0},
    "instructions": "Cite only these values. Never compute new numbers. The breeder decides."
  },
  "tokens": {"payload": 261, "raw_rows": 5229, "reduction": 0.95}
}
```

## Override (`POST /overrides`)

```json
{"candidate_id": "SYN-MZ-00001", "new_colour": "AMBER", "reason_code": "FIELD_OBSERVATION",
 "comment": "good vigour in plot 12", "user": "breeder@syngenta"}
```

Reason codes: `GET /overrides/reasons`. An override never changes `engine_colour`. It is appended to the audit log with a timestamp, the user, the original colour and the rule version.
