# Frontend integration notes

The backend endpoints in `docs/api-contract.md` are ready to call. This file is the list of frontend changes still to make. No frontend file has been edited for this.

Base URL: `import.meta.env.VITE_API_URL` or `http://localhost:3000` (`apps/intersfrontend/src/constants/api.js`, `API_BASE_URL`). Every path below except `GET /` and `GET /health` is under `/api`.

With `ANALYSIS_MODE=mock` (the backend default) these calls return canned data. They do not call Claude, Supabase, or the Python engine. Colours, decisions, chats and messages live in the backend process and disappear when it restarts.

`id` on a candidate is our row (a uuid). Use it in URLs and as the React `key`. `candidate_id` (`"SYN-MZ-90001"`) is the engine's id and can repeat across chats.

## Replace each mock with a call

| Frontend today | Call instead |
|---|---|
| `RECENT_DASHBOARDS` in `src/mocks/dashboards.js`, loaded in `src/pages/Workspace.jsx` | `GET /api/chats` |
| `createMockDashboard(fileNames)` after the welcome upload | `POST /api/chats`, then `POST /api/chats/:id/messages` with the real `File` objects |
| `getMockChatReply` in `src/mocks/chatReplies.js`, used by `src/components/ChatWidget.jsx` | `POST /api/chats/:id/messages` with text and no files. Show `assistant_message.answer.text` |
| `handleUpdateCandidate` in `Workspace.jsx` (only changes React state) | `PATCH /api/candidates/:id` |
| `OVERRIDE_REASONS` in `src/constants/triage.js` | `GET /api/engine/override-reasons` |
| No pass / no pass control | `POST /api/candidates/:id/decision` |

`MOCK_USER` and `CHAT_WELCOME_MESSAGE` stay in the frontend. There is no user endpoint. Send `MOCK_USER` (or its email stand-in, today the UI has no email) as the `user` field on PATCH and decision until login exists.

## JSON the frontend should read

Shapes below are from a real mock-mode run. Timestamps and uuids change on every call. There is no `crop` and no `mean_yield_t_ha`.

### `POST /api/chats`

Request (title optional):

```json
{ "title": "Maize 2024 trials" }
```

Response `201`:

```json
{
  "chat": {
    "id": "e0e73733-810d-4f73-9374-1dad0fa7e9cf",
    "title": "New chat",
    "created_at": "2026-10-01T21:57:20.226Z",
    "updated_at": "2026-10-01T21:57:20.226Z"
  }
}
```

`GET /api/chats` returns `{ "chats": [ /* same chat objects, newest first */ ] }`.

### `POST /api/chats/:id/messages`

`multipart/form-data`. Field `text` is optional. Field `files` repeats, once per file. A question with no files can send JSON `{ "text": "Which lines are red?" }` instead.

Response `201` when the message has files. `analysis.candidates` is the table. `answer` is `null`.

```json
{
  "user_message": {
    "id": "2e9aee45-432d-4e84-b2fc-dd7b003ac10c",
    "chat_id": "e0e73733-810d-4f73-9374-1dad0fa7e9cf",
    "role": "user",
    "text": "Analyse these trials",
    "files": [
      {
        "id": "d3c17525-7091-41e2-94fe-6dc8bf6b50cb",
        "name": "trials-2024.csv",
        "mime_type": "text/csv",
        "size_bytes": 44,
        "kind": "table"
      }
    ],
    "created_at": "2026-10-01T21:57:20.246Z"
  },
  "assistant_message": {
    "id": "d170a2c1-1ee6-429e-86fb-9e45a50cd7b2",
    "chat_id": "e0e73733-810d-4f73-9374-1dad0fa7e9cf",
    "role": "assistant",
    "kind": "analysis",
    "status": "ok",
    "error": null,
    "analysis": {
      "sample": true,
      "summary": "4 candidates analysed (sample data): 1 green, 2 amber, 1 red.",
      "warnings": [
        {
          "code": "SAMPLE_DATA",
          "message": "Mock mode: these candidates are invented sample data, not results from your files.",
          "file": null
        }
      ],
      "ingestion": [
        {
          "file": "trials-2024.csv",
          "kind": "table",
          "accepted": true,
          "source": "SAMPLE",
          "rows": null,
          "message": "Mock mode: file not sent to the engine"
        }
      ],
      "candidates": [ /* Candidate objects, see below */ ],
      "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0, "duration_ms": 0 },
      "versions": {
        "explanation_prompt": "explain_v1",
        "extraction_prompt": "extract_v1",
        "rule_version": "UC4_MATERIAL_V0",
        "model": "mock"
      }
    },
    "answer": null,
    "created_at": "2026-10-01T21:57:20.251Z"
  }
}
```

If the chat title is still `"New chat"` and files were sent, the backend renames the chat to the file names. Read the new title from `GET /api/chats/:id`.

A question with no files returns `kind: "answer"`, `analysis: null`, and:

```json
{
  "answer": {
    "text": "Sample answer (mock mode, invented data): 1 line is red. SYN-MZ-90003 fails in 3 of 5 trials; disease risk is elevated (DISEASE_SCORE = 7.7, threshold <= 5). You decide; you can change any colour.",
    "tool_calls": [{ "name": "query_candidates", "input": { "colour": "RED" } }],
    "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cost_usd": 0, "duration_ms": 0 }
  }
}
```

Check `status`. A failed analysis is still `201`, with `status: "error"`, `error: { "code", "message" }`, and both `analysis` and `answer` set to `null`. Retry with `POST /api/chats/:id/messages/:messageId/retry` (`:messageId` is that assistant message). No body. Response `201`: `{ "assistant_message": { /* same assistant shape */ } }`.

`GET /api/chats/:id` returns `{ "chat": { /* Chat */ }, "messages": [ /* user and assistant messages, oldest first */ ] }`.

### Candidate

This is one row of the table. The same object is inside `analysis.candidates`, `GET /api/candidates`, PATCH, and decision.

```json
{
  "candidate_id": "SYN-MZ-90001",
  "colour": "GREEN",
  "engine_colour": "GREEN",
  "overridden": false,
  "override": null,
  "verdict": "PASS",
  "reason": "passes 4 of 4 trials",
  "n_trials": 4,
  "n_fail": 0,
  "ambiguous_trials": [],
  "atypical": false,
  "rule_version": "UC4_MATERIAL_V0",
  "data_gaps": [],
  "id": "774f8f19-526d-49fb-8dbb-1610f10abd2c",
  "chat_id": "e0e73733-810d-4f73-9374-1dad0fa7e9cf",
  "message_id": "d170a2c1-1ee6-429e-86fb-9e45a50cd7b2",
  "justification_source": "claude",
  "verified": true,
  "confidence": "high",
  "created_at": "2026-10-01T21:57:20.251Z",
  "decision": "pending",
  "edited": false,
  "justification": "Passes 4 of 4 trials; disease score 3.1 is within the threshold of 5."
}
```

`reason` is the engine's one-line reason. `justification` is the plain-language text. The table column labeled Justification currently reads `candidate.reason`; switch it to `justification`.

`colour` is `GREEN`, `AMBER`, or `RED`. `decision` is `pending`, `pass`, or `no_pass`. Show an unverified badge when `verified` is `false`, and an edited badge when `edited` is `true`. When `overridden` is `true`, show `engine_colour` next to `colour`. `override` is then the object in the PATCH response below, otherwise `null`.

### `GET /api/candidates`

Query: `colour` (`GREEN` | `AMBER` | `RED`), `decision` (`pending` | `pass` | `no_pass`), `q` (matches `candidate_id` and `reason`), `chat_id`, `page` (default 1), `page_size` (default 20, max 100).

```json
{ "candidates": [ /* Candidate objects */ ], "page": 1, "page_size": 20, "total": 4 }
```

For one chat's table, pass `chat_id`. Newest rows come first.

### `GET /api/candidates/:id`

`:id` is the uuid, not `candidate_id`.

```json
{
  "candidate": { /* Candidate object */ },
  "engine_detail": { /* engine sample for that candidate_id */ }
}
```

`engine_detail` is the entry in `apps/intersbackend/src/mocks/engine.sample.json` for that `candidate_id` (evidence, trials, genomics, lab, data_gaps, and the rest). After a colour change, `engine_detail.colour` is the new colour, `engine_detail.engine_colour` stays the original, and `engine_detail.overridden` is `true`. `candidate.colour` matches `engine_detail.colour`.

### `PATCH /api/candidates/:id`

Send at least one of `new_colour` or `justification`. `reason_code` is required even when only the justification changes. `comment` is required and may be `""`, except it must be non-empty when `reason_code` is `OTHER`. `user` is required.

```json
{
  "new_colour": "AMBER",
  "reason_code": "FIELD_OBSERVATION",
  "comment": "good vigour in plot 12",
  "user": "breeder@syngenta"
}
```

Response `200`. `colour` changes. `engine_colour` does not. `override` is `null` when the body had no `new_colour`.

```json
{
  "candidate": {
    "candidate_id": "SYN-MZ-90001",
    "colour": "AMBER",
    "engine_colour": "GREEN",
    "overridden": true,
    "override": {
      "id": "6437041e-0e76-4ff3-9d34-2e659558de39",
      "timestamp_utc": "2026-10-01T21:57:20.283Z",
      "user": "breeder@syngenta",
      "level": "candidate",
      "record": "SYN-MZ-90001",
      "engine_colour": "GREEN",
      "new_colour": "AMBER",
      "reason_code": "FIELD_OBSERVATION",
      "comment": "good vigour in plot 12",
      "rule_version": "UC4_MATERIAL_V0"
    },
    "decision": "pending",
    "edited": false,
    "justification": "Passes 4 of 4 trials; disease score 3.1 is within the threshold of 5."
  },
  "override": { "id": "6437041e-0e76-4ff3-9d34-2e659558de39", "new_colour": "AMBER", "engine_colour": "GREEN" }
}
```

The `candidate` object above is trimmed; the real body has every Candidate field. `override` at the top level is the full override object, the same one nested in `candidate.override`.

A justification-only body sets `edited: true`, replaces `justification`, and returns `"override": null`. `colour` stays as it was.

### `POST /api/candidates/:id/decision`

```json
{
  "decision": "no_pass",
  "reason_code": "MARKET_FIT",
  "comment": "maturity too late",
  "user": "breeder@syngenta"
}
```

`decision` is `pass` or `no_pass`. `reason_code` and `comment` are optional. Response `200`: `{ "candidate": { /* Candidate, decision is now no_pass, colour unchanged */ } }`.

### Engine passthrough

`GET /api/engine/override-reasons` returns a map, not the `{ code, label }[]` array in `triage.js`:

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

`GET /api/engine/baseline` and `GET /api/engine/quality` return the sample bodies in `apps/intersbackend/src/mocks/baseline.sample.json` and `quality.sample.json`.

### Errors

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "reason_code is required", "field": "reason_code" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body or query. `field` names the input (`new_colour`, `comment`, `decision`, `user`, `reason_code`, `text`, ...) |
| 400 | `UNSUPPORTED_FILE_TYPE` | Extension not in the list below. `field` is `"files"` |
| 404 | `NOT_FOUND` | Unknown chat, message, or candidate, including a non-uuid id |
| 413 | `FILE_TOO_LARGE` | File over `MAX_FILE_MB` (10 by default) |
| 502 | `DATA_ENGINE_UNAVAILABLE` | Live mode only, when the engine does not answer |

## Corrections by file

### `apps/intersfrontend/src/pages/Workspace.jsx`

A sidebar item is a chat (`id`, `title` from `GET /api/chats`), not a dashboard from `RECENT_DASHBOARDS`. Candidates for the open chat come from the latest assistant message with `kind: "analysis"`, or from `GET /api/candidates?chat_id=`. Show loading and error in the page, not only in the console. `handleUpdateCandidate` must call PATCH and replace the row with `candidate` from the response.

### `apps/intersfrontend/src/components/WelcomeView.jsx`

`onSubmitFiles` currently receives names only (`fileNames`). Pass the `File` objects. Append them as `files` on a `FormData`. `ACCEPTED_FILE_TYPES` in `src/constants/triage.js` allows `.tsv`, `.json`, `.parquet`, `.tiff`, `.pptx`, `.html`, and `.txt`. The backend rejects those with `400 UNSUPPORTED_FILE_TYPE`. Allowed extensions: `.csv .xlsx .xls .pdf .docx .png .jpg .jpeg .webp`.

### `apps/intersfrontend/src/components/DashboardView.jsx` and `TriageSection.jsx`

`TABLE_COLUMNS` has `crop` and `mean_yield_t_ha`. Neither field exists on a Candidate, in the backend or in the engine. Remove those columns and stop searching `candidate.crop` in `matchesSearch`. The trials cell can stay: it is `n_fail` and `n_trials`. Use `candidate.id` as the row key and for expand and edit, not `candidate.candidate_id`. The file summary (`dashboard.fileNames`) comes from `user_message.files[].name`. Show `justification`, plus badges for `verified === false` and `edited === true`.

### `apps/intersfrontend/src/components/EditCandidateModal.jsx`

Remove crop and mean yield. The initial text is `candidate.justification`, not `candidate.reason`. Do not write `crop`, `mean_yield_t_ha`, or `reason` back. POST body:

```json
{ "new_colour": "AMBER", "justification": "...", "reason_code": "FIELD_OBSERVATION", "comment": "", "user": "Syngenta" }
```

Omit `new_colour` when the colour did not change, and omit `justification` when the text did not change. One of the two must be present. `reason_code` is required in both cases. `comment` is always sent and must be non-empty for `OTHER`. Load reason labels from `GET /api/engine/override-reasons` (object of code to text), not from `OVERRIDE_REASONS`.

### `apps/intersfrontend/src/components/ChatWidget.jsx`

Pass the open chat's `id`. On send, call `POST /api/chats/:id/messages` and append `user_message` and `assistant_message`. The bot text is `assistant_message.answer.text`. If `status` is `"error"`, show `error.message` and a retry that calls `POST /api/chats/:id/messages/:messageId/retry`. Keep `CHAT_WELCOME_MESSAGE` local. Replace the message list when the user opens another chat (`GET /api/chats/:id`).

### Decision control

There is no pass / no pass control yet. Add one that calls `POST /api/candidates/:id/decision` and then shows `candidate.decision` (`pending`, `pass`, or `no_pass`). This does not change `colour`.

## Ask the engine owner

If the table still needs crop or mean yield, those values have to come from the data engine. The backend will not invent them, and they are not on the candidate contract today.
