# Context: Backend Development

## Area and confidence

- Area id: `backend-development`
- Confidence: HIGH

## Signals

- `apps/intersbackend/package.json`: Express 4, `@anthropic-ai/sdk`, `@supabase/supabase-js`, `multer`,
  `xlsx`, `mammoth`, `zod`; entry `src/index.js` → `createApp()` in `src/app.js`.
- `docs/api-contract.md` — frontend API; paths in `apps/intersbackend/src/constants/paths.js`.
- `services/data-engine/docs/CONTRACTS.md` — engine payloads (numbers and colours).
- `.cursor/rules/65-breeders-desk-backend.mdc` — product and architecture guardrails for this app.

## What lives here

Two back-end components with different languages and owners.

### Express API (`apps/intersbackend`)

- **Layout:** `src/app.js` wires routes, services, db and middleware. `src/config/env.js` validates
  environment variables with zod. `src/routes/` — chats, candidates, engine, health, root. `src/services/` —
  `dataEngineClient`, `analysis`, `chats`, `candidates`, `engine`, `ingest`, `fileStorage`, `responses`.
  `src/db/` — Supabase repositories plus in-memory store (chosen by `ANALYSIS_MODE`). Schema:
  `supabase/migrations/001_init.sql`. `src/middleware/` — cors, upload (multer), errorHandler, notFound.
  `src/constants/`, `src/mocks/`, `src/extractors/` (tables, docx, media for ingest). `src/llm/` —
  Claude client, tools, evidence check. `src/prompts/` — `explanation.v1.md`, `loadPrompt`,
  `getPromptVersions`.
- **Run:** `npm run dev:backend` from the repo root (http://localhost:3000, `node --watch`).
- **API surface:** Documented in `docs/api-contract.md` (`/api/chats`, `/api/candidates`,
  `/api/engine/*`, multipart messages, `GET /health` with `mode` and `engine` status). Not the old
  `/api/breeder/*` example router.

### Modes and environment

| Mode | Behaviour |
|---|---|
| `ANALYSIS_MODE=mock` (default) | In-memory db, canned analysis/answer samples, no Claude, Supabase or engine required. |
| `ANALYSIS_MODE=live` | Requires `DATA_ENGINE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Real engine, Claude and Postgres/Storage. |

Variable names (values only in `.env`, never committed): `PORT`, `CORS_ORIGIN`, `ANALYSIS_MODE`,
`DATA_ENGINE_URL`, `DATA_ENGINE_TIMEOUT_MS`, `DATA_ENGINE_INGEST_TIMEOUT_MS`, `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `MAX_FILE_MB`,
`MAX_FILES`, `BATCH_SIZE`, `MAX_PARALLEL_BATCHES`. See `apps/intersbackend/.env.example`.

### npm scripts (backend workspace)

| Script | Purpose |
|---|---|
| `test` | `node --test` — 110 tests; Anthropic SDK and engine mocked. |
| `lint` | ESLint. |
| `db:smoke` | Live Supabase round-trip (ids only in output). |
| `ingest:smoke` | Extract a CSV/XLSX and send records to the engine. |
| `claude:smoke` | Live: colour-mixed sample, `explainAll`, warnings and REJECTED section (no API key or payloads). Optional `SMOKE_BREEDER_TEXT`. |

### Architecture: who reads documents, who explains

- The **data engine** decides colours, produces evidence, and **reads uploaded documents** (PDF, scans,
  Office). Documents pass the engine's relevance gate (`POST /relevance`, a local check, not Claude)
  and then go to `POST /documents/base64`. Tables from spreadsheets go through `POST /ingest/records`.
- **Claude** does **not** extract tabular data from documents in the product path. It only writes
  justifications (`submit_justifications`) and (when wired) answers chat via the engine's tools. It
  never decides or changes a colour.
- Optional unused code: `extraction.v1.md`, `submit_records`, `extractRecords` in `src/llm/`.

### Claude layer (`src/llm/`)

- **`tools.js`:** Zod schemas generate JSON tool definitions; `submit_justifications` is used for analysis.
- **`claude.client.js`:** Forced tool calls, ephemeral system prompt cache, `LLM_MAX_TOKENS` and
  `LLM_TIMEOUT_MS` in `src/constants/llm.js`. One corrective retry on invalid tool output; one retry on
  429, 529 and 5xx. Errors: `CLAUDE_OUTPUT_INVALID`, `LLM_UNAVAILABLE` (502). Usage:
  `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd` from
  `src/constants/pricing.js` (`cost_usd` null for unknown models). Engine fallback when a batch fails
  (`EXPLANATION_FAILED`) or evidence check fails.
- **`evidence.check.js`:** Guards (order): `id`, `number`, `number_word`, `cited_value`, `colour`.
  Corpus: `reason`, `verdict`, `evidence`, `trials`, `similar`, `data_gaps`, `document_mentions`.
  Warnings: `JUSTIFICATION_UNVERIFIED`, `EXPLANATION_FAILED`, `CLAUDE_NOTE`. Internal `rejected` list
  for smoke/debug (not in API contract).
- **`prompts/`:** `explanation.v1.md`; `getPromptVersions({ ruleVersion, model })` →
  `{ explanation_prompt, rule_version, model }` for `messages.versions`.

### Live vs mock gaps (Step 9)

- Live upload is wired. A message with files ingests tables and documents, then `explainAll` (at most
  `EXPLAIN_MAX_SYNC` new explanations, RED then AMBER then GREEN). The summary counts engine colours.
  `usage` and `versions` are saved. Unchanged `evidence_hash` reuses a verified Claude justification.
- A live message with **no files** still returns `LLM_UNAVAILABLE`. That is Step 9B.
- Live `PATCH /api/candidates/:id` forwards a colour change to engine `POST /overrides` and stores a `candidate_reviews` row. Live `POST /api/candidates/:id/decision` stores pass / no pass and does not change colour. Mock mode still validates, then returns **501**.

### What the frontend expects

The workspace UI (`apps/intersfrontend`) is still on mocks. Target wiring is `docs/api-contract.md`.
Mock rows add `crop` and `mean_yield_t_ha`, which the engine row does not provide (roadmap F1.2, F1.4).

### Data engine (`services/data-engine`)

Unchanged ownership: FastAPI on port 8001, contracts in `services/data-engine/docs/CONTRACTS.md`.
`GET /candidates/{id}/llm-context` builds a compact payload without raw `TRIAL_RECOMMENDATION` columns
(trials are summarized strings).

## Conventions in force

- Express: thin routes, team error shape, constants in `src/constants/`, never log secrets or file
  contents: `.cursor/rules/60-express-api.mdc`, `70-api-contract.mdc`, `95-shared-constants.mdc`,
  `65-breeders-desk-backend.mdc`.
- Engine field names verbatim in API responses; backend only adds fields like `justification`,
  `justification_source`, `verified`.
- Lint: `apps/intersbackend/eslint.config.js`.

## Testing expectations

- `npm test -w apps/intersbackend` — `node:test`, mock Anthropic and engine, no network.
- Manual smokes (not in CI). Engine on port 8001 and `ANALYSIS_MODE=live` in `apps/intersbackend/.env`.
  Neither command prints the API key, the prompt, or the file contents.
  - `npm run ingest:smoke -w apps/intersbackend -- path/to/file.csv` prints accepted, source, rows and ids.
  - `npm run claude:smoke -w apps/intersbackend` runs `explainAll`. Optional: `SMOKE_BREEDER_TEXT`.
- Fixture `test/fixtures/lab-report.pdf` for manual document checks with the engine (not read by automated tests).
- Data engine: `pytest -q` in `services/data-engine` (see `context/quality-assurance.md`).

## Danger zones

- Weakening evidence guards (`evidence.check.js`) — they are the main defence against invented numbers.
- Claude `summary` and `CLAUDE_NOTE` strings are **not** evidence-verified.
- Forced `tool_choice` works on Haiku 4.5; upgrading to Sonnet 5.5+ may need a different tool policy.
- Keys (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) server-side only; rotate before demo.
- Mock mode db is in-memory — data is lost on restart.
- `services/data-engine/config/rules.yaml` — colour changes need evaluation re-run (engine owner).

## Unknowns

- Unknown: exact `EXPLAIN_MAX_SYNC` UX when some candidates get `EXPLANATION_DEFERRED`.
- Unknown: chat message shape for multi-turn agent history in 9B.
- Unknown: whether breeder corrections should feed rules (SME); engine corrections log not built (F1.4).
- Unknown: crop display name source (`CROP_GUID` only in data).
- Unknown: Python lint/format for `services/data-engine`.
