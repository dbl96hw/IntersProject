# Context: Technical Leadership

## Area and confidence

- Area id: `technical-leadership`
- Confidence: BASELINE

## Signals

- (BASELINE area: always included, not detected from a signal)

## What lives here

- Directories:
  - `.cursor/rules/` - the team's coding rules (overview, style, naming, safety, React, Express, API
    contract, testability, component reuse, constants).
  - `gendd/` - GenDD configuration, Definition of Ready, Definition of Done, tickets, Architecture
    Decision Records, specs.
  - `context/`, `agents/` - this Context Pack.
- Entry points:
  - `README.md` - how to run, lint, and the branching model.
  - `gendd/config.md` - tracker (Trello, mirrored in `gendd/tickets/`), status vocabulary, test
    commands, coverage threshold, security severity bar.

### Team and ways of working

- The repo is an interns learning monorepo used for the Syngenta x HatchWorks AI hackathon 2026
  (`.cursor/rules/00-overview.mdc`, `services/data-engine/README.md`).
- Work is tracked on Trello (<https://trello.com/b/ZSIH6hun/hackathon-project>), mirrored as local
  tickets in `gendd/tickets/` (`gendd/config.md`).
- Contributions so far arrive as pull requests on GitHub (`dbl96hw/IntersProject`), including
  AI-assisted commits tagged `[ai]` with a `Co-Authored-By` trailer (commit `5cad388`).

### Branching and release model

Source: `README.md` ("Branching model").

- `dev` - feature branches merge here first.
- `stg` - promoted from `dev` when ready to test.
- `main` - promoted from `stg`; production.
- All three require a pull request, at least one approval, and a passing lint check; no direct pushes.

## Conventions in force

- Simplest change that works; no new frameworks, ORMs, auth systems or UI libraries unless a mentor
  asks; explain a large rewrite before doing it; never commit `.env` files or secrets:
  `.cursor/rules/30-learning-and-safety.mdc`.
- Code style (small focused functions, no dead code, no leftover `console.log`, comments explain why):
  `.cursor/rules/10-code-style.mdc`.
- Naming (PascalCase components, camelCase functions, `handle*` handlers, `is/has/can/should`
  booleans, UPPER_SNAKE_CASE constants): `.cursor/rules/20-naming-conventions.mdc`.
- Constants per app: `.cursor/rules/95-shared-constants.mdc`.
- Testability (`data-testid`, visible loading and error states, accurate `/health`):
  `.cursor/rules/80-testability-lite.mdc`.
- Lint gate: `npm run lint` from the root, run on every pull request by `.github/workflows/lint.yml`.
- Readiness and completion: `gendd/definition-of-ready.md`, `gendd/definition-of-done.md`.
- Product non-negotiables every technical decision must respect: human in the loop is mandatory,
  every recommendation shows its reasoning, the product is framed as an assistant, not a replacement
  (`gendd/specs/uc4-use-case.md`).

Note: `.cursor/rules/` target the JavaScript apps. The Python data engine follows its own
conventions, documented in `services/data-engine/README.md` and `services/data-engine/docs/`.

## Testing expectations

- See `context/quality-assurance.md`. Summary: only the Python data engine has tests (pytest); the
  JavaScript apps have none; continuous integration runs lint only.

## Danger zones

- The lint check is the only automated gate, so a pull request can break the data engine's tests
  without failing continuous integration. Reviewers must run `pytest -q` in `services/data-engine`
  for any change under `services/`.
- Large AI-generated pull requests: commit `5cad388` added about 10,700 lines in one change. Review
  them against the contracts and invariants in `context/architecture.md`, not line by line.
- Scope creep versus the guardrails: the data engine already includes optional C++, Julia, OCR, MCP
  and DuckDB back-ends. Adding more technology conflicts with `.cursor/rules/30-learning-and-safety.mdc`
  unless a mentor agrees.
- `Claude outputs/interns-project.zip` is tracked in git; binary archives in the repo are hard to
  review.

## Unknowns

- Unknown: who the mentors or approvers are, and who can approve promotions to `stg` and `main`.
- Unknown: whether branch protection described in `README.md` is actually configured on GitHub (it
  cannot be verified from the repo).
- Unknown: hackathon deadline and demo date, which drive what is in scope.
- Unknown: who the subject-matter expert is who must confirm the reconstructed trial rule
  (`services/data-engine/README.md`, "Honest limits").
- Unknown: whether `Claude outputs/interns-project.zip` should stay in the repo.
- Unknown: whether a changelog exists or where it should live (the Definition of Done requires a
  changelog entry; no `CHANGELOG.md` exists).
