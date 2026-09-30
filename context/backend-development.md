# Context: Backend Development

## Area and confidence

- Area id: `backend-development`
- Confidence: HIGH

## Signals

- `apps/intersbackend/package.json` depends on `express` 4; entry `apps/intersbackend/src/index.js`.
- `services/data-engine/pyproject.toml` (FastAPI, uvicorn, pandas, NumPy) and
  `services/data-engine/src/data_engine/api.py` (REST endpoints).
- `.cursor/rules/60-express-api.mdc` and `70-api-contract.mdc` target `apps/intersbackend/**`.

## What lives here

Two back-end components with different languages and owners.

### Express API (`apps/intersbackend`)

- Directories: `apps/intersbackend/src/` (`index.js`), `apps/intersbackend/src/constants/`
  (`paths.js` with `HEALTH_PATH`, re-exported from `index.js`).
- Entry points: `apps/intersbackend/src/index.js`. Run `npm run dev:backend` from the root
  (http://localhost:3000, `node --watch`).
- Current routes: `GET /` (`{status, service, env}`), `GET /health` (`{healthy: true}`).
- CORS is hand-written middleware allowing `CORS_ORIGIN` (default `http://localhost:5173`).
- Configuration: `PORT` (`apps/intersbackend/.env.example`), `CORS_ORIGIN`, `NODE_ENV`.
- Planned (drop-in examples, not wired yet) from `services/data-engine/clients/node/`:
  - `constants.js` -> `apps/intersbackend/src/constants/` (`DATA_ENGINE_URL`, `DATA_ENGINE_PATHS`,
    `MAX_TOOL_ROUNDS = 6`, `DATA_ENGINE_TIMEOUT_MS = 30000`).
  - `dataEngineClient.js` -> `apps/intersbackend/src/services/`.
  - `breederRoutes.example.js` -> `apps/intersbackend/src/routes/`, mounted at `/api/breeder` with
    `express.json({ limit: '25mb' })`.
  - `agentLoop.example.js` - Claude tool-use loop with `@anthropic-ai/sdk` (not a dependency yet);
    needs `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATA_ENGINE_URL`.
  - Step-by-step: `services/data-engine/docs/INTEGRATION.md` section 2.

### Data engine (`services/data-engine`)

- Directories:
  - `src/data_engine/` - the package (layers listed in `services/data-engine/README.md`, "Layers").
  - `src/data_engine/documents/` - document ingestion (native PDF, OCR, Office, HTML; Python, C++,
    Julia back-ends).
  - `src/data_engine/accel/` - optional C++ / Julia kNN and document tools (`build.py`).
  - `config/rules.yaml` (rule versions `SYNTH_V1_RECON_2026-09-30`, `UC4_MATERIAL_V0`, thresholds,
    weights), `config/sources.yaml` (header signatures per source).
  - `clients/node/` - Node client and Express examples for the Express owners.
  - `docs/` - `DESIGN.md`, `CONTRACTS.md`, `INTEGRATION.md`, `FINDINGS.md`.
  - `.state/` (gitignored) - override log, `runs/*.json`, snapshot, compiled back-ends.
- Entry points:
  - REST: `uvicorn data_engine.api:app --port 8001` (interactive docs at `/docs`).
  - MCP (stdio): `python -m data_engine.mcp_server` (script `data-engine-mcp`).
  - Evaluation: `python -m data_engine.evaluate` (script `data-engine-eval`).
  - Library: `DataEngine.from_directory()` in `src/data_engine/engine.py`; agent tools
    `TOOLS`, `SYSTEM_PROMPT`, `call_tool` in `src/data_engine/agent_tools.py`.
- Setup: `cd services/data-engine && pip install -r requirements.txt && pip install -e .`
  (`services/data-engine/README.md`, "Quick start"). Environment variables are listed in the same
  README ("Environment variables"); paths are resolved in `src/data_engine/settings.py`.
- Endpoint list and payload shapes: `services/data-engine/docs/CONTRACTS.md`.

## Conventions in force

- Express: thin routes (validate -> work -> JSON), `express.json()` for bodies, config from
  `process.env`, keep `/health` working, never log secrets: `.cursor/rules/60-express-api.mdc`.
- Status codes and error shape `{"error": {"code", "message", "field"}}`, no stack traces in
  responses: `.cursor/rules/70-api-contract.mdc`. The data engine implements the same contract in
  `api.py` (`ApiError`, exception handlers) and documents codes in `services/data-engine/docs/CONTRACTS.md`.
- Constants per app in `apps/intersbackend/src/constants/`: `.cursor/rules/95-shared-constants.mdc`.
- Lint: `apps/intersbackend/eslint.config.js`.
- Data engine: rules and thresholds live in `config/*.yaml`, never hard-coded
  (`src/data_engine/settings.py` docstring); the engine is the only producer of numbers
  (`services/data-engine/docs/CONTRACTS.md`); the override log is append-only
  (`src/data_engine/audit.py`).
- Python style: Unknown: no Python linter or formatter is configured (`pyproject.toml` has none).

## Testing expectations

- Express: no tests. Data engine: pytest in `services/data-engine/tests/`, including a FastAPI
  `TestClient` test in `test_engine.py`. See `context/quality-assurance.md`.

## Danger zones

- `services/data-engine/config/rules.yaml`: changes every breeder-facing colour; re-run
  `python -m data_engine.evaluate` and `pytest -q`, and record the new rule version.
- `services/data-engine/docs/CONTRACTS.md` shapes and `/api/breeder/*` route names: consumed by the UI
  and agent loop; renaming fields is a breaking change.
- `src/data_engine/audit.py` and `POST /overrides`: the audit log must stay append-only and must
  never change `engine_colour`. Do not add an override path to the agent tools (deliberately absent,
  `services/data-engine/docs/INTEGRATION.md` section 3).
- `src/data_engine/agent_tools.py` `SYSTEM_PROMPT`: rules such as "never change, compute or re-derive
  a colour" enforce the human-in-the-loop constraint.
- `POST /sql` (`engine.py` `sql`): read-only is enforced by a string check (single statement starting
  with `SELECT` or `WITH`) on an in-memory DuckDB connection; do not point it at a persistent database.
- `express.json({ limit: '25mb' })` and document uploads: large base64 payloads are accepted by design.
- Heavy synchronous work in Express handlers blocks the event loop (`.cursor/rules/60-express-api.mdc`);
  delegate computation to the data engine.

## Unknowns

- Unknown: who owns the Express integration and when the `clients/node/` examples will be wired in.
- Unknown: the Express route for natural-language questions (the agent loop has no route yet).
- Unknown: which Claude model id `ANTHROPIC_MODEL` should use, and who holds the API key.
- Unknown: Python lint and formatting conventions for `services/data-engine`.
- Unknown: whether the override log should move from JSON-Lines to a database (`audit.py` mentions a
  possible Supabase / Postgres adapter).
