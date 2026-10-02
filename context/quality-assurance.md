# Context: Quality Assurance

## Area and confidence

- Area id: `quality-assurance`
- Confidence: MEDIUM

## Signals

- `services/data-engine/tests/` with pytest (`services/data-engine/pyproject.toml`).
- `apps/intersbackend/test/` — `node --test`, 110 tests; Anthropic SDK and engine mocked.
- `.github/workflows/lint.yml` — lint only on pull requests.
- `.cursor/rules/80-testability-lite.mdc`.

Confidence stays **MEDIUM**: the data engine and Express backend both have automated tests, but **CI runs
lint only** — neither pytest nor `npm test` runs on pull requests yet.

## What lives here

- **Data engine:** `services/data-engine/tests/` (conftest, engine API, math, quality, documents).
  Run: `cd services/data-engine && pytest -q`.
- **Express backend:** `apps/intersbackend/test/` — route/env/errorHandler tests, ingest service,
  LLM tools, Claude client, evidence check. Run: `npm test -w apps/intersbackend`.
- **Smoke scripts (manual live):** `db:smoke`, `ingest:smoke`, `claude:smoke` — require live services and
  `.env`; print ids and summaries, never secrets or raw payloads.
- **Fixtures:** `data/synthetic/uc4/` (engine); `apps/intersbackend/test/fixtures.js`;
  `apps/intersbackend/test/fixtures/lab-report.pdf` (manual engine document checks, not used in CI tests).
- **Frontend:** no automated test framework yet; rich `data-testid` coverage since PR #7 (listed below).

## Conventions in force

- Optional deps skipped in pytest via `importorskip`.
- Backend: mock external services in unit tests; no real Anthropic or engine HTTP.
- Frontend testability: `data-testid` on interactive elements (workspace, upload, dashboard, edit modal,
  chat widget) — see prior list in this file's history; ids unchanged for E2E later.
- Gherkin in stories; DoD expects tests per criterion (`gendd/definition-of-ready.md`, `definition-of-done.md`).

## Testing expectations

- Data engine changes: `pytest -q`; rule changes also `python -m data_engine.evaluate`.
- Express changes: `npm test -w apps/intersbackend` and `npm run lint`.
- CI today: lint only — treat green lint as necessary but not sufficient for backend/engine changes.

## Danger zones

- Skipped pytest tests when mocks missing can look like full green runs.
- Editing committed synthetic CSVs changes engine findings.
- Mock frontend tests (when added) must switch from `src/mocks/` to `/api` without renaming stable test ids.

## Unknowns

- Unknown: add pytest and `npm test` to CI (roadmap F3.1).
- Unknown: frontend unit framework (Vitest) and E2E (Playwright).
- Unknown: Tesseract in CI for document tests.
