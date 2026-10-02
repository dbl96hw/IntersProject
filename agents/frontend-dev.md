# Frontend Developer Playbook

## Quick Start

Read, in order:

1. `context/frontend-development.md` - what exists, what is still mock, and the contract gaps.
2. `gendd/specs/feature-roadmap.md` - Phase 1 features (F1.1 to F1.5) and their pending items.
3. `services/data-engine/docs/INTEGRATION.md` section 6 - what the UI must show.
4. `services/data-engine/docs/CONTRACTS.md` - the candidate row, evidence item and override shapes.
5. `.cursor/rules/40-react-vite.mdc`, `50-frontend-api.mdc`, `90-component-reuse.mdc`.

Day-to-day commands (from the repo root):

- `npm run dev:frontend` (http://localhost:5173) with `npm run dev:backend` running in another terminal.
- `npm run lint`
- `npm run build -w apps/intersfrontend`

## Role-Specific Context

- `apps/intersfrontend` is React 18 + Vite 5, JavaScript only, no router, no state library, plain CSS.
- Since PR #7 it renders a full breeder workspace (`pages/Workspace.jsx`): sidebar, upload view,
  colour-grouped triage tables, edit / override modal and a chat widget. Those screens call Express
  through `src/api/client.js`. `src/mocks/dashboards.js` remains, and the screens do not import it.
  The workspace health indicator (`BackendStatus`) was removed again in the UI refactor; `getHealth()`
  is still on the client.
- The UI talks to Express only (`API_BASE_URL` from `VITE_API_URL`) under `/api/*`.
- Further UI is listed as improvements in `gendd/specs/feature-roadmap.md`, not as work for this
  commit. The left panel does not rename or delete a chat.
- The user is a senior, non-technical plant breeder (`gendd/specs/uc4-use-case.md`): clear language,
  a one-line reason next to every colour, and an obvious way to disagree.
- The UI never computes colours or scores. It displays the engine's `colour` and `reason`. An
  overridden row also shows `override.reason_code` and `override.comment`, without a separate label.
  Corrections are not on the row yet (F1.4).

## Key Areas

- `apps/intersfrontend/src/pages/Workspace.jsx` - owns chats and the open dashboard, `handleSubmitFiles`
  (multipart upload) and `handleCandidateUpdated`. It stores `warnings` and `ingestion` and does not
  render them.
- `apps/intersfrontend/src/components/` - `DashboardView`, `TriageSection`, `DashboardFilters`,
  `RowContextMenu`, `EditCandidateModal`, `ChatWidget`, `WelcomeView`, `Sidebar`, decorations.
  `IngestionList` is unused.
- `apps/intersfrontend/src/constants/` - `triage.js` (`TRIAGE_STATUS`, `TABLE_COLUMNS`,
  `CANDIDATE_DECISIONS`), `messages.js` (UI copy, `APP_NAME`), `api.js` (`API_BASE_URL`,
  `API_PATHS.OVERRIDE_REASONS`). There is no recent-dashboard limit.
- `apps/intersfrontend/src/mocks/` - `dashboards.js` only (sample rows; no screen imports it). The chat
  mock (`chatReplies.js`) was removed when the widget went live.
- `apps/intersfrontend/src/styles/theme.css`, `apps/intersfrontend/eslint.config.js`,
  `apps/intersfrontend/.env.example`.

## Safe First Changes

These are improvements from `gendd/specs/feature-roadmap.md`, not required for the shipped workspace.

- Let the left panel rename a chat, and delete one (return to the welcome screen when it was open).
  There is no rename or delete route today.
- Render the stored ingestion list and analysis warnings. `IngestionList.jsx` is already in
  `src/components/`.
- Show `engine_colour` when `overridden` is true. The row currently shows the reason and the override
  code and comment, without a badge.

## Danger Zones

- Showing a colour without its reason. An overridden row shows the reason and the override code and
  comment, and does not show `engine_colour`. Showing `engine_colour` is an improvement, so do not
  treat the section colour as the engine's original colour.
- Sending edits to crop, mean yield or justification anywhere except the corrections endpoint
  (roadmap F1.4). Corrected values must be shown as breeder corrections next to the original.
- Wiring the table without resolving the `crop` / `mean_yield_t_ha` gap: the engine row has neither
  (roadmap F1.2).
- Keeping hardcoded `OVERRIDE_REASONS` after wiring: if they drift from the engine, overrides are rejected.
- Changing the section order (GREEN first today, engine sorts RED first) without a product decision.
- Designs that read as "the system decides" rather than "the assistant recommends, you decide".
- Hardcoded URLs instead of `API_BASE_URL`; putting secrets in `VITE_*` variables (they ship to the browser).
- Renaming or removing existing `data-testid`s (listed in `context/quality-assurance.md`).
- Adding UI libraries, Tailwind, a state library or TypeScript without a mentor
  (`.cursor/rules/30-learning-and-safety.mdc`).

## Checklists

**Before opening a pull request for a UI change:**
- [ ] Loading, empty and error states are visible in the UI, not only in the console.
- [ ] Interactive elements and status messages have `data-testid`; existing ids are unchanged.
- [ ] Every colour displayed has its reason next to it. An overridden row also shows the override code and comment. `engine_colour` on the row is an improvement, not part of this commit.
- [ ] Corrected values are marked as breeder corrections and the original stays available.
- [ ] API calls use `API_BASE_URL` and path constants; `res.ok` is checked before parsing.
- [ ] A screen wired to the API no longer imports from `src/mocks/`.
- [ ] Reused an existing component before creating a new one; new shared UI lives in `src/components/`.
- [ ] No `console.log` left behind; `npm run lint` passes.
- [ ] The feature's checklist items are updated in `gendd/specs/feature-roadmap.md`.
- [ ] The pull request targets `dev`.
