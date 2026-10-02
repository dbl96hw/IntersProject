# Breeder's Desk API contract

The frontend builds against this document. The backend (`apps/intersbackend`) implements it. Every path below is defined in `apps/intersbackend/src/constants/paths.js`.

The engine's own contract is [`services/data-engine/docs/CONTRACTS.md`](../services/data-engine/docs/CONTRACTS.md). Where this document shows an engine field, that file is the source of truth.

## Who decides what

| Who | Decides / does |
|---|---|
| **Data engine** | Decides the colour (`GREEN` / `AMBER` / `RED`), the verdict and the evidence, by applying `config/rules.yaml` to the 7 Syngenta sources. It reads uploaded documents (PDF, scans, Office). It also stores every colour override and its audit log. |
| **Claude** | Explains each candidate in plain language, citing only the engine's evidence (`submit_justifications`). It answers chat questions through the engine's tools (`GET /tools`, `POST /tools/:name`, max 6 rounds). It never decides or changes a colour and does not extract tabular data from documents (the data engine ingests documents). |
| **Breeder** | Validates, edits and decides **pass / no pass**. Can change a colour; that change is sent to the engine as an override. |

UI copy must never say the system "approved" or "rejected" a line. The system suggests; the breeder decides.

## Conventions

- **Base URL:** `VITE_API_URL` (default `http://localhost:3000`). Every endpoint below is under `/api`.
- `GET /` and `GET /health` stay at the root. `GET /health` returns `{ "healthy": true, "mode": "mock" | "live", "engine": "up" | "down" | "skipped" }` and always answers 200.
- Requests and responses are JSON, except `POST /api/chats/:id/messages`, which is `multipart/form-data`.
- Timestamps are ISO 8601 in UTC (`"2026-10-01T13:44:00Z"`).
- `id`, `chat_id` and `message_id` are our UUIDs. `candidate_id` (`"SYN-MZ-00001"`) is the engine's id.
- In examples, `"...": "..."` and `/* ... */` mark parts trimmed for length; values are illustrative.

### One vocabulary: engine fields are never renamed

- Every field the engine defines keeps its **exact name and value**: snake_case, colours upper case (`"GREEN" | "AMBER" | "RED"`), verdicts upper case (`"PASS" | "HOLD" | "FAIL"`), `candidate_id`, `engine_colour`, `verdict`, `reason`, `rule_version`, the `evidence[]` items and `data_gaps`.
- The backend only **adds** fields. It never renames, converts or recomputes engine fields.
- If the engine's shape changes, only the backend's engine client and this document change.

## Errors

Every error has the same shape. `field` is `null` when the error is not about one input.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "reason_code is required", "field": "reason_code" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad input (missing field, wrong value, invalid JSON, too many files) |
| 400 | `UNSUPPORTED_FILE_TYPE` | A file is not `.csv .xlsx .xls .pdf .docx .png .jpg .jpeg .webp` (`field` is `"files"`) |
| 404 | `NOT_FOUND` | Unknown or malformed (non-uuid) chat, message or candidate id, or unknown route |
| 413 | `FILE_TOO_LARGE` | A file is over `MAX_FILE_MB` (10 MB by default), or the JSON body is over 25 MB |
| 501 | `NOT_IMPLEMENTED` | The endpoint validates its input but is not built yet (`PATCH /api/candidates/:id`, `POST /api/candidates/:id/decision`) |
| 502 | `DATA_ENGINE_UNAVAILABLE` | The data engine did not answer (down or timed out) |
| 500 | `INTERNAL_ERROR` | Anything else (no stack trace in the response) |

Engine errors (for example `NOT_FOUND`, `SQL_ERROR`, `UNKNOWN_TOOL`, or `VALIDATION_ERROR` on an override) are passed through with the engine's status, `code`, `message` and `field`.

## Shared objects

### Chat

```json
{
  "id": "4b0c6a52-8f0e-4c7e-9d1a-0b6f1d2a9e11",
  "title": "Maize 2024 trials",
  "created_at": "2026-10-01T13:40:00Z",
  "updated_at": "2026-10-01T13:44:00Z"
}
```

### File ref

```json
{
  "id": "a1f2c3d4-0000-4000-8000-000000000001",
  "name": "lab-report-2026-09-30.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 482113,
  "kind": "document"
}
```

`kind` is `"table"` (CSV, TSV, XLSX, JSON) or `"document"` (PDF, Word, images and the rest).

### Candidate

The engine's candidate row, **verbatim**, plus our fields.

```json
{
  "candidate_id": "SYN-MZ-00001",
  "colour": "RED",
  "engine_colour": "RED",
  "overridden": false,
  "override": null,
  "verdict": "FAIL",
  "reason": "fails in 3 of 5 trials",
  "n_trials": 5,
  "n_fail": 3,
  "ambiguous_trials": ["SYN-TR-0025"],
  "atypical": false,
  "rule_version": "UC4_MATERIAL_V0",

  "id": "9e8d7c6b-1111-4222-8333-444455556666",
  "chat_id": "4b0c6a52-8f0e-4c7e-9d1a-0b6f1d2a9e11",
  "message_id": "c3d2e1f0-2222-4333-8444-555566667777",
  "justification": "Fails in 3 of 5 trials; disease risk elevated (DISEASE_SCORE = 7.7, threshold <= 5).",
  "justification_source": "claude",
  "verified": true,
  "confidence": "high",
  "decision": "pending",
  "edited": false,
  "created_at": "2026-10-01T13:44:00Z"
}
```

**Engine fields** (from `GET /candidates` on the engine):

| Field | Meaning |
|---|---|
| `colour` | Effective colour. The engine already applies the latest override. |
| `engine_colour` | What the rules decided. An override never changes it. |
| `overridden`, `override` | Whether an override applies. `override` is `null` or the engine's audit entry: `{ id, timestamp_utc, user, level, record, engine_colour, new_colour, reason_code, comment, rule_version }`. |
| `verdict`, `reason` | `PASS` / `HOLD` / `FAIL`, and the engine's one-line reason |
| `n_trials`, `n_fail`, `ambiguous_trials`, `atypical`, `rule_version` | As in the engine contract |

**Our fields:**

| Field | Values | Meaning |
|---|---|---|
| `id` | uuid | Our row. One row per candidate per analysis, so the same `candidate_id` can appear in several chats. |
| `chat_id`, `message_id` | uuid | The analysis this row belongs to |
| `justification` | string | Plain-language explanation |
| `justification_source` | `"claude"` \| `"engine"` | `"engine"` means Claude's text was not used and `justification` is the engine's `reason` |
| `verified` | boolean | `true` when every number in the justification exists in the engine's evidence for this candidate |
| `confidence` | `"high"` \| `"medium"` \| `"low"` \| `null` | How sure the explanation is. `null` when `justification_source` is `"engine"`. |
| `decision` | `"pending"` \| `"pass"` \| `"no_pass"` | The breeder's decision. Starts as `"pending"`. |
| `edited` | boolean | `true` once the breeder edited the justification. `justification_source` and `verified` keep describing the original generated text. |
| `created_at` | timestamp | When the row was created |

Show `engine_colour` next to `colour` when `overridden` is `true`. Show an "unverified" badge when `verified` is `false`.

### Ingestion item

One per uploaded file (or per table inside a file). `accepted`, `rows` and `message` come from the engine's `POST /ingest/records` response. `source` is the engine's `detection.source`. When the engine does not return `rows` or `message`, the field is `null` (never guessed).

```json
{ "file": "trials-2024.xlsx", "kind": "table", "accepted": true, "source": "trial_recommendations", "rows": 72, "message": null }
```

```json
{ "file": "notes.pdf", "kind": "document", "accepted": false, "source": "UNKNOWN", "rows": null,
  "message": "no known source matches these fields: needs classification by a human or the LLM" }
```

### Usage

Totals for every Claude call made for this message. All zeros in mock mode.

```json
{ "input_tokens": 5120, "output_tokens": 830, "cache_read_tokens": 4096, "cache_write_tokens": 100, "cost_usd": 0.0284 }
```

`cost_usd` is `null` when the model id is not listed in `apps/intersbackend/src/constants/pricing.js`. All token fields are zero in mock mode.

### Versions

```json
{ "explanation_prompt": "explanation.v1", "rule_version": "UC4_MATERIAL_V0", "model": "claude-..." }
```

`rule_version` comes from the engine. `model` is `"mock"` in mock mode.

### Warning

```json
{ "code": "JUSTIFICATION_UNVERIFIED", "message": "1 justification cited a number not found in the evidence; the engine's reason is shown instead.", "file": null }
```

`file` is the file name when the warning is about one file, otherwise `null`.

### Tool call

One per engine tool Claude used to answer a question. `name` is the engine's tool name (`query_candidates`, `get_candidate_context`, ...).

```json
{ "name": "query_candidates", "input": { "colour": "RED" } }
```

### Messages

User message:

```json
{
  "id": "b7a6f5e4-3333-4444-8555-666677778888",
  "chat_id": "4b0c6a52-8f0e-4c7e-9d1a-0b6f1d2a9e11",
  "role": "user",
  "text": "Analyse these trials",
  "files": [{ "id": "a1f2c3d4-0000-4000-8000-000000000001", "name": "trials-2024.xlsx", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size_bytes": 20311, "kind": "table" }],
  "created_at": "2026-10-01T13:43:55Z"
}
```

Assistant message:

| Field | Values |
|---|---|
| `role` | `"assistant"` |
| `kind` | `"analysis"` (the user sent files) or `"answer"` (question only) |
| `status` | `"ok"` or `"error"` |
| `error` | `null`, or `{ "code", "message" }` when `status` is `"error"`. Codes: `DATA_ENGINE_UNAVAILABLE`, `LLM_UNAVAILABLE`, `EXTRACTION_FAILED`. |
| `analysis` | Set when `kind` is `"analysis"` and `status` is `"ok"`, otherwise `null` |
| `answer` | Set when `kind` is `"answer"` and `status` is `"ok"`, otherwise `null` |

`analysis`:

```json
{
  "summary": "12 candidates analysed: 3 green, 5 amber, 4 red.",
  "candidates": [ /* Candidate objects */ ],
  "warnings": [ /* Warning objects */ ],
  "ingestion": [ /* Ingestion items */ ],
  "usage": { /* Usage */ },
  "versions": { /* Versions */ }
}
```

`answer`:

```json
{
  "text": "4 lines are red. SYN-MZ-00001: fails in 3 of 5 trials ... You decide; you can change any colour.",
  "tool_calls": [{ "name": "query_candidates", "input": { "colour": "RED" } }],
  "usage": { /* Usage */ }
}
```

## Endpoints

### Chats

#### `POST /api/chats`

Creates a chat. `title` is optional (default `"New chat"`).

```json
{ "title": "Maize 2024 trials" }
```

**201**

```json
{ "chat": { "id": "4b0c6a52-...", "title": "Maize 2024 trials", "created_at": "2026-10-01T13:40:00Z", "updated_at": "2026-10-01T13:40:00Z" } }
```

Errors: 400 `VALIDATION_ERROR` (`title` is not a string).

#### `GET /api/chats`

Newest first (by `updated_at`).

**200**

```json
{ "chats": [ { "id": "4b0c6a52-...", "title": "Maize 2024 trials", "created_at": "...", "updated_at": "..." } ] }
```

#### `GET /api/chats/:id`

The chat with every message in order (oldest first). User messages include their `files`. Analysis messages include their `analysis.candidates`. Message shapes are the same as in `POST /api/chats/:id/messages`.

**200**

```json
{
  "chat": { "id": "4b0c6a52-...", "title": "Maize 2024 trials", "created_at": "...", "updated_at": "..." },
  "messages": [
    { "id": "b7a6f5e4-...", "role": "user", "text": "Analyse these trials", "files": [ /* File refs */ ], "...": "..." },
    { "id": "c3d2e1f0-...", "role": "assistant", "kind": "analysis", "status": "ok", "error": null,
      "analysis": { "summary": "...", "candidates": [ /* Candidates */ ], "...": "..." }, "answer": null, "...": "..." }
  ]
}
```

Errors: 404 `NOT_FOUND`.

### Messages

#### `POST /api/chats/:id/messages`

`multipart/form-data`:

| Field | Required | Notes |
|---|---|---|
| `text` | Yes if no files are sent | The question or a note about the files |
| `files` | No | Repeat the field once per file (`formData.append('files', file)`). Up to `MAX_FILES` (10) files of `MAX_FILE_MB` (10 MB) each. Allowed: `.csv .xlsx .xls .pdf .docx .png .jpg .jpeg .webp`. UTF-8 file names (e.g. `análisis.csv`) are kept as sent. |

With files, the backend runs an **analysis**: tables are sent to the engine, documents are extracted by Claude and sent to the engine, then each candidate is explained. Without files, it runs an **answer**: Claude answers through the engine's tools (max 6 rounds).

> **Always check `assistant_message.status` before rendering.** The HTTP status is **201 even when the analysis failed**, so that the user message is saved and the frontend gets a `messageId` it can retry. When `status` is `"error"`, show `assistant_message.error.message` and a retry button; `analysis` and `answer` are both `null`.

**201** (analysis)

```json
{
  "user_message": { "id": "b7a6f5e4-...", "chat_id": "4b0c6a52-...", "role": "user", "text": "Analyse these trials", "files": [ /* File refs */ ], "created_at": "..." },
  "assistant_message": {
    "id": "c3d2e1f0-...",
    "chat_id": "4b0c6a52-...",
    "role": "assistant",
    "kind": "analysis",
    "status": "ok",
    "error": null,
    "analysis": {
      "summary": "12 candidates analysed: 3 green, 5 amber, 4 red.",
      "candidates": [ /* Candidate objects */ ],
      "warnings": [],
      "ingestion": [{ "file": "trials-2024.xlsx", "kind": "table", "accepted": true, "source": "trial_recommendations", "rows": 72, "message": null }],
      "usage": { "input_tokens": 5120, "output_tokens": 830, "cache_read_tokens": 4096, "cache_write_tokens": 100, "cost_usd": 0.0284 },
      "versions": { "explanation_prompt": "explanation.v1", "rule_version": "UC4_MATERIAL_V0", "model": "claude-..." }
    },
    "answer": null,
    "created_at": "..."
  }
}
```

**201** (answer)

```json
{
  "user_message": { "id": "...", "role": "user", "text": "Which lines are red?", "files": [], "...": "..." },
  "assistant_message": {
    "id": "...", "role": "assistant", "kind": "answer", "status": "ok", "error": null, "analysis": null,
    "answer": { "text": "4 lines are red. ...", "tool_calls": [{ "name": "query_candidates", "input": { "colour": "RED" } }],
                "usage": { "input_tokens": 2100, "output_tokens": 240, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": 0.0099 } },
    "...": "..."
  }
}
```

**201** (analysis failed)

```json
{
  "user_message": { "id": "...", "...": "..." },
  "assistant_message": { "id": "c3d2e1f0-...", "role": "assistant", "kind": "analysis", "status": "error",
    "error": { "code": "DATA_ENGINE_UNAVAILABLE", "message": "Data engine is unreachable" },
    "analysis": null, "answer": null, "...": "..." }
}
```

If the chat still has the default title and files were sent, its title becomes the file names (joined by `, `, max 80 characters).

Errors (no message is saved): 400 `VALIDATION_ERROR` (no text and no files, too many files), 400 `UNSUPPORTED_FILE_TYPE`, 404 `NOT_FOUND` (chat), 413 `FILE_TOO_LARGE`.

#### `POST /api/chats/:id/messages/:messageId/retry`

Reruns a failed assistant message using the same user text and files. `:messageId` is the assistant message with `status: "error"`. A new assistant message is created; the failed one stays in the history. No body.

**201**

```json
{ "assistant_message": { "id": "d4e3f2a1-...", "role": "assistant", "kind": "analysis", "status": "ok", "error": null, "analysis": { "...": "..." }, "answer": null, "...": "..." } }
```

Check `status` here too: a retry can fail again.

Errors: 400 `VALIDATION_ERROR` (the message is not an assistant message with `status: "error"`), 404 `NOT_FOUND`.

### Candidates

#### `GET /api/candidates`

Dashboard list of our candidate rows, newest first.

| Query | Values |
|---|---|
| `colour` | `GREEN` \| `AMBER` \| `RED` (upper case; matches the effective `colour`) |
| `decision` | `pending` \| `pass` \| `no_pass` |
| `q` | Case-insensitive text match on `candidate_id` and `reason` |
| `chat_id` | uuid |
| `page` | Integer, default `1` |
| `page_size` | Integer, default `20`, max `100` |

`GET /api/candidates?colour=RED&decision=pending&page=1&page_size=20`

**200**

```json
{ "candidates": [ /* Candidate objects */ ], "page": 1, "page_size": 20, "total": 4 }
```

Errors: 400 `VALIDATION_ERROR` (with `field` set to the bad query parameter).

#### `GET /api/candidates/:id`

`:id` is our row's `id` (uuid), not the `candidate_id`. Returns the candidate and the engine's `GET /candidates/{candidate_id}` detail **unchanged**. The candidate's engine fields are refreshed from that detail, so `candidate.colour` and `engine_detail.colour` agree.

**200**

```json
{
  "candidate": { /* Candidate object */ },
  "engine_detail": {
    "candidate_id": "SYN-MZ-00001", "colour": "RED", "engine_colour": "RED", "overridden": false, "override": null,
    "verdict": "FAIL", "reason": "fails in 3 of 5 trials", "n_trials": 5, "n_fail": 3,
    "ambiguous_trials": ["SYN-TR-0025"], "atypical": false, "rule_version": "UC4_MATERIAL_V0",
    "evidence": [
      { "rule": "disease", "source": "trial_recommendations", "field": "DISEASE_SCORE", "record": "SYN-TR-0001",
        "value": 7.7, "op": "<=", "threshold": 5.0, "passed": false,
        "statement": "disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5)" }
    ],
    "trials": [
      { "trial_id": "SYN-TR-0001", "location": "LOC-01", "year": 2024, "official_verdict": "FAIL", "engine_verdict": "FAIL",
        "explained_by_data": true, "reason": "...", "ambiguous": false, "p_fail": 0.82 }
    ],
    "genomics": { "source": "genomics", "...": "..." },
    "lab": { "source": "lab_observations", "...": "..." },
    "atypicality": { "...": "..." },
    "similar_candidates": [{ "candidate_id": "SYN-MZ-00042", "distance": 0.31, "colour": "RED" }],
    "lineage": { "...": "..." },
    "document_evidence": [ { "source": "lab-report.pdf", "page": 2, "sentence": "...", "ids": { "...": "..." } } ],
    "data_gaps": ["pedigree: FEMALE_PARENT_MATERIAL_GUID is empty in every record -> lineage cannot be reconstructed"]
  }
}
```

For the candidate card, show `evidence[].statement`, `trials[]` (with `explained_by_data` and `ambiguous`), `document_evidence[]` and `data_gaps`.

Errors: 404 `NOT_FOUND`, 502 `DATA_ENGINE_UNAVAILABLE`.

#### `PATCH /api/candidates/:id`

The breeder changes the colour, the justification, or both.

| Field | Required | Notes |
|---|---|---|
| `new_colour` | One of `new_colour` / `justification` | `GREEN` \| `AMBER` \| `RED` |
| `justification` | One of `new_colour` / `justification` | New text. Sets `edited: true`. |
| `reason_code` | Yes | One of `GET /api/engine/override-reasons` |
| `comment` | Yes (may be `""`) | Must not be empty when `reason_code` is `OTHER` |
| `user` | Yes | Who made the change |

```json
{ "new_colour": "AMBER", "reason_code": "FIELD_OBSERVATION", "comment": "good vigour in plot 12", "user": "breeder@syngenta" }
```

A colour change is **forwarded to the engine's `POST /overrides`** with `{ candidate_id, new_colour, reason_code, comment, user }`. The backend never changes a colour by itself. The engine stays the single place where colours and their audit log live. `engine_colour` never changes.

**200**

```json
{
  "candidate": { "candidate_id": "SYN-MZ-00001", "colour": "AMBER", "engine_colour": "RED", "overridden": true,
                 "override": { "id": "...", "timestamp_utc": "...", "user": "breeder@syngenta", "level": "candidate",
                               "record": "SYN-MZ-00001", "engine_colour": "RED", "new_colour": "AMBER",
                               "reason_code": "FIELD_OBSERVATION", "comment": "good vigour in plot 12", "rule_version": "UC4_MATERIAL_V0" },
                 "...": "..." },
  "override": { "id": "...", "timestamp_utc": "...", "user": "breeder@syngenta", "level": "candidate", "record": "SYN-MZ-00001",
                "engine_colour": "RED", "new_colour": "AMBER", "reason_code": "FIELD_OBSERVATION",
                "comment": "good vigour in plot 12", "rule_version": "UC4_MATERIAL_V0" }
}
```

`override` is the engine's `POST /overrides` response unchanged, or `null` when only the justification changed.

Errors: 400 `VALIDATION_ERROR` (including the engine's own override validation), 404 `NOT_FOUND`, 502 `DATA_ENGINE_UNAVAILABLE`.

#### `POST /api/candidates/:id/decision`

The breeder decides pass / no pass. Stored on our side only; it never changes the colour.

| Field | Required | Notes |
|---|---|---|
| `decision` | Yes | `"pass"` \| `"no_pass"` |
| `reason_code` | No | If given, one of `GET /api/engine/override-reasons` |
| `comment` | No | Free text |
| `user` | Yes | Who decided |

```json
{ "decision": "no_pass", "reason_code": "MARKET_FIT", "comment": "maturity too late for this market", "user": "breeder@syngenta" }
```

**200**

```json
{ "candidate": { "candidate_id": "SYN-MZ-00001", "colour": "RED", "decision": "no_pass", "...": "..." } }
```

Errors: 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`.

### Engine passthrough (trust panel)

These return the engine's body **unchanged**. See the engine contract for the full shapes.

#### `GET /api/engine/override-reasons`

**200**

```json
{
  "FIELD_OBSERVATION": "Breeder saw something in the field the data does not capture",
  "DATA_ERROR": "The underlying data is wrong or incomplete",
  "MARKET_FIT": "Commercial / market considerations",
  "PEDIGREE_KNOWLEDGE": "Knowledge of the line's pedigree or crosses",
  "ENVIRONMENT_CONTEXT": "Unusual season, location or disease pressure",
  "STRATEGIC_KEEP": "Kept for a breeding-programme reason (e.g. donor of a trait)",
  "OTHER": "Other (explain in the comment)"
}
```

#### `GET /api/engine/baseline`

Parity with the official logic and the root causes of mismatches.

**200** (trimmed)

```json
{
  "rule_version": "UC4_MATERIAL_V0",
  "mode": "gate",
  "parity": { "agree": 72, "total": 72, "accuracy": 1.0 },
  "confusion_official_vs_engine": { "PASS": { "PASS": "...", "HOLD": "...", "FAIL": "..." }, "HOLD": { "...": "..." }, "FAIL": { "...": "..." } },
  "not_explained": [],
  "mismatch_root_causes": [],
  "calibration": { "...": "..." }
}
```

#### `GET /api/engine/quality`

Every known data issue and the corrections applied or proposed.

**200** (trimmed)

```json
{ "summary": { "...": "..." }, "issues": [ { "...": "..." } ], "corrections": [ { "...": "..." } ], "what_if_recomputed_aggregates": { "...": "..." } }
```

Errors for all three: 502 `DATA_ENGINE_UNAVAILABLE`.

## Mock mode

With `ANALYSIS_MODE=mock` (the default), every endpoint returns the same shapes with canned data. No Claude, Supabase or engine is called. `usage` is all zeros, `versions.model` is `"mock"`, and `GET /health` reports `engine: "skipped"`.

- A message with files returns 4 invented candidates (`SYN-MZ-90001` to `SYN-MZ-90004`: green, amber, red, and amber with a data gap). The analysis has `"sample": true` and a `SAMPLE_DATA` warning, so the UI can label it as sample data. Each `ingestion` item names the real uploaded file with `source: "SAMPLE"` and `rows: null`.
- A question-only message returns a canned answer.
- `GET /api/candidates/:id` returns a canned `engine_detail` for those 4 ids.
- Chats, messages and candidates are kept in memory and are lost when the server restarts.
