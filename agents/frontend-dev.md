# Frontend Developer Playbook

## Quick Start

Read, in order:

1. `context/frontend-development.md` - what exists and the screens the product needs.
2. `services/data-engine/docs/INTEGRATION.md` section 6 - what the UI must show.
3. `services/data-engine/docs/CONTRACTS.md` - the candidate row, evidence item and override shapes.
4. `.cursor/rules/40-react-vite.mdc`, `50-frontend-api.mdc`, `90-component-reuse.mdc`.

Day-to-day commands (from the repo root):

- `npm run dev:frontend` (http://localhost:5173) with `npm run dev:backend` running in another terminal.
- `npm run lint`
- `npm run build -w apps/intersfrontend`

## Role-Specific Context

- `apps/intersfrontend` is React 18 + Vite 5, JavaScript only, no router, no state library, plain CSS.
  Today it renders a landing page that checks `GET /health` on the Express backend.
- The UI talks to Express only (`API_BASE_URL` from `VITE_API_URL`), which proxies the data engine
  under `/api/breeder/*` once `services/data-engine/clients/node/breederRoutes.example.js` is wired in.
- The user is a senior, non-technical plant breeder (`gendd/specs/uc4-use-case.md`): clear language,
  a one-line reason next to every colour, and an obvious way to disagree.
- The UI never computes colours or scores; it displays the engine's values and the breeder's overrides.

## Key Areas

- `apps/intersfrontend/src/pages/` - pages (`LandingPage.jsx`).
- `apps/intersfrontend/src/components/` - shared UI (`BrandBanner.jsx`, `SiteFooter.jsx`).
- `apps/intersfrontend/src/constants/` - `api.js`, `messages.js`, `index.js`.
- `apps/intersfrontend/eslint.config.js`, `apps/intersfrontend/.env.example`.
- Pattern to copy: the fetch + status handling in `LandingPage.jsx`.

## Safe First Changes

- Add a new path constant and message strings in `src/constants/` for a breeder screen.
- Build a read-only candidate triage table against mocked JSON shaped like the candidate row in
  `services/data-engine/docs/CONTRACTS.md`, with loading, empty and error states and `data-testid`s.
- Extract a small shared status or colour badge component once it is used in two places.

## Danger Zones

- Showing a colour without its reason, or hiding that a colour was overridden (show `engine_colour`
  next to `colour` when `overridden` is true).
- Designs that read as "the system decides" rather than "the assistant recommends, you decide".
- Hardcoded URLs instead of `API_BASE_URL`; putting secrets in `VITE_*` variables (they ship to the browser).
- Adding UI libraries, Tailwind, a state library or TypeScript without a mentor
  (`.cursor/rules/30-learning-and-safety.mdc`).

## Checklists

**Before opening a pull request for a UI change:**
- [ ] Loading, empty and error states are visible in the UI, not only in the console.
- [ ] Interactive elements and status messages have `data-testid`.
- [ ] Every colour displayed has its reason or evidence next to it; overridden items show both colours.
- [ ] API calls use `API_BASE_URL` and path constants; `res.ok` is checked before parsing.
- [ ] Reused an existing component before creating a new one; new shared UI lives in `src/components/`.
- [ ] No `console.log` left behind; `npm run lint` passes.
- [ ] The pull request targets `dev`.
