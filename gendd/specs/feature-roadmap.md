# Feature roadmap (UC4 Breeder's Desk)

Phased, priority-ordered list of the features that cover the hackathon use case
(`gendd/specs/uc4-use-case.md`), from what is already implemented to "demo ready". Scope ends at demo
readiness: conversational channels (WhatsApp, voice), authentication hardening, deployment beyond `stg`
and Cropwise packaging are out of this roadmap.

Last synced with the working tree on 2026-10-02. This is the workspace that ships: upload, triage, override, pass / no pass, and chat. Anything not built is an improvement below, not leftover work for this commit.
Branch `fix/demo-readiness` (2026-10-02): engine backlog fixes, documents that name candidates now classify
them, upload from the welcome screen, bold rendering in the chat, CI for all tests, root README runbook.
Merged on `dev` so far for the backend gateway and Claude layer: PR #9 (API contract and paths), PR #10
and #11 (`feature/backend-core`: Supabase schema, mock/live routes, ingest service, data engine client),
PR #12 (Claude client, evidence check, live `claude:smoke`), PR #13 (Step 8 explanation prompt). PR #7
added the mock workspace UI. Step 9A (live upload) is implemented on `feature/9a-live-upload`. PR #8 does
not appear in `dev`'s merge history.

## Improvements

Not part of this commit. The phase sections below keep the longer specification. Open checklist items there are the same list.

### Left panel

- Edit the name of a chat. The sidebar shows `chat.title`, which the backend sets from the uploaded file names. There is no control to change it. `POST /api/chats` accepts an optional `title` on create; there is no route to rename an existing chat.
- Delete a chat from the left panel. There is no delete route. Deleting should take that chat off the list, and return to the welcome screen when it was the one open.

### Workspace

- Backend / engine status indicator. `GET /health` still reports `mode` and `engine`, and `getHealth()` is on the frontend client. `Workspace` does not call it.
- Ingestion result per file, and the analysis warnings (`IRRELEVANT_FILE`, `UPLOAD_CONFLICTS`, `EXPLANATION_DEFERRED`). `IngestionList.jsx` is unused. `Workspace` still stores `analysis.ingestion` and `analysis.warnings`.
- On an overridden row, show `engine_colour` beside the effective colour, and an Overridden badge. The row shows `candidate.reason` and, when present, `override.reason_code` and `override.comment`.
- `ambiguous_trials` and `atypical` on the row. The candidate payload can still carry them.

### Later

Evidence card (F1.3), crop and yield corrections (F1.4), structured colour and evidence in the chat bubble (F2.1), an end-to-end demo test and promotion to `stg` (F3.1), trust panel, engine search, comparison, and disagreements (Phase 4), persisting engine state across restarts, and a Docker image with Tesseract and Poppler.

## How to read and use this file

- A feature is a user-visible or system capability that one agent session can deliver and verify end
  to end.
- Setup, installs, tests, lint and pull requests are never standalone features. They are checklist
  items inside the feature that needs them.
- Each feature has 5 to 9 checklist items. More than that means the feature must be split; fewer than
  5 means it should be merged into a neighbour.
- Work the phases in order, and the features inside a phase in priority order. A feature starts only
  when everything in its "Depends on" line is done.
- Before starting a feature, turn it into a story that passes `gendd/definition-of-ready.md` and save
  it in `gendd/tickets/` (then copy it to Trello). The checklist below is the scope, not the acceptance
  criteria.
- When a pull request completes checklist items, tick them and update the feature's Status in the same
  pull request.
- Every feature must respect the use case's non-negotiables: the breeder makes the final call, every
  colour shows its reason, and the product is an assistant, not a replacement
  (`context/architecture.md`, "Architectural invariants").
- "In progress" with ticked items means part of the feature exists. Open checklist items are
  improvements (see Improvements). They are not part of this commit.

## Feature template

```markdown
### F<phase>.<n> <Feature name>
- Status: not started | in progress | done
- Priority: <n> of <total> in Phase <phase>
- Depends on: <feature ids or "none">
- Goal: <one or two sentences, from the breeder's or the team's perspective>
- Evidence / pointers: <files and doc sections>
- Checklist:
  - [ ] <item>
- Done when: <one line tied to the use case>
```

## Phases

```mermaid
flowchart LR
  P0["Phase 0: Foundations (done)"] --> P1["Phase 1: Demo critical path"]
  P1 --> P2["Phase 2: Natural-language assistant"]
  P2 --> P3["Phase 3: Demo readiness gate"]
  P3 --> P4["Phase 4: Trust and data enrichment"]
```

| Phase | Features | Status |
|---|---|---|
| 0. Foundations | F0.1 - F0.5 | done |
| 1. Demo critical path | F1.1 - F1.5 | in progress (Express gateway in mock + partial live; UI on mocks; F1.4 deferred after the freeze) |
| 2. Natural-language assistant | F2.1 | in progress (widget posts the live answer; known issues below) |
| 3. Demo readiness gate | F3.1 | not started |
| 4. Trust and data enrichment | F4.1 - F4.4 | in progress (F4.2 has mock upload UI) |

Phase 3 comes before Phase 4 on purpose: the demo must be stable before extras are added. After each
Phase 4 feature, re-run the F3.1 checklist.

---

## Phase 0 - Foundations (implemented)

### F0.1 Monorepo scaffold and team conventions
- Status: done
- Priority: 1 of 5 in Phase 0
- Depends on: none
- Goal: The team can install, run and lint the frontend and backend from one repo, following shared
  rules, and agents can load the project context.
- Evidence / pointers: `package.json`, `apps/*/package.json`, `apps/*/eslint.config.js`,
  `.github/workflows/lint.yml`, `.cursor/rules/`, `apps/intersbackend/src/index.js`, `context/`,
  `agents/`, `gendd/`.
- Checklist:
  - [x] npm workspaces for `apps/intersfrontend` (React 18 + Vite) and `apps/intersbackend` (Express)
  - [x] Root scripts `dev:frontend`, `dev:backend`, `lint`
  - [x] ESLint flat config per app; lint runs on every pull request to `dev`, `stg`, `main`
  - [x] Team rules in `.cursor/rules/` (style, naming, React, Express, API contract, testability, constants)
  - [x] Constants folders in both apps (`src/constants/`)
  - [x] Backend `GET /health` returning `{ healthy: true }` (the UI health indicator was removed in PR #7 and comes back in F1.1)
  - [x] GenDD configuration, Context Pack and role playbooks
- Done when: a new teammate can run both apps and pass lint using only `README.md`. (Met.)

### F0.2 Data ingestion and unification
- Status: done
- Priority: 2 of 5 in Phase 0
- Depends on: none
- Goal: All UC4 mock sources, plus documents, end up in one canonical model with known data problems
  reported instead of hidden.
- Evidence / pointers: `services/data-engine/src/data_engine/ingest.py`, `documents/`, `detect.py`,
  `profile.py`, `canonical.py`, `quality.py`, `config/sources.yaml`, `data/synthetic/uc4/`.
- Checklist:
  - [x] Read CSV / TSV / XLSX / JSON / Parquet tables
  - [x] Read documents (native and scanned PDF, images, DOCX, PPTX, HTML), text layer first and OCR only when needed
  - [x] Route each table to a source by header signature; unknown shapes returned as `UNKNOWN`
  - [x] Entropy-based renormalization that only drops zero-information columns
  - [x] Canonical star-schema model keyed by material and trial
  - [x] Data-quality issues with root cause, fix status and provenance; source files never modified
  - [x] Schema-drift detection against the 2026-09-28 archive drop
- Done when: the four mock sources are unified and every data issue is listed with its cause. (Met.)

### F0.3 Deterministic red / amber / green triage with evidence
- Status: done
- Priority: 3 of 5 in Phase 0
- Depends on: F0.2
- Goal: Every candidate gets a colour and a one-line reason backed by cited evidence, decided by
  readable rules rather than by a model.
- Evidence / pointers: `services/data-engine/config/rules.yaml`, `src/data_engine/rules.py`,
  `spectral.py`, `calibrate.py`, `evaluate.py`, `services/data-engine/docs/FINDINGS.md`,
  `services/data-engine/README.md` ("Results", "Honest limits").
- Checklist:
  - [x] Versioned rules and thresholds in `config/rules.yaml` (`SYNTH_V1_RECON_2026-09-30`, `UC4_MATERIAL_V0`)
  - [x] Trial verdicts with 72/72 parity against the official logic
  - [x] Candidate colour, reason and evidence items (`rule`, `field`, `value`, `threshold`, `statement`)
  - [x] Root-cause analysis for mismatches and "ambiguous" / "not explained" flags
  - [x] Spectral layer for atypical and similar candidates
  - [x] Calibrated ambiguity model, ROC versus baselines and Bayes ceiling
  - [x] Reproducible evaluation report (`python -m data_engine.evaluate`)
- Done when: each of the 150 candidates has a colour and a stated reason. (Met: 54 red, 71 amber, 25 green.)

### F0.4 Engine service interfaces and override audit log
- Status: done
- Priority: 4 of 5 in Phase 0
- Depends on: F0.3
- Goal: Other components (Express, Claude, MCP clients) can consume the engine without touching its
  internals, and breeder overrides are recorded.
- Evidence / pointers: `services/data-engine/src/data_engine/api.py`, `agent_tools.py`,
  `mcp_server.py`, `audit.py`, `telemetry.py`, `diagnostics.py`, `services/data-engine/tests/`,
  `services/data-engine/clients/node/`, `services/data-engine/docs/CONTRACTS.md`, `INTEGRATION.md`.
- Checklist:
  - [x] FastAPI REST API with the team error contract (`{"error": {"code", "message", "field"}}`)
  - [x] 9 Claude tool definitions and a system prompt served by `GET /tools`, executed by `POST /tools/{name}`
  - [x] MCP server (stdio) exposing the same tools
  - [x] Append-only override log; `engine_colour` never changed; no override tool for the agent
  - [x] Telemetry and diagnostics per run saved as JSON
  - [x] pytest suite (unit and API-level tests)
  - [x] Node client and Express route / agent-loop examples ready to copy into `apps/intersbackend`
- Done when: the engine can be called over REST and MCP, and an override is logged without changing
  the engine's colour. (Met.)

### F0.5 Breeder workspace UI prototype (mock data)
- Status: done
- Priority: 5 of 5 in Phase 0
- Depends on: F0.1
- Goal: The team can click through the whole breeder experience (upload, triage, override, chat)
  before the backend is wired, using mock data shaped like the engine's candidate row.
- Evidence / pointers: PR #7 (`ced1454`); `apps/intersfrontend/src/pages/Workspace.jsx`;
  `src/components/` (`Sidebar`, `WelcomeView`, `DashboardView`, `DashboardFilters`, `TriageSection`,
  `RowContextMenu`, `EditCandidateModal`, `ChatWidget`, `Logo`, `LeafDecoration`, `PlantDecoration`);
  `src/constants/triage.js`, `messages.js`; `src/mocks/dashboards.js`;
  `src/styles/theme.css`.
- Checklist:
  - [x] Workspace shell: sidebar with "New dashboard", recent dashboards and user badge
  - [x] Welcome screen with drag-and-drop / browse upload, accepted file types and file chips (no file leaves the browser)
  - [x] Dashboard with one table per colour (Strong candidate / Needs review / Concerns: suggestions, never "approved" or "rejected"), counts and empty states
  - [x] Client-side search (id, crop, justification) and status filter chips with live counts
  - [x] Expandable rows, right-click context menu and an edit modal with status change, override reason and comment
  - [x] Floating chat widget (open, minimize, close, history, typing indicator) with mock replies
  - [x] Theme, decorations and `data-testid`s on every interactive element and status message
- Done when: the full demo flow can be clicked through on mock data. (Met; wiring happens in Phases 1, 2 and 4.)

---

## Phase 1 - Demo critical path

### F1.1 Express to data engine integration
- Status: done for this commit. The workspace status indicator is an improvement.
- Priority: 1 of 5 in Phase 1
- Depends on: F0.4
- Goal: The frontend can reach all breeder data through the Express backend, with the engine's errors
  and numbers passed through unchanged.
- Evidence / pointers: `docs/api-contract.md`, `apps/intersbackend/src/app.js`,
  `apps/intersbackend/src/services/dataEngineClient.js`, `apps/intersbackend/src/constants/paths.js`,
  `context/backend-development.md`, `agents/backend-dev.md`.
- Checklist:
  - [x] Data engine client and path constants in `apps/intersbackend` (from `clients/node/`, adapted)
  - [x] Gateway routes under `/api` per `docs/api-contract.md`: chats, messages (multipart upload),
    candidates (list + detail with `engine_detail`), engine passthrough (`override-reasons`, `baseline`,
    `quality`); `express.json({ limit: '25mb' })`
  - [x] `DATA_ENGINE_URL` and related timeouts in `apps/intersbackend/.env.example`
  - [x] `GET /health` reports `{ healthy, mode, engine: up|down|skipped }`
  - [x] Engine errors forwarded in the team shape; 502 `DATA_ENGINE_UNAVAILABLE` when the engine is down
  - [x] Frontend API helper (base URL from `src/constants/api.js`, path constants, `res.ok` check).
    `getHealth()` stays on `src/api/client.js`. The workspace status indicator is an improvement
  - [x] Record backend test choice in `gendd/adr/` (`node:test`, see `0002-backend-tests-use-node-test.md`)
  - [x] `npm run lint` passes
- Done when: the UI calls `GET /api/candidates` on port 3000 (mock or live). Showing whether the backend
  and engine are reachable is an improvement.

### F1.2 Connect the triage dashboard to the engine
- Status: done for this commit. Row flags are an improvement.
- Priority: 2 of 5 in Phase 1
- Depends on: F1.1
- Goal: The breeder opens a dashboard and sees the engine's real candidates with colour and a one-line
  reason, instead of mock rows.
- Evidence / pointers: `apps/intersfrontend/src/components/DashboardView.jsx`, `TriageSection.jsx`,
  `DashboardFilters.jsx`, `src/pages/Workspace.jsx`, `src/mocks/dashboards.js`,
  `docs/api-contract.md` (`GET /api/candidates`), `services/data-engine/docs/CONTRACTS.md` ("Output:
  candidate row").
- Checklist:
  - [x] Colour-grouped tables, search, status chips, counts and empty states (F0.5)
  - [x] Replace `RECENT_DASHBOARDS` / `createMockDashboard` with `GET /api/chats` (every chat; the sidebar scrolls) and `GET /api/candidates?chat_id=`, with visible loading and error states. `RECENT_DASHBOARD_LIMIT` was removed
  - [x] Align columns with the contract. Crop and mean yield are not on the Express candidate, so those columns are dropped. Columns are candidate id, trials failed/total, justification, and decision (Pending, Pass, or No pass). `mean_yield_t_ha` stays on the engine until Express exposes it
  - [ ] Show the `ambiguous_trials` and `atypical` flags on each row (improvement; the candidate payload can still carry them)
  - [x] Section order is green, then amber, then red (`TRIAGE_STATUS_ORDER`)
  - [x] Recent dashboards are chats. Create dashboard stays the welcome screen until file upload
  - [x] Frontend tests use Vitest (`gendd/adr/0001-frontend-tests-use-vitest.md`), including loading, empty, error and populated states
- Done when: the breeder sees the engine's 150 candidates grouped by colour with their reasons, and can
  filter to the red ones.

### F1.3 Candidate evidence card
- Status: not started
- Priority: 3 of 5 in Phase 1
- Depends on: F1.2
- Goal: Opening a candidate shows why it got its colour, with evidence the breeder can check and
  challenge.
- Evidence / pointers: expanded row in `apps/intersfrontend/src/components/TriageSection.jsx` (today it
  only un-truncates the row), `docs/api-contract.md` (`GET /api/candidates/:id` returns `engine_detail`),
  `services/data-engine/docs/CONTRACTS.md` ("Output: evidence item").
- Checklist:
  - [ ] Expanding a row (or opening a side panel from it) fetches `GET /api/candidates/:id`
  - [ ] Header with colour, one-line reason, verdict and rule version
  - [ ] Evidence list using `evidence[].statement` exactly as returned (no recomputed numbers)
  - [ ] Trials list with `explained_by_data` and `ambiguous` flags, and data gaps (`data_gaps`) shown as such
  - [ ] Lineage from the same response, including "why parents are unavailable" (no extra route needed)
  - [ ] Loading, not-found and error states with `data-testid`s
  - [ ] Tests asserting that a colour is never rendered without its reason
- Done when: for a flagged candidate, the breeder can read a one-line explanation and the evidence behind it.

### F1.4 Breeder data corrections (engine and Express)
- Status: deferred (out of scope after the code freeze of 2026-10-01; overrides with a reason and comment cover the demo)
- Priority: 4 of 5 in Phase 1
- Depends on: F1.1
- Goal: When the breeder knows a value is wrong (crop, mean yield, justification text), they can correct
  it; the correction is recorded with who, when and why, and the original data is never overwritten.
- Evidence / pointers: product decision of 2026-09-30 (`context/product-management.md`), edit fields in
  `apps/intersfrontend/src/components/EditCandidateModal.jsx`, override log pattern in
  `services/data-engine/src/data_engine/audit.py`, `api.py`, `services/data-engine/docs/CONTRACTS.md`.
- Checklist:
  - [ ] Append-only corrections log in the engine (same pattern as `audit.py`): id, timestamp, user, candidate, field (`crop`, `mean_yield_t_ha`, `reason`), original value, corrected value, comment
  - [ ] Validation: only the allowed fields; mean yield numeric and non-negative; non-empty text
  - [ ] `POST /corrections` and `GET /corrections` in `api.py`, with the team error contract
  - [ ] Candidate row and profile expose the corrected value, the original value and a `corrected` flag; `engine_colour` is not changed by a correction
  - [ ] Agent tools and the LLM context label corrected values as breeder corrections, not engine values
  - [ ] `CONTRACTS.md` documents the new endpoints and fields; Express exposes corrections when designed (not mounted yet)
  - [ ] pytest tests: correction logged, original preserved, invalid field rejected, colour unchanged
- Done when: a breeder correction to a candidate's mean yield is logged and shown next to the original
  value, and the engine's source data is unchanged.

### F1.5 Override and correction flow
- Status: done for this commit (modal saves a colour change and a pass / no pass). Open items are improvements.
- Priority: 5 of 5 in Phase 1
- Depends on: F1.3, F1.4
- Goal: The breeder can disagree with a colour or correct a value, say why, and see that the decision
  was recorded without the engine's recommendation being erased.
- Evidence / pointers: `apps/intersfrontend/src/components/EditCandidateModal.jsx`, `RowContextMenu.jsx`,
  `TriageSection.jsx` (justification and decision columns), `src/constants/api.js` (`API_PATHS.OVERRIDE_REASONS`),
  `services/data-engine/src/data_engine/audit.py`, `CONTRACTS.md` ("Override").
- Checklist:
  - [x] Edit modal from the row context menu with status change, reason required when the status changes, and comment (F0.5). Override reasons are radios. Decision is a select on the same Save
  - [x] Load reasons from `GET /api/engine/override-reasons` (`listOverrideReasons` in `EditCandidateModal`)
  - [x] Comment required when the reason is `OTHER` (the label switches to required, and Save is blocked without a comment)
  - [x] Save sends a colour change via `PATCH /api/candidates/:id` (forwards to engine `POST /overrides`) and records reviews in Supabase. Pass / no pass is `POST /api/candidates/:id/decision` from the same Save. Pending is not sent
  - [ ] Field edits per F1.4 when available
  - [ ] Table and card show `engine_colour` next to `colour` when overridden, an Overridden badge, and original next to corrected values (improvement). The row shows `candidate.reason` and, when present, `override.reason_code` and `override.comment`, plus the Decision column
  - [ ] Real breeder name instead of `MOCK_USER`; override and correction history visible per candidate
  - [ ] Tests: override accepted, `OTHER` without comment rejected, engine colour unchanged, correction shown beside the original
- Done when: the use case's demo-ready definition is met - a flagged candidate with a one-line
  explanation that the breeder challenges and overrides, and the override is logged.

---

## Phase 2 - Natural-language assistant

### F2.1 Breeder assistant chat
- Status: in progress (widget posts `{ text }` to the live answer; known issues below)
- Priority: 1 of 1 in Phase 2
- Depends on: F1.1 (F1.3 recommended, so answers can link to the evidence card)
- Goal: The breeder asks questions in their own language ("which lines should I look at first?") and
  gets answers that cite the engine's values and remind them that they decide.
- Evidence / pointers: `apps/intersfrontend/src/components/ChatWidget.jsx`,
  `apps/intersbackend/src/llm/`, `apps/intersbackend/src/prompts/explanation.v1.md`,
  `services/data-engine/docs/INTEGRATION.md` section 3, `services/data-engine/src/data_engine/agent_tools.py`
  (`SYSTEM_PROMPT`), `docs/api-contract.md` (messages on chats).
- Checklist:
  - [x] Chat widget with open / minimize / close, conversation history, typing state and `data-testid`s (F0.5)
  - [x] `@anthropic-ai/sdk` in `apps/intersbackend`; `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in `.env.example` (no values)
  - [x] Claude client, tool schemas, evidence check and explanation prompt (`submit_justifications` only; documents ingested by the engine)
  - [x] Wire chat agent (`agent.service.ask`) through engine tools on `POST /api/chats/:id/messages` (text-only path); cap rounds with `MAX_TOOL_ROUNDS` and the question with `CHAT_QUESTION_DEADLINE_MS`
  - [x] Replace `getMockChatReply` with the live answer path. The widget posts `{ text }` only; the backend reads saved messages and does not trust a history from the browser
  - [ ] Answers render the colour, the one-line reason and the cited evidence as their own fields, plus the "you decide" reminder from the system prompt
  - [x] Bold marks (`**x**`, `*x*`) render as bold; lists, line breaks and any HTML stay plain text (`src/chatText.jsx`, no innerHTML)
  - [x] Answers in English whatever the question's language (engine system prompt, `agent_tools.py`)
  - [x] Clear message in the widget when the API key is missing, the engine is unreachable, the question times out, or the network fails, instead of a crash
  - [x] No override or colour-changing path through the chat (overrides stay in F1.5)
  - [x] Tests for the route with a mocked Claude client and a mocked engine, and for the widget with a fake `fetch`
- Known issues:
  - Fixed on `fix/demo-readiness`: `query_candidates` (tool) returns `total`, `returned` and `truncated`, and its description names the default limit of 20. Before, a live answer said "20 red lines" when the count was 54.
  - Fixed on `fix/demo-readiness`: `apply_scoring` returns `counts` (rule colour), `effective_counts` (after overrides, what the board shows) and `overridden`; the prompt tells the model to report the effective counts. Before, the chat said 54 / 71 / 25 while the board showed 53 / 72 / 25.
  - `ANSWER_UNVERIFIED_NUMBERS` is a partial net. It fired on 3 of 4 answers in the first live chat, several times for a correct count written as a word (`dos`). Digits 1, 3, 4 and 5 can match another field and pass. No warning does not mean the answer was verified. The widget never shows a verified mark.
  - The chat answers with the engine's effective colour, which is global. The board shows the colour saved on that chat. They can differ after an override in another chat.
  - Ingested documents can appear in `search` results. The chat is read-only, so the risk is misleading text, not a write.
  - Widget check on chat `f0ac38c2-0931-4baf-90d3-29bddd8bee0f`: the colour-count question took 12.0 s and did not warn; the question about SYN-MZ-00001 took 13.9 s and warned. After reload the warning was still next to that answer, because `GET /api/chats/:id` returns it on `answer.warnings`. The welcome screen shows `chat-no-chat` and does not call the server. The panel starts minimized.
- Done when: the breeder asks "which lines are red and why?" and receives a cited answer.

---

## Phase 3 - Demo readiness gate

### F3.1 Demo readiness
- Status: not started
- Priority: 1 of 1 in Phase 3
- Depends on: F1.5, F2.1
- Goal: The demo can be run reliably by anyone on the team, and a broken change is caught before it
  reaches `stg`.
- Evidence / pointers: `gendd/specs/uc4-use-case.md` (success criteria), `.github/workflows/lint.yml`,
  `README.md`, `context/quality-assurance.md`, `context/security.md`, `agents/tech-lead.md`.
- Checklist:
  - [ ] Written demo script: flagged candidate, explanation, breeder challenges it, override logged, question answered in chat
  - [ ] End-to-end test of that script (tool chosen with a mentor and recorded in `gendd/adr/`), targeting the existing `data-testid`s
  - [x] Continuous integration runs the data engine's `pytest -q` and the new frontend and backend tests, not only lint (`.github/workflows/test.yml`)
  - [x] No screen in the demo path still imports from `src/mocks/` (only `dashboards.js` is left, and nothing imports it)
  - [ ] `npm audit` findings at Medium or above triaged (fixed or recorded with a reason)
  - [x] Root `README.md` explains how to run all three processes (engine, backend, frontend), the required `.env` values, and how to reset the override and correction logs (`DATA_ENGINE_STATE_DIR`)
  - [ ] Clean demo data the day before, from a read-only inventory: overrides in `services/data-engine/.state/overrides.jsonl`, `candidate_reviews` rows, test chats and messages in Supabase, and the engine's in-memory state. An engine override is global, so a test override changes what new chats show
  - [ ] Promotion `dev` -> `stg` through a pull request with the demo script passing
- Done when: the demo script passes end to end on a fresh clone and on `stg`.

---

## Phase 4 - Trust and data enrichment

### F4.1 Trust panel
- Status: not started
- Priority: 1 of 4 in Phase 4
- Depends on: F1.1
- Goal: A sceptical breeder can see how well the rules match the official logic, what the known data
  problems are, and what is still pending SME confirmation.
- Evidence / pointers: `GET /api/engine/baseline`, `GET /api/engine/quality`, engine passthrough in
  `apps/intersbackend/src/routes/engine.routes.js`, `services/data-engine/docs/FINDINGS.md`.
- Checklist:
  - [ ] Trust view in the workspace (for example a sidebar entry) fetching `GET /api/engine/baseline` and `GET /api/engine/quality`
  - [ ] Parity with the official verdicts (72/72) and the rule version in force
  - [ ] Rule weights and root causes of mismatches, in plain language
  - [ ] Data-quality issues with status (fixed, proposed, not fixable) and the open SME questions
  - [ ] Visible caveat that the trial rule is a reconstruction pending SME confirmation
  - [ ] Loading and error states with `data-testid`s, and tests for them
- Done when: the breeder can answer "can I trust this?" from one screen.

### F4.2 New data from the UI and global search
- Status: upload is done for this commit. Showing ingestion results, warnings, and engine search are improvements.
- Priority: 2 of 4 in Phase 4
- Depends on: F1.3
- Goal: The breeder can drop in new files (tables, PDF, scan, DOCX) and find any id or word across
  candidates, reasons and documents.
- Evidence / pointers: `apps/intersfrontend/src/components/WelcomeView.jsx`, `Workspace.jsx`
  (`handleSubmitFiles` posts multipart), `docs/api-contract.md` (`POST /api/chats/:id/messages` multipart),
  `apps/intersbackend/src/services/ingest.service.js` (tables via `/ingest/records`; documents via engine
  `/documents/base64` after the relevance gate, wired to live analysis), engine `POST /ingest/records`, `GET /search`.
- Checklist:
  - [x] Drag-and-drop / browse upload with accepted types matching the engine's formats and removable file chips (F0.5)
  - [x] Relevance gate: off-topic documents are refused before the engine indexes them (`POST /relevance`). The API can still return an `IRRELEVANT_FILE` warning; the workspace does not render it
  - [x] Uploads never overwrite the exports: identical rows are ignored, contradicting rows are counted as `conflicts` (engine quality report). A `UPLOAD_CONFLICTS` warning is not rendered in the workspace
  - [x] Send each file through `POST /api/chats/:id/messages` (multipart) with a size limit shown to the user (Create dashboard: new chat, then the files; the greeting becomes `analysis-loading` while it runs, no second submit, no abort)
  - [ ] Show the ingestion result per file: accepted source and rows, or rejected with the engine's reason (`IngestionList`, also on an empty dashboard). Improvement: the component is unused, and `Workspace` still stores `analysis.ingestion` and `analysis.warnings`
  - [x] A document that names candidates or trials (field notes, a lab report) touches those candidates, checked against the engine (`entities_mentioned`, `entities_in_tables`). Before, a document alone gave an empty dashboard
  - [ ] Triage and evidence card refresh after an accepted upload; document evidence appears on the card
  - [ ] Replace the client-side search (id, crop, reason) with, or complement it by, engine search exposed on Express (not mounted yet)
  - [ ] Search results link to the matching candidate or trial
  - [ ] Loading, error and "no results" states with `data-testid`s, and tests for them
- Done when: a document uploaded during the demo shows up as evidence on the right candidate.

### F4.3 Side-by-side candidate comparison
- Status: not started
- Priority: 3 of 4 in Phase 4
- Depends on: F1.3
- Goal: The breeder compares two to four candidates on the same screen before deciding which advances.
- Evidence / pointers: engine `GET /compare?ids=a,b`, `dataEngineClient.js` (`compare`),
  agent tool `compare_candidates`, row context menu in `RowContextMenu.jsx` (natural place for
  "Add to comparison").
- Checklist:
  - [ ] Add compare on Express (engine `GET /compare`), forwarding `ids` — route not in `paths.js` yet
  - [ ] Select two to four candidates from the triage tables
  - [ ] Comparison view with colour, reason and key evidence per candidate, side by side
  - [ ] Same rules as the evidence card: statements quoted as returned, no recomputed numbers
  - [ ] Validation for fewer than two or more than four selections
  - [ ] Loading and error states with `data-testid`s, and tests for them
- Done when: the breeder can compare two flagged candidates and open either one's evidence card.

### F4.4 Override feedback loop
- Status: not started
- Priority: 4 of 4 in Phase 4
- Depends on: F1.5
- Goal: Disagreements and corrections from breeders become input for the SME to refine the rules,
  instead of being lost.
- Evidence / pointers: `services/data-engine/src/data_engine/audit.py` (docstring: "disagreements
  panel"), engine `GET /overrides`, `GET /corrections` (F1.4), `services/data-engine/config/rules.yaml`.
- Checklist:
  - [ ] Disagreements view listing all overrides and corrections: candidate, engine value, breeder value, reason code, comment, rule version, who and when
  - [ ] Counts by reason code and by direction (for example red to amber)
  - [ ] Filter by rule version so disagreements with an old rule are not mixed with the current one
  - [ ] Export (CSV) for the SME
  - [ ] Read-only: nothing in this view changes rules or colours
  - [ ] Loading, empty and error states with `data-testid`s, and tests for them
- Done when: the SME can download every disagreement and correction with its reason for the current
  rule version.

---

## Backend next steps (Step 9 onward)

Step 8 is merged. 9A is done. See `context/backend-development.md` and `agents/backend-dev.md`.

### 9A — Live upload orchestration

- [x] Wire `analysis.service` in live mode: tables through `ingest.service` → engine `POST /ingest/records`;
  documents through engine `POST /documents/base64` (no Claude extraction).
- [x] Reuse explanations when `evidence_hash` unchanged (SHA-256 of the llm-context payload, without
  `instructions` or `tokens`).
- [x] `EXPLAIN_MAX_SYNC=30`: explain synchronously with priority RED > AMBER > GREEN; defer the rest with
  warning `EXPLANATION_DEFERRED`.
- [x] Build the analysis **summary** on the backend from engine data (Claude's summary is advisory only;
  do not trust unverified counts).
- [x] Persist `usage` (see Usage in `docs/api-contract.md`) and `versions` via `getPromptVersions`
  (`explanation_prompt`, `rule_version`, `model`).

### 9B — Chat agent with engine tools

- [x] `agent.service.ask`: Claude loop using engine `GET /tools` and `POST /tools/:name`, max 6 rounds, plus a 90 second deadline (`ANSWER_TIMEOUT`). History is loaded from saved messages; `kind: "analysis"` is skipped.
- [x] Answer verification warning `ANSWER_UNVERIFIED_NUMBERS` when numbers are not backed by this question's tool results. The text is still returned. Ids are not numbers. Live check: the warning fired on 3 of 4 answers. `query_candidates` has no total, so a reply can count the default page of 20 instead of the full set. Digits 1, 3, 4 and 5 can match another field (including the `4` in `UC4_MATERIAL_V0`) and pass. No warning does not mean the numbers were verified.

### Ticket 3 — Candidate decisions

- [x] Live `PATCH /api/candidates/:id` and `POST /api/candidates/:id/decision` (mock still returns 501 after validation).
- [x] Colour changes forward to engine `POST /overrides`; `engine_colour` and the effective `colour` stay separate on the candidate. The table does not render `engine_colour` (F1.5).

### Step 10 — Demo ops

- `baseline.js`, `warmup.js`, Render deploy, root `README.md` runbook.
- Clean demo data the day before, from a read-only inventory: `services/data-engine/.state/overrides.jsonl`, `candidate_reviews`, test chats and messages in Supabase, and the engine process memory. An engine override is global, so a test override changes what new chats show.

### Engine owner backlog (Sebastián)

- [x] `query_candidates`: return the total and a truncated flag, and say in the tool description that the default limit is 20.
- [x] Engine system prompt: use `apply_scoring` for colour counts, and do not treat the page length as the total. Spell out rule colour versus effective colour after overrides. Also: always answer in English, write numbers with digits, bold and "- " bullets only.
- [x] Trial status counts in llm-context (`trial_counts`). It is derived from `trials`, so the backend leaves it out of `evidence_hash` and saved justifications are still reused.
- [x] Dedupe in `POST /ingest/records` (exports win; duplicates ignored; conflicts reported).
- [x] A failing upload no longer poisons the engine: an ingest that fails is rolled back and answered with `accepted: false` (before: 500 on every later ingest until a restart). The archive drop's `operations_synthetic.csv` (unknown TRIAL_GUIDs) caused it; `quality.assess` now tolerates it, and the archive `trial_synthetic.csv` (same TRIAL_ID, new GUID) is reported as 72 conflicts instead of duplicating every trial.
- [ ] In-memory engine state lost on restarts (persist `DATA_ENGINE_STATE_DIR` in the deployment).
- [ ] Docker deploy with Tesseract / Poppler for OCR.

### Integrated V2 data (2026-10-02)

- [x] The engine loads the 8 root CSVs of Syngenta's V2 zip (`data/synthetic/uc4_v2`); the `[DEPRECATED]` folders are ignored and the 29-Sep drop stays only as a test fixture.
- [x] Keys: `MATERIAL_GUID` (pedigree master, 152), `TRAIT_GUID` (dictionary, 6 traits), `TRIAL_ENTRY_GUID` / `FIELD_ENTITY_ID` (bridge, 72 trials, 1,728 entries). Referential integrity 100 %.
- [x] Official candidate RAG reproduced 150/150 (32 G / 53 A / 65 R); every summary number recomputed from the plots and the lab within rounding.
- [x] Findings in `services/data-engine/docs/FINDINGS.md` section 0: no V2 trial table (no location / year), `BREEDER_DECISION` empty for 150, 2 lines genotyped only, 2 commercial checks, operations 11 delayed / 5 missed / 140 off-system.
- [x] Express keeps only real candidates as touched ids (the commercial checks are not candidates).

### Pending before demo (from the 2026-10-02 handoff)

1. Chat: [x] English answers; [x] bold rendering; [x] stale `chatReplies` references; [ ] manual 2-minute check with "How many lines are there per colour?".
2. Engine requests: all done above, except persistence and Docker.
3. Product: [x] upload from the screen (F4.2); optional: evidence card (F1.3), ids as filter buttons, Phase 4.
4. Demo ready (F3.1): [ ] decide local or `stg`; [x] demo script (`gendd/specs/demo-script.md`); [ ] e2e test decision with the mentor; [x] CI; [x] no demo screen imports mocks; [ ] `npm audit` triage; [x] README runbook; [ ] Step 10 (baseline.js, warmup.js, Render, key rotation); [ ] Trello; [ ] dev -> stg PR.
5. Clean test data once, the day before, from a read-only inventory (engine `overrides.jsonl`, `candidate_reviews`, test chats). Keep one chat with the 150 saved justifications, because reuse reads saved rows.

### Claude tooling note

- Forced `tool_choice` for a single tool works on **Haiku 4.5** (`claude-haiku-4-5-20251001`, current default).
- Sonnet 5.5 and newer may need `tool_choice: auto` plus strict tool schemas (not implemented).

## Open questions affecting this roadmap

- Unknown: record `node:test` choice in `gendd/adr/` (backend already uses it; 110 tests, lint-only CI).
- Unknown: who owns the Anthropic API key long term; current model `claude-haiku-4-5-20251001`.
- Unknown: whether the demo runs locally or from `stg` (F3.1).
- Unknown: how "dashboards" in the UI map to the engine, which holds a single dataset (F1.2).
- Unknown: where a human-readable crop name comes from; the mock data only has `CROP_GUID` (F1.2, F1.4).
- Unknown: whether breeder corrections should feed the rules and change the engine colour, or stay as
  annotations (F1.4; needs the SME).
