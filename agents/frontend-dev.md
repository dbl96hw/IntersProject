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
  colour-grouped triage tables, edit / override modal and a chat widget. Everything runs on mock data
  from `src/mocks/`; there is no `fetch` call anywhere, and the old health check was removed.
- The UI talks to Express only (`API_BASE_URL` from `VITE_API_URL`), which proxies the data engine
  under `/api/breeder/*` once `services/data-engine/clients/node/breederRoutes.example.js` is wired in.
- The main job now is to replace each mock with its API call, one screen at a time.
- The user is a senior, non-technical plant breeder (`gendd/specs/uc4-use-case.md`): clear language,
  a one-line reason next to every colour, and an obvious way to disagree.
- The UI never computes colours or scores. It displays the engine's values, the breeder's overrides
  and the breeder's corrections, each marked as such.

## Key Areas

- `apps/intersfrontend/src/pages/Workspace.jsx` - owns dashboards state, `handleSubmitFiles` (mock
  upload) and `handleUpdateCandidate` (local edits and overrides).
- `apps/intersfrontend/src/components/` - `DashboardView`, `TriageSection`, `DashboardFilters`,
  `RowContextMenu`, `EditCandidateModal`, `ChatWidget`, `WelcomeView`, `Sidebar`, decorations.
- `apps/intersfrontend/src/constants/` - `triage.js` (`TRIAGE_STATUS`, `OVERRIDE_REASONS`,
  `TABLE_COLUMNS`, mock delays), `messages.js` (UI copy, `APP_NAME`), `api.js` (`API_BASE_URL`).
- `apps/intersfrontend/src/mocks/` - `dashboards.js`, `chatReplies.js`; the things to replace.
- `apps/intersfrontend/src/styles/theme.css`, `apps/intersfrontend/eslint.config.js`,
  `apps/intersfrontend/.env.example`.

## Safe First Changes

- Add path constants to `src/constants/api.js` and a small fetch helper that checks `res.ok` and reads
  the `{"error": {...}}` shape (roadmap F1.1).
- Replace one mock with its API call: for example, load `OVERRIDE_REASONS` from
  `GET /api/breeder/override-reasons` in `EditCandidateModal`, with loading and error states.
- Show `engine_colour` next to the "Overridden" badge in `TriageSection`.
- Make the comment required when the override reason is `OTHER`.

## Danger Zones

- Showing a colour without its reason, or hiding that a colour was overridden (show `engine_colour`
  next to `colour` when `overridden` is true).
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
- [ ] Every colour displayed has its reason or evidence next to it; overridden items show both colours.
- [ ] Corrected values are marked as breeder corrections and the original stays available.
- [ ] API calls use `API_BASE_URL` and path constants; `res.ok` is checked before parsing.
- [ ] A screen wired to the API no longer imports from `src/mocks/`.
- [ ] Reused an existing component before creating a new one; new shared UI lives in `src/components/`.
- [ ] No `console.log` left behind; `npm run lint` passes.
- [ ] The feature's checklist items are updated in `gendd/specs/feature-roadmap.md`.
- [ ] The pull request targets `dev`.
