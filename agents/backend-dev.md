# Backend Developer Playbook

## Quick Start

Read, in order:

1. `context/backend-development.md` - the Express API and the Python data engine.
2. `services/data-engine/docs/INTEGRATION.md` sections 1 to 3 - running the engine, wiring Express,
   the Claude tool-use loop.
3. `services/data-engine/docs/CONTRACTS.md` - endpoints, payloads, error codes.
4. `.cursor/rules/60-express-api.mdc`, `70-api-contract.mdc`, `95-shared-constants.mdc`.

Day-to-day commands:

- `npm run dev:backend` from the root (http://localhost:3000).
- `cd services/data-engine && uvicorn data_engine.api:app --port 8001` (docs at http://localhost:8001/docs).
- `cd services/data-engine && pytest -q`
- `npm run lint` from the root.

## Role-Specific Context

- Express (`apps/intersbackend/src/index.js`) is minimal today: hand-written CORS, `GET /`, `GET /health`.
- The data engine is the only component that produces numbers. Express forwards requests and errors;
  it does not re-score, re-colour or reshape evidence.
- The integration is prepared as copy-in files in `services/data-engine/clients/node/`
  (`constants.js`, `dataEngineClient.js`, `breederRoutes.example.js`, `agentLoop.example.js`).
- The agent loop needs `@anthropic-ai/sdk` (not installed yet), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
  and caps tool rounds at `MAX_TOOL_ROUNDS = 6`.
- Overrides are human decisions from the UI (`POST /overrides`); the agent has no override tool on
  purpose.
- The frontend (PR #7) is a mock-only workspace that already expects data the engine does not return:
  `crop` and `mean_yield_t_ha` on each candidate row, and breeder corrections to crop, mean yield and
  justification. Corrections are an accepted product decision; the engine capability is planned in
  `gendd/specs/feature-roadmap.md`, F1.4 (details in `context/backend-development.md`).

## Key Areas

- `apps/intersbackend/src/index.js`, `apps/intersbackend/src/constants/`.
- `services/data-engine/clients/node/` - integration examples.
- `services/data-engine/src/data_engine/api.py` - REST endpoints and error contract.
- `services/data-engine/src/data_engine/engine.py` - `DataEngine`.
- `services/data-engine/src/data_engine/agent_tools.py`, `mcp_server.py` - tools and system prompt.
- `services/data-engine/src/data_engine/audit.py` - override log; the pattern to copy for the
  corrections log.
- `services/data-engine/config/rules.yaml`, `config/sources.yaml`.

## Safe First Changes

- Copy `clients/node/constants.js` into `apps/intersbackend/src/constants/` and re-export it from
  `index.js`.
- Wire `dataEngineClient.js` and a single read-only route (`GET /api/breeder/candidates`) that
  forwards the engine response and errors unchanged.
- Extend `GET /health` in Express to report whether the data engine is reachable, keeping
  `{ healthy: ... }` accurate.
- Add `mean_yield_t_ha` to the candidate row in `engine.py` (it already exists as the
  `MEAN_YIELD_T_HA` feature), document it in `CONTRACTS.md`, and add a pytest.

## Danger Zones

- `services/data-engine/config/rules.yaml` - changes every colour; needs a rule version bump and a
  re-run of `python -m data_engine.evaluate`.
- Contract shapes in `services/data-engine/docs/CONTRACTS.md` - the UI and agent depend on them.
- `audit.py` and `POST /overrides` - must stay append-only and never change `engine_colour`.
- Corrections (F1.4): mixing them into the override log, applying them by editing the source tables,
  or letting them change `engine_colour` before the SME confirms they should feed the rules.
- Adding an override or colour-changing tool to `agent_tools.py`, or weakening `SYSTEM_PROMPT` rules.
- `POST /sql` - keep it on an in-memory, read-only connection.
- Exposing the data engine directly to the browser or internet (it has no auth and allows any origin).
- Logging or committing `ANTHROPIC_API_KEY`; heavy synchronous work in Express handlers.

## Checklists

**Before opening a pull request for an Express change:**
- [ ] Routes are thin: validate input, call the engine or helper, return JSON.
- [ ] Errors use `{"error": {"code", "message", "field"}}` with 400 / 404 / 500; no stack traces in responses.
- [ ] Engine errors are forwarded, not rewritten into a different shape.
- [ ] Paths, URLs and limits are constants in `apps/intersbackend/src/constants/`; config comes from `process.env`.
- [ ] New environment variables are added to `apps/intersbackend/.env.example` (without real values).
- [ ] `GET /health` still works; `npm run lint` passes.

**Before opening a pull request for a data engine change:**
- [ ] `pytest -q` passes in `services/data-engine` and the result is noted in the pull request.
- [ ] Payload changes are reflected in `services/data-engine/docs/CONTRACTS.md` in the same pull request.
- [ ] Rule changes bump the version in `config/rules.yaml` and include the new evaluation numbers.
- [ ] Every returned colour still carries a reason and evidence; overrides and corrections remain
      human-only and append-only.
- [ ] Corrected values are returned with their original value and a `corrected` marker, never as
      engine values.
- [ ] Mock files in `data/synthetic/uc4/` are unchanged.
- [ ] The feature's checklist items are updated in `gendd/specs/feature-roadmap.md`.
