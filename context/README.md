# Context Pack

Per-area context for humans and AI agents working in this repo. Each file follows the same shape:
area and confidence, signals, what lives here, conventions in force, testing expectations, danger
zones, and `Unknown:` lines a human still has to answer. Role playbooks live in `agents/`; GenDD
configuration lives in `gendd/`.

| Area | File | Confidence |
|---|---|---|
| Architecture | [architecture.md](architecture.md) | BASELINE |
| Technical leadership | [technical-leadership.md](technical-leadership.md) | BASELINE |
| Frontend development | [frontend-development.md](frontend-development.md) | HIGH |
| Backend development | [backend-development.md](backend-development.md) | HIGH |
| Quality assurance | [quality-assurance.md](quality-assurance.md) | MEDIUM |
| Product management | [product-management.md](product-management.md) | MANUAL |
| Security | [security.md](security.md) | LOW |

Confidence: HIGH, MEDIUM and LOW come from signals in the repo; BASELINE areas are always included;
MANUAL areas are based on material a human supplied (here, `gendd/specs/uc4-use-case.md`).

Areas not written because the repo shows no signal for them: database management (the data engine
only takes DuckDB snapshots, no schema or migrations), site reliability, release management (covered
in `technical-leadership.md`), user experience, technical writing, delivery management, support
engineering, fullstack development.

Roadmap: [gendd/specs/feature-roadmap.md](../gendd/specs/feature-roadmap.md) lists implemented and
pending features by phase and priority, each with its checklist.

Role playbooks: [agents/tech-lead.md](../agents/tech-lead.md),
[agents/qa-automation.md](../agents/qa-automation.md),
[agents/frontend-dev.md](../agents/frontend-dev.md),
[agents/backend-dev.md](../agents/backend-dev.md).
