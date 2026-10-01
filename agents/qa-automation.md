# QA Automation Playbook

## Quick Start

Read, in order:

1. `context/quality-assurance.md` - what is tested today and the gaps.
2. `gendd/definition-of-ready.md` (Gherkin acceptance criteria, test level per criterion) and
   `gendd/definition-of-done.md` (each criterion mapped to a passing test).
3. `services/data-engine/tests/conftest.py` - fixtures and state isolation.
4. `services/data-engine/docs/CONTRACTS.md` - the shapes tests should assert.

Day-to-day commands:

- `cd services/data-engine && pip install -r requirements.txt && pip install -e .`
- `cd services/data-engine && pytest -q` (add `-rs` to list skipped tests)
- `cd services/data-engine && python -m data_engine.evaluate --export-date 2026-09-29`
- `npm run lint` from the root.

## Role-Specific Context

- Only the Python data engine has tests (pytest). `apps/intersfrontend` and `apps/intersbackend`
  have no test framework and no `test` script (`gendd/config.md`).
- Continuous integration runs lint only; pytest is not run on pull requests.
- Tests run against the committed mock data in `data/synthetic/uc4/`; `mock_dir` skips the suite when
  it is missing, and optional packages are skipped with `pytest.importorskip`.
- The behaviours that matter most for the demo come from `gendd/specs/uc4-use-case.md`: a colour with
  a reason for every candidate, a breeder override that is logged, and the engine colour never
  changed by an override.
- The frontend (PR #7) is a breeder workspace running on mock data. Its elements already carry
  `data-testid`s, for example `upload-dropzone`, `triage-section-<green|amber|red>`,
  `candidate-row-<candidate_id>`, `edit-candidate-modal`, `edit-save-button` and `chat-input`. The
  full list is in `context/quality-assurance.md`. New UI must follow `.cursor/rules/80-testability-lite.mdc`.
- Breeder corrections (crop, mean yield, justification) are an accepted product decision but not built
  in the engine yet (`gendd/specs/feature-roadmap.md`, F1.4). When they land, they need the same
  guarantees as overrides.

## Key Areas

- `services/data-engine/tests/` - `test_engine.py`, `test_math.py`, `test_quality_and_diagnostics.py`,
  `test_documents.py`, `doc_fixtures.py`, `conftest.py`.
- `services/data-engine/pyproject.toml` - `[tool.pytest.ini_options]`, `dev` extra.
- `data/synthetic/uc4/` - fixtures (do not edit; add new files instead).
- `services/data-engine/src/data_engine/api.py` - endpoints for API-level tests (`TestClient`).
- `.github/workflows/lint.yml` - where a test job would be added.

## Safe First Changes

- Add a test in `test_engine.py` for a contract field from `services/data-engine/docs/CONTRACTS.md`
  that is not yet asserted.
- Add an API-level test for the error contract (400 `VALIDATION_ERROR` with `field`, 404 `NOT_FOUND`).
- Propose (in a ticket) a frontend test setup and a first test for the edit modal: validation
  errors, and a required override reason when the status changes.
- Add a pytest asserting that `POST /overrides` with reason `OTHER` and no comment returns 400
  `VALIDATION_ERROR` (the UI currently marks the comment as optional).

## Danger Zones

- Editing `data/synthetic/uc4/*.csv` changes every result and the published findings.
- Tests that write to `services/data-engine/.state/` instead of the temporary directory from
  `conftest.py`.
- Assertions on exact floating-point values near the rule boundary (margin 4e-5,
  `services/data-engine/README.md`); prefer the tolerances the existing tests use.
- A green run with many skips is not evidence; check the skip summary.
- Frontend tests written against mock data prove the UI only; they say nothing about the contract
  until the screen is wired to the API.

## Checklists

**Before writing tests for a story:**
- [ ] Every acceptance criterion is in Given / When / Then form and names its level (unit, integration, end to end).
- [ ] Each criterion maps to exactly one named test; the test name reads like the criterion.
- [ ] The level exists in this repo for the component touched; if not (frontend, Express, end to end), the gap is raised as a ticket instead of skipped silently.

**When writing data engine tests:**
- [ ] Use the `engine` / `mock_dir` fixtures from `conftest.py`; never build state outside the temporary directory.
- [ ] Assert behaviour and contract shapes, not internal helpers.
- [ ] Human-in-the-loop behaviour is covered when touched: override or correction logged, original value kept, `engine_colour` unchanged, reason present.
- [ ] Optional dependencies use `pytest.importorskip`, not try/except.
- [ ] `pytest -q` passes locally and the skip count has not grown unexpectedly.

**When writing frontend or Express tests (once a framework exists):**
- [ ] Target elements by `data-testid`, not CSS classes.
- [ ] Loading, empty, success and error states are each covered.
- [ ] Error responses follow `{"error": {"code", "message", "field"}}`.
