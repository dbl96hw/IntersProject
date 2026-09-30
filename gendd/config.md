# GenDD configuration

Written by `gendd-setup` on 2026-09-30. Every GenDD skill reads this file before doing anything
tracker-, stack-, or platform-specific. Edit it freely; a later setup run updates it instead of
overwriting it.

## Tracker

- Type: local (hybrid with Trello)
- Details:
  - Team source of truth: Trello board <https://trello.com/b/ZSIH6hun/hackathon-project>.
  - GenDD has no Trello integration, so agents write stories and tickets to `gendd/tickets/<slug>.md`
    using the local-file format (see `gendd/tickets/README.md`). A human copies each ticket to Trello
    and records the Trello card URL in the ticket's `trello` frontmatter field.
  - When Trello and a local ticket disagree, Trello wins; update the local file to match.

## Status vocabulary

- Ready for agent: `ready-for-agent`
- In review: `in-review`
- Blocked: `blocked`

Use the same words as Trello list names or labels so the two stay aligned.

## Stack

- Languages:
  - JavaScript (ES modules) for `apps/intersfrontend` (React 18 + Vite 5) and `apps/intersbackend`
    (Node.js 20+, Express 4). See `apps/*/package.json`.
  - Python 3.10+ for `services/data-engine` (FastAPI, pandas, NumPy). See
    `services/data-engine/pyproject.toml`.
  - Optional native back-ends in the data engine: C++17 and Julia (auto-detected, fall back to Python).
- Package manager:
  - npm workspaces at the repo root (`package.json`, workspaces `apps/*`). `services/` is not an npm
    workspace.
  - pip for `services/data-engine` (`requirements.txt`, `pip install -e .`).
- Test frameworks per level: unit / integration / e2e
  - Unit: pytest (data engine only).
  - Integration: pytest with `httpx` against the FastAPI app (data engine only; `dev` extra in
    `pyproject.toml`).
  - End to end: Unknown: no end-to-end framework exists; a human must choose one.

## Test frameworks and commands

- Unit: `cd services/data-engine && pytest -q` (config in `[tool.pytest.ini_options]` of
  `services/data-engine/pyproject.toml`).
- Integration: same command; the suite mixes unit and API-level tests in `services/data-engine/tests/`.
- End to end: Unknown: none.
- Frontend (`apps/intersfrontend`): Unknown: no test framework or `test` script.
- Backend (`apps/intersbackend`): Unknown: no test framework or `test` script.
- Lint (all JavaScript workspaces): `npm run lint` from the root. This is the only check that runs in
  continuous integration (`.github/workflows/lint.yml`). Python tests are not run in continuous
  integration.

## Coverage threshold

- Percent on changed files: none (no threshold during the hackathon). Revisit once the frontend and
  backend have a test framework.

## Security severity bar

- Minimum severity that blocks Definition of Done: Medium (Medium, High and Critical findings block).

## Docs locations

- Architecture Decision Record folder: `gendd/adr/`
- Specs and plans: `gendd/specs/`
- Existing design documents that stay where they are: `services/data-engine/docs/` (`DESIGN.md`,
  `CONTRACTS.md`, `INTEGRATION.md`, `FINDINGS.md`).
- Context Pack: `context/` (per-area context) and `agents/` (role playbooks).

## Boundary overrides

- (none yet)
