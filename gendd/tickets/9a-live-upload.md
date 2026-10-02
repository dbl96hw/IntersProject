---
id: 9a-live-upload
title: Live upload returns engine colours and justifications
status: ready-for-agent
blocked_by: []
trello:
---

## Problem

A breeder uploads tables or documents in a chat. In live mode the chat answers that analysis is not implemented, instead of showing each line's engine colour and a plain-language justification. The breeder still decides pass or no pass.

## Acceptance criteria

Each criterion names its test level. Engine and Claude are mocked. No network.

1. Given live mode and a CSV the engine accepts, when the breeder sends it, then the assistant message is `status: "ok"` and each candidate keeps the engine colour, with `ingestion.accepted` true for that file. Test level: integration.
2. Given a PDF (or other document), when the breeder sends it, then the backend calls the engine `POST /documents/base64` only. It does not call `extractRecords`, `submit_records`, or `claudeExtract`. Test level: integration.
3. Given a damaged spreadsheet and a valid CSV in the same message, when the breeder sends both, then the assistant message stays `status: "ok"`, the damaged file has a warning whose `file` is its name and an ingestion item with `accepted: false`, and the CSV still produces candidates. Test level: integration.
4. Given 31 candidates, when the analysis runs, then `explainAll` receives only 30, ordered RED then AMBER then GREEN (and by `candidate_id` inside a colour). The rest use the engine `reason` as `justification`, with `justification_source` `"engine"`, `verified` false and `confidence` null. The analysis has one warning `EXPLANATION_DEFERRED` with `file` null. Test level: unit.
5. Given a stored row with the same `candidate_id`, `rule_version` and `evidence_hash`, `justification_source` `"claude"` and `verified` true, when the llm-context payload is unchanged, then Claude is not called again for that id and the stored justification is saved on the new row. A reused row does not consume one of the 30 Claude slots. Test level: unit.
6. Given the engine is unreachable midway through ingest, when the call fails, then the assistant message is `status: "error"` with code `DATA_ENGINE_UNAVAILABLE`, no candidates are saved, and explaining does not start. A 400 from the engine about one file is not this case (see criterion 3). Test level: integration.
7. Given Claude fails a batch, when `explainAll` falls back, then that candidate's justification is the engine reason, `justification_source` is `"engine"`, and the warning code is `EXPLANATION_FAILED`. `src/llm/evidence.check.js` is not weakened. Test level: unit.
8. Given an analysis that explains candidates, when the assistant message is saved, then `usage` has `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` and `cost_usd`, and `versions` comes from `getPromptVersions` (`explanation_prompt`, `rule_version`, `model`). The summary text is built by the backend from engine colour counts. Claude's summary is not copied into `summary`. Test level: unit.
9. Given mock mode, when the breeder uploads a file, then the canned analysis from today is unchanged. Test level: integration (existing test).

The backend never recomputes colour, verdict or evidence. Engine field names are unchanged. The backend only adds `justification`, `justification_source` and `verified`.

## Edge cases

- Empty: a file the engine accepts with no rows yields `status: "ok"`, zero candidates, and a warning. Test level: integration.
- Maximum: more than 30 candidates is criterion 4. `EXPLAIN_MAX_SYNC` is 30.
- Unauthorised: there is no breeder login. The Supabase service role stays on the server. This case does not apply.
- Concurrent: two uploads in flight at once do not interleave engine calls. The `ingestFiles` queue runs one upload to completion before the next starts. Test level: integration.

## Integration points

- Data engine: `POST /ingest/records` (tables), `POST /documents/base64` (documents), `GET /candidates/{id}/llm-context`, and the existing read-only SQL used to resolve touched candidate ids.
- Claude: `createClaudeClient().explainAll` only. Model stays `claude-haiku-4-5-20251001` with forced `tool_choice`. `extraction.v1.md` is not on this path.
- Postgres columns already in `supabase/migrations/001_init.sql`. No `002` migration in any 9A pull request.
  - `messages.usage` — `jsonb`, nullable.
  - `messages.versions` — `jsonb`, nullable.
  - `candidates.evidence_hash` — `text`, nullable, indexed by `candidates_reuse_idx` on `(candidate_id, rule_version, evidence_hash)`.
- `evidence_hash` is a SHA-256 of canonical JSON (sorted keys) of the llm-context `payload`, excluding `instructions` and the `tokens` block. Reuse goes through `findReusableJustification`.

## Context pack

- `context/backend-development.md` — modes, Claude layer, live vs mock gaps, testing.
- `context/architecture.md` — invariants (the breeder decides; the engine owns numbers and colours). `gendd/architecture/components.md` does not exist yet; the pull request that closes 9A adds a short entry naming the Express gateway.
- `docs/api-contract.md` and `services/data-engine/docs/CONTRACTS.md`.

## Out of scope

- Step 9B (text-only chat). A live message with no files still returns `LLM_UNAVAILABLE`.
- Ticket 3 (colour edit and pass / no pass), even if those routes already respond 200 on this branch.
- Wiring `extractRecords`, `submit_records` or `extraction.v1.md`.
- Frontend changes, engine dedupe, changing the model, and edits to `evidence.check.js`.
- A new HTTP timeout or a background queue. See the decision below.
- File-hash dedupe of re-uploads. The engine does not dedupe `POST /ingest/records` and drops in-memory state on restart. Skipping ingest from a file hash would hide a restart. That risk stays with the engine owner.

## Decision

**Times.** `EXPLAIN_MAX_SYNC=30` is a constant in `src/constants/llm.js`, not an environment variable. With `BATCH_SIZE=15` and `MAX_PARALLEL_BATCHES=3`, thirty candidates are two batches in parallel. Each Claude call is bounded by `LLM_TIMEOUT_MS` (60 seconds) plus one retry, so the explanation phase fits in about two minutes, plus up to 120 seconds of `DATA_ENGINE_INGEST_TIMEOUT_MS` per ingest call. No HTTP timeout is added. Express does not set `server.timeout`, `requestTimeout` or `headersTimeout`. On this Node those defaults are `timeout` 0, `requestTimeout` 300000 (five minutes to receive the request, not to answer) and `headersTimeout` 60000 (headers only). The frontend has no `fetch` and no abort. Nothing on that path cuts a response of about three minutes once the body has arrived.

## Known risks

- If the engine dies halfway through an upload of several files, it can be left with partial data. The engine has no transaction, and the backend does not roll back rows the engine already accepted. The assistant message is still `status: "error"` with `DATA_ENGINE_UNAVAILABLE` and no candidates saved on our side.

## Step 10

Render's response-time limit is not set in this repo. On `stg`, prove it with an upload of more than 30 candidates before the demo depends on that host. Do not add a queue in 9A for this.

## Size

One story, because the upload, the explanation cap and the hash reuse describe one breeder action. The code is three pull requests, each one session: documents via the engine only; live `handleMessage`; hash reuse plus the contract, roadmap and context updates.

## Comments

- 2026-10-02T04:17Z: story written from the approved 9A plan. Decision on request time is the verified one (no new HTTP timeout). Render check deferred to Step 10 on `stg`.
