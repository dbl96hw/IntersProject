# Context: Quality Assurance

## Area and confidence

- Area id: `quality-assurance`
- Confidence: MEDIUM

## Signals

- `services/data-engine/tests/` with pytest configuration in `services/data-engine/pyproject.toml`
  (`[tool.pytest.ini_options]`, `testpaths = ["tests"]`).
- `dev` extra in `pyproject.toml`: `pytest`, `httpx`, `reportlab`.
- `.cursor/rules/80-testability-lite.mdc` (`data-testid`, visible error states).
- Confidence is MEDIUM because only one of three components has tests.

## What lives here

- Directories:
  - `services/data-engine/tests/`:
    - `conftest.py` - isolates `DATA_ENGINE_STATE_DIR` per test; session fixtures `mock_dir` (skips
      when the mock CSVs are missing) and `engine`.
    - `test_engine.py` - end-to-end engine build, parity, overrides, and a FastAPI `TestClient` API test.
    - `test_math.py` - numerical checks (spectral, calibration, metrics).
    - `test_quality_and_diagnostics.py` - data-quality issues, diagnostics, DuckDB snapshot.
    - `test_documents.py` + `doc_fixtures.py` - document ingestion; fixtures generated with `reportlab`.
  - `data/synthetic/uc4/` - fixtures the tests and evaluation run against (`data/synthetic/uc4/README.md`).
- Entry points:
  - `cd services/data-engine && pytest -q`. `services/data-engine/README.md` states 54 tests; 52
    `test_*` functions are defined across the four files (the difference is expected to be
    parametrisation).
  - `python -m data_engine.evaluate --export-date 2026-09-29` - reproducible evaluation report
    (parity 72/72, ROC), results in `services/data-engine/README.md` and `docs/FINDINGS.md`.
  - `npm run lint` - ESLint for both JavaScript apps; the only continuous-integration check
    (`.github/workflows/lint.yml`).

## Conventions in force

- Optional dependencies are skipped, not failed: `pytest.importorskip(...)` for `fastapi`, `duckdb`,
  `sklearn` (see `test_engine.py`, `test_quality_and_diagnostics.py`, `test_math.py`).
- Tests never write to the real `.state/` directory (`conftest.py` autouse fixture).
- Frontend testability: `data-testid` on interactive elements and status messages; loading and error
  states visible in the UI (`.cursor/rules/80-testability-lite.mdc`). Existing ids, since PR #7
  (the old `landing-title`, `health-status`, `brand-banner`, `site-footer` no longer exist):
  - Workspace and sidebar: `workspace-scroll`, `sidebar`, `new-dashboard-button`,
    `recent-dashboard-<id>`, `sidebar-user`, `plant-decoration`.
  - Upload: `welcome-view`, `upload-dropzone`, `upload-input`, `upload-add-button`, `selected-files`,
    `analysis-loading`, `upload-submit`.
  - Dashboard: `dashboard-view`, `dashboard-summary`, `dashboard-filters`, `filter-search-input`,
    `filter-status-<all|green|amber|red>`, `filter-empty`, `triage-section-<green|amber|red>`,
    `triage-count-<green|amber|red>`, `candidate-row-<candidate_id>`, `overridden-badge-<candidate_id>`.
  - Edit and override: `row-context-menu`, `row-context-menu-edit`, `edit-candidate-modal`,
    `edit-crop-input`, `edit-yield-input`, `edit-justification-input`, `edit-status-select`,
    `edit-override-reason-select`, `edit-comment-input`, `edit-cancel-button`, `edit-save-button`.
  - Chat: `chat-toggle-button`, `chat-widget`, `chat-minimize-button`, `chat-close-button`,
    `chat-messages`, `chat-message-<bot|user>`, `chat-typing`, `chat-input`, `chat-send-button`.
- Backend testability: clear JSON errors and an accurate `/health` (`.cursor/rules/80-testability-lite.mdc`).
- Acceptance criteria in Gherkin, each naming its test level: `gendd/definition-of-ready.md`.
- Every acceptance criterion maps to a passing test: `gendd/definition-of-done.md`. Coverage
  threshold: none (`gendd/config.md`).

## Testing expectations

- Data engine: any change under `services/data-engine/` runs `pytest -q` locally; any change to
  `config/rules.yaml` also re-runs `python -m data_engine.evaluate` and checks parity has not dropped.
- Express and frontend: no framework yet; `npm run lint` must pass.
- The frontend currently runs on mock data (`apps/intersfrontend/src/mocks/`). Tests written against
  the mock UI must be updated when each screen is wired to the API; the `data-testid`s above should
  stay stable across that change.
- Demo-critical behaviour to protect (from `gendd/specs/uc4-use-case.md`): every candidate has a colour
  and a reason; an override is logged with user, time, reason code and original colour; the engine
  colour is never changed by an override. Once breeder corrections exist (roadmap F1.4): a correction is
  logged with the original value, and the original stays visible.

## Danger zones

- Continuous integration does not run pytest, so a green pull request says nothing about the data
  engine.
- Editing `data/synthetic/uc4/*.csv` changes test results and published findings; add new fixtures
  instead of changing existing ones.
- Tests silently skip when optional packages or mock data are missing; a skipped run can look green.
  Check the pytest summary for skips.
- The trial rule sits one trial from the boundary (margin 4e-5, `services/data-engine/README.md`);
  small numeric changes can flip parity.

## Unknowns

- Unknown: test framework for `apps/intersfrontend` (for example Vitest + React Testing Library) and
  for `apps/intersbackend` (for example Node's test runner or Vitest + supertest).
- Unknown: end-to-end tool for the demo flow (for example Playwright).
- Unknown: whether pytest should be added to `.github/workflows/lint.yml` or a new workflow.
- Unknown: whether the OCR tests need the Tesseract binary in continuous integration.
