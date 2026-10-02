# Context: Quality Assurance

## Area and confidence

- Area id: `quality-assurance`
- Confidence: MEDIUM

## Signals

- `services/data-engine/tests/` with pytest (`services/data-engine/pyproject.toml`).
- `services/data-engine/tests/` — 91 tests (1 skipped where Tesseract is missing).
- `apps/intersbackend/test/` — `node --test`, 152 tests; Anthropic SDK and engine mocked. Frontend Vitest: 47 tests.
- `.github/workflows/lint.yml` (lint) and `.github/workflows/test.yml` (pytest, node:test, Vitest) on pull requests.
- `.cursor/rules/80-testability-lite.mdc`.

Confidence stays **MEDIUM**: all three parts have automated tests and CI runs them on pull requests, but
there is no end-to-end browser test yet (F3.1).

## What lives here

- **Data engine:** `services/data-engine/tests/` (conftest, engine API, math, quality, documents).
  Run: `cd services/data-engine && pytest -q`.
- **Express backend:** `apps/intersbackend/test/` — route/env/errorHandler tests, ingest service,
  LLM tools, Claude client, evidence check. Run: `npm test -w apps/intersbackend`.
- **Smoke scripts (manual live):** `db:smoke`, `ingest:smoke`, `claude:smoke` — require live services and
  `.env`; print ids and summaries, never secrets or raw payloads.
- **Fixtures:** `data/synthetic/uc4/` (engine); `apps/intersbackend/test/fixtures.js`;
  `apps/intersbackend/test/fixtures/lab-report.pdf` (manual engine document checks, not used in CI tests).
- **Frontend:** Vitest and Testing Library (`npm test -w apps/intersfrontend`). Fetch is replaced in the test. See `gendd/adr/0001-frontend-tests-use-vitest.md`.

## Conventions in force

- Optional deps skipped in pytest via `importorskip`.
- Backend: mock external services in unit tests; no real Anthropic or engine HTTP.
- Frontend testability: `data-testid` on interactive elements (workspace, upload, dashboard, edit modal,
  chat widget) — see prior list in this file's history; ids unchanged for E2E later.
- Gherkin in stories; DoD expects tests per criterion (`gendd/definition-of-ready.md`, `definition-of-done.md`).

## Testing expectations

- Data engine changes: `pytest -q`; rule changes also `python -m data_engine.evaluate`.
- Express changes: `npm test -w apps/intersbackend` and `npm run lint`.
- CI: lint plus all three test suites on every pull request to `dev`, `stg` and `main`.
- `npm audit` (2026-10-02): backend has no finding with the CDN SheetJS 0.20.3 in `package.json` (the npm
  registry copy 0.18.5 has a high prototype-pollution / ReDoS advisory, which is why it is not used).
  Frontend: 3 moderate, dev-only (Vitest mocker path traversal; esbuild dev server via Vite 5). They affect
  the local dev and test tools, not the built app; fixing needs Vite 8 / Vitest 5 (breaking), after the demo.
  Do not expose the Vite dev server on a public network.

## Danger zones

- Skipped pytest tests when mocks missing can look like full green runs.
- Editing committed synthetic CSVs changes engine findings.
- Mock frontend tests (when added) must switch from `src/mocks/` to `/api` without renaming stable test ids.

## Unknowns

- Unknown: end-to-end runner (Playwright is not chosen; F3.1). Vitest is recorded in `gendd/adr/0001-frontend-tests-use-vitest.md`. Backend runner is `node:test` (`gendd/adr/0002-backend-tests-use-node-test.md`).
- CI installs Tesseract (`apt-get install tesseract-ocr`), so the OCR tests run there.
