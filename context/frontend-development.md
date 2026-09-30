# Context: Frontend Development

## Area and confidence

- Area id: `frontend-development`
- Confidence: HIGH

## Signals

- `apps/intersfrontend/package.json` depends on `react` and `react-dom` 18 and `vite` 5.
- `apps/intersfrontend/vite.config.js` and `apps/intersfrontend/index.html` (Vite entry).
- JSX components under `apps/intersfrontend/src/`.
- `.cursor/rules/40-react-vite.mdc`, `50-frontend-api.mdc`, `90-component-reuse.mdc` target this app.

## What lives here

- Directories:
  - `apps/intersfrontend/src/pages/` - route-level pages (`LandingPage.jsx` + `LandingPage.css`).
  - `apps/intersfrontend/src/components/` - reusable UI (`BrandBanner.jsx`, `SiteFooter.jsx`, each
    with a colocated CSS file).
  - `apps/intersfrontend/src/constants/` - `api.js` (`API_BASE_URL`, `HEALTH_PATH`), `messages.js`
    (`LANDING_TITLE`, `BACKEND_STATUS`), re-exported from `index.js`.
  - `apps/intersfrontend/src/assets/` - `hatchworks-banner.png`.
- Entry points:
  - `apps/intersfrontend/index.html` -> `src/main.jsx` -> `src/App.jsx` -> `src/pages/LandingPage.jsx`.
  - Run: `npm run dev:frontend` from the root (http://localhost:5173); build: `npm run build -w apps/intersfrontend`.
  - Configuration: `VITE_API_URL` (`apps/intersfrontend/.env.example`, default `http://localhost:3000`).

Current behaviour: `LandingPage.jsx` calls `GET {API_BASE_URL}/health` on mount and shows checking,
up, unhealthy or unreachable (`data-testid="health-status"`).

### Screens the product needs (not built yet)

Source: `services/data-engine/docs/INTEGRATION.md` section 6 and `gendd/specs/uc4-use-case.md`.

- Candidate triage table: `GET /api/breeder/candidates` - show `colour`, `reason`,
  `ambiguous_trials`, `atypical`.
- Candidate card: `GET /api/breeder/candidates/:id` - show `evidence[].statement`, `trials[]`
  (`explained_by_data`, `ambiguous`), `document_evidence[]`, `data_gaps`.
- Override form: reasons from `GET /api/breeder/override-reasons`, submit `POST /api/breeder/overrides`;
  show `engine_colour` next to `colour` when `overridden` is true.
- Trust panel: `GET /api/breeder/baseline` and `GET /api/breeder/quality`.
- Natural-language question box backed by the agent loop (endpoint name not defined yet).

These `/api/breeder/*` routes exist only in `services/data-engine/clients/node/breederRoutes.example.js`;
they are not mounted in `apps/intersbackend` yet.

## Conventions in force

- React function components, `useState` for local state, `useEffect` only for side effects, handle
  loading / empty / error states, plain CSS colocated, no Next.js APIs, no Redux, no Tailwind:
  `.cursor/rules/40-react-vite.mdc`.
- API calls with `fetch`, base URL from `import.meta.env.VITE_API_URL`, check `res.ok`, show a
  user-readable error: `.cursor/rules/50-frontend-api.mdc`.
- Reuse before creating; shared UI in `src/components/`; no UI libraries:
  `.cursor/rules/90-component-reuse.mdc`.
- Constants in `src/constants/`, never repeat literals: `.cursor/rules/95-shared-constants.mdc`.
- `data-testid` on interactive elements and status messages: `.cursor/rules/80-testability-lite.mdc`.
- Naming (PascalCase component files, `handle*` handlers, kebab-case CSS classes):
  `.cursor/rules/20-naming-conventions.mdc`. Existing CSS uses BEM-style names (`landing__title`).
- Lint: `apps/intersfrontend/eslint.config.js` (ESLint 9 flat config, `react`, `react-hooks`,
  `react-refresh`; `react/prop-types` off).

## Testing expectations

- No test framework or `test` script in `apps/intersfrontend/package.json`. See
  `context/quality-assurance.md`.
- Minimum today: `npm run lint` passes, and the `data-testid` attributes exist so a future end-to-end
  suite can target them.

## Danger zones

- The UI must never show a verdict without its reason, and must never let the product look like it
  decides for the breeder (`gendd/specs/uc4-use-case.md`, non-negotiable constraints). Every colour
  shown needs its `reason` or evidence next to it.
- When `overridden` is true, showing only `colour` hides that the engine disagreed; show
  `engine_colour` too (`services/data-engine/docs/INTEGRATION.md` section 6).
- The UI must not compute scores or colours itself; it only displays what the engine returned
  (`services/data-engine/docs/CONTRACTS.md`).
- Hardcoding `http://localhost:*` in components instead of `API_BASE_URL` breaks non-local environments.

## Unknowns

- Unknown: page layout, visual design and navigation for the breeder screens (no designs in the repo).
- Unknown: whether a router will be added (none today; `App.jsx` renders one page).
- Unknown: the language of the UI copy (the use case persona may prefer Spanish; the engine's system
  prompt replies in the breeder's language).
- Unknown: frontend test framework.
