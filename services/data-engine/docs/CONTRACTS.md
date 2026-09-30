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

Response: `{"accepted": true, "detection": {...}, "rows": n}`, or `{"accepted": false, "detection": {...}, "message": ...}` when no source matches (the file then needs classification by a human or the LLM).

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

## Output: LLM context (`GET /candidates/{id}/llm-context`)

```json
{
  "payload": {
    "candidate_id": "...", "colour": "...", "verdict": "...", "reason": "...", "rule_version": "...",
    "evidence": ["..."], "trials": ["SYN-TR-0001 LOC-01 2024: FAIL"], "atypical": false,
    "similar": ["..."], "data_gaps": ["..."],
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
