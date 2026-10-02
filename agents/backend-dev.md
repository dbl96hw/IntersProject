# Backend Developer Playbook

## Quick Start

Read, in order:

1. `context/backend-development.md` — Express gateway, modes, Claude layer, gaps.
2. `docs/api-contract.md` — every `/api` route the frontend will call.
3. `services/data-engine/docs/CONTRACTS.md` — engine payloads and errors.
4. `services/data-engine/docs/INTEGRATION.md` — running the engine alongside Express.
5. `.cursor/rules/65-breeders-desk-backend.mdc`, `60-express-api.mdc`, `70-api-contract.mdc`.

Day-to-day commands (from repo root unless noted):

- `npm run dev:backend` — http://localhost:3000.
- `cd services/data-engine && uvicorn data_engine.api:app --port 8001`.
- `npm test -w apps/intersbackend` — 110 unit tests (mocked SDK/engine).
- `npm run lint`.
- Live smokes (engine + `.env` with `ANALYSIS_MODE=live`): `npm run db:smoke -w apps/intersbackend`,
  `npm run ingest:smoke -w apps/intersbackend -- path/to/file.csv`, `npm run claude:smoke -w apps/intersbackend`
  (optional `SMOKE_BREEDER_TEXT`).

## Role-Specific Context

- Express is a **real gateway** in mock mode (full `/api` shape) with **partial live** wiring: engine
  passthrough, candidate detail refresh, chats/messages storage — but live **analysis** and **chat agent**
  are not implemented yet (`analysis.service.js` returns not implemented in live).
- The data engine is the only producer of numbers and colours; it also **reads documents**. Claude
  **only explains** (and will answer chat via engine tools in 9B). See roadmap **Backend next steps**.
- Current Claude model in use for smokes: `claude-haiku-4-5-20251001`. Forced single-tool calls work on
  Haiku 4.5; Sonnet 5.5+ may need `tool_choice: auto` + strict schemas (not done).

## Key Areas

- `apps/intersbackend/src/app.js`, `src/routes/`, `src/services/`, `src/db/`, `supabase/migrations/001_init.sql`.
- `apps/intersbackend/src/llm/`, `src/prompts/`, `src/constants/` (incl. `llm.js`, `pricing.js`, `sources.js`).
- `apps/intersbackend/scripts/` — smoke scripts.
- `services/data-engine/src/data_engine/api.py`, `engine.py`, `agent_tools.py`.

## Safe First Changes (Step 9)

- Wire live `analysis.service.handleMessage`: `ingest.service` + `createClaudeClient().explainAll`, persist
  candidates/messages with `usage` and `getPromptVersions`.
- Implement ticket 3 routes (stop returning 501) with engine `POST /overrides` for colour.
- Add `agent.service.ask` for text-only chat messages with engine tools.
- Extend tests with mocked ingest + explain paths before touching production keys.

## Danger Zones

- Do not recompute colours, verdicts or evidence in Express.
- Do not wire Claude document extraction into the upload path; use engine `/documents/base64`.
- Do not log prompts, file buffers, or API keys; Claude client logs tokens/cost only.
- Evidence check must stay strict on numbers; field/record labels in `cited_values` are lenient by design.
- See `context/backend-development.md` and rule 65 for overrides, SQL and engine config.

## Checklists

**Before opening a pull request for an Express change:**

- [ ] Routes thin; errors `{ code, message, field }`; engine errors forwarded.
- [ ] New env vars in `.env.example` without values.
- [ ] `npm run lint` and `npm test -w apps/intersbackend` pass.
- [ ] If behaviour is user-visible, `data-testid` on the frontend (separate PR) or smoke script output documented.
- [ ] Tick roadmap items in `gendd/specs/feature-roadmap.md` when applicable.

**Before opening a pull request for a data engine change:**

- [ ] Coordinate with engine owner; `pytest -q`; update `CONTRACTS.md` if shapes change.
- [ ] Do not edit `data/synthetic/` fixtures silently.
