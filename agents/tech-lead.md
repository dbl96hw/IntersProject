# Tech Lead Playbook

## Quick Start

Read, in order:

1. `gendd/specs/uc4-use-case.md` - what the hackathon asks for and the non-negotiable constraints.
2. `context/architecture.md` - components, runtime shape, invariants.
3. `context/technical-leadership.md` - branching model, guardrails, open questions.
4. `services/data-engine/docs/CONTRACTS.md` and `services/data-engine/docs/INTEGRATION.md` - the
   contracts every component depends on.
5. `gendd/definition-of-ready.md` and `gendd/definition-of-done.md`.

Day-to-day commands (from the repo root unless noted):

- `npm install` (or `npm ci`), `npm run lint`
- `npm run dev:backend`, `npm run dev:frontend`
- `cd services/data-engine && pytest -q`
- `cd services/data-engine && python -m data_engine.evaluate --export-date 2026-09-29`
- `git fetch --all --prune`, then review pull requests against `dev`.

## Role-Specific Context

- Three components, two languages: React + Vite UI, Express API (JavaScript), Python data engine
  (FastAPI). Only the data engine is substantially built; the UI and Express wiring are the critical
  path to a demo (`context/architecture.md`, "Current state versus target").
- The team is interns learning the stack; `.cursor/rules/30-learning-and-safety.mdc` asks for the
  simplest change that works and no new frameworks without a mentor.
- The product must keep a human in the loop and always show its reasoning
  (`gendd/specs/uc4-use-case.md`). These are review criteria, not nice-to-haves.
- Continuous integration runs lint only (`.github/workflows/lint.yml`); Python tests must be run by
  hand in review.
- Work is tracked on Trello, mirrored in `gendd/tickets/` (`gendd/config.md`).

## Key Areas

- `services/data-engine/config/rules.yaml` - rule versions, thresholds and weights (decides colours).
- `services/data-engine/docs/` - design, contracts, integration, findings.
- `services/data-engine/src/data_engine/audit.py`, `api.py` (`POST /overrides`),
  `agent_tools.py` (`SYSTEM_PROMPT`, tool list without an override tool).
- `services/data-engine/clients/node/` - integration examples for Express.
- `apps/intersbackend/src/index.js`, `apps/intersfrontend/src/`.
- `.cursor/rules/*.mdc`, `.github/workflows/lint.yml`, `README.md` (branching model).
- `context/`, `agents/`, `gendd/`.

## Safe First Changes

- Resolve `Unknown:` lines in `context/*.md` by writing the answer in place.
- Write the first Architecture Decision Record in `gendd/adr/` (for example: the Python data engine
  as a separate service behind Express).
- Add a pytest job to continuous integration for `services/data-engine` (after agreeing the Python
  version).
- Break the demo-ready definition into stories in `gendd/tickets/` and copy them to Trello.

## Danger Zones

- Approving changes to `services/data-engine/config/rules.yaml` without a re-run of the evaluation
  report and a new rule version.
- Contract changes in `services/data-engine/docs/CONTRACTS.md` that are not coordinated across the
  UI, Express and agent loop.
- Any path that lets the agent write overrides or change a colour (breaks human in the loop).
- Large AI-generated pull requests merged on a green lint check alone (see `context/technical-leadership.md`).
- New frameworks or services that conflict with `.cursor/rules/30-learning-and-safety.mdc`.
- Secrets (`ANTHROPIC_API_KEY`) in committed files or in `VITE_*` variables.

## Checklists

**Before approving a pull request:**
- [ ] The change matches the story's acceptance criteria, not just its title.
- [ ] No area's `context/<areaId>.md` Danger Zones section is touched without an explicit note in the pull request.
- [ ] Tests exist at every level the story named, and they assert behaviour, not implementation detail.
- [ ] `npm run lint` passes; for changes under `services/`, `pytest -q` was run and the result is in the pull request.
- [ ] Every colour shown or returned still carries its reason or evidence; the breeder can still override.
- [ ] Overrides remain human-only, append-only, and never change `engine_colour`.
- [ ] Payload shapes match `services/data-engine/docs/CONTRACTS.md`, or the document is updated in the same pull request.
- [ ] Rule changes bump the rule version in `config/rules.yaml` and include the new evaluation numbers.
- [ ] No `.env`, API keys, tokens, or new binary archives are committed.
- [ ] The pull request targets `dev` (or is a promotion `dev` -> `stg` -> `main`).
- [ ] The Context Pack is updated if the change invalidated it.
- [ ] The feature's checklist items and Status are updated in `gendd/specs/feature-roadmap.md`.

**Before promoting `dev` to `stg` or `stg` to `main`:**
- [ ] The demo flow works end to end locally: triage table, candidate card with reason, override logged.
- [ ] Known `npm audit` findings at Medium or above are triaged (`gendd/config.md` severity bar).
