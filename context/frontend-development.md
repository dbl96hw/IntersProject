# Context: Frontend Development

## Area and confidence

- Area id: `frontend-development`
- Confidence: HIGH

## Signals

- `apps/intersfrontend/package.json` depends on `react` and `react-dom` 18 and `vite` 5.
- `apps/intersfrontend/vite.config.js` and `apps/intersfrontend/index.html` (Vite entry).
- JSX components under `apps/intersfrontend/src/` (workspace UI added in PR #7, commit `ced1454`).
- `.cursor/rules/40-react-vite.mdc`, `50-frontend-api.mdc`, `90-component-reuse.mdc` target this app.

## What lives here

- Directories:
  - `apps/intersfrontend/src/pages/` - `Workspace.jsx` + `Workspace.css`, the only page.
  - `apps/intersfrontend/src/components/` - one component per file with a colocated CSS file:
    - Layout: `Sidebar` (new dashboard, recent dashboards, user badge), `Logo`, `LeafDecoration`,
      `PlantDecoration`.
    - Upload: `WelcomeView` (drag-and-drop / browse, file chips, "Create dashboard").
    - Triage: `DashboardView` (header, filters, sections, context menu, modal), `DashboardFilters`
      (search box + status chips with counts), `TriageSection` (one table per colour, expandable rows,
      "Overridden" badge), `RowContextMenu` (right-click "Edit row"), `EditCandidateModal` (crop, mean
      yield, justification, status, override reason, comment).
    - Chat: `ChatWidget` (floating widget; open, minimize, close, history, typing indicator).
  - `apps/intersfrontend/src/constants/` - re-exported from `index.js`:
    - `api.js` - `API_BASE_URL` (`VITE_API_URL`), `HEALTH_PATH`, `API_PATHS`, `CANDIDATES_PAGE_SIZE`.
    - `messages.js` - `APP_NAME` ("Git Push & Pray") and UI copy per area (`SIDEBAR_TEXT`,
      `WELCOME_TEXT`, `DASHBOARD_TEXT`, `FILTER_TEXT`, `EDIT_TEXT`, `CHAT_TEXT`).
    - `triage.js` - `TRIAGE_STATUS` (GREEN / AMBER / RED labelled Approved / Conditional / Not
      approved), `TRIAGE_STATUS_ORDER`, `STATUS_FILTER_ALL`, `TABLE_COLUMNS`, `OVERRIDE_REASONS`,
      `ACCEPTED_FILE_TYPES`, mock delays.
    - `decorations.js` - `LEAF_PATH`.
  - `apps/intersfrontend/src/mocks/` - `dashboards.js` (`MOCK_USER`, `RECENT_DASHBOARDS`,
    `createMockDashboard`). Chat replies are not mocked.
  - `apps/intersfrontend/src/styles/theme.css` - theme variables, imported in `main.jsx` before `index.css`.
- Entry points:
  - `apps/intersfrontend/index.html` -> `src/main.jsx` -> `src/App.jsx` -> `src/pages/Workspace.jsx`.
  - Run: `npm run dev:frontend` from the root (http://localhost:5173); build: `npm run build -w apps/intersfrontend`.
  - Configuration: `VITE_API_URL` (`apps/intersfrontend/.env.example`, default `http://localhost:3000`).
    `VITE_BREEDER_USER` is the name recorded on an override or a decision. It is not a login.

### Current behaviour

`GET /health` is called from `BackendStatus`. Recent dashboards are the first
`RECENT_DASHBOARD_LIMIT` chats from `GET /api/chats`. Opening one loads every page of
`GET /api/candidates?chat_id=` (`page_size` 100, cap `MAX_CANDIDATE_PAGES`). The chat widget posts
`{ text }` to `POST /api/chats/:id/messages` and shows `answer.text`. It starts minimized. With no
chat open it shows `chat-no-chat` and does not call the server.

- "Create dashboard" does not start an analysis. The welcome screen shows that file upload is coming
  soon (`data-testid="upload-coming-soon"`).
- A colour change sends `PATCH /api/candidates/:id`. Pass / no pass sends `POST /api/candidates/:id/decision`.
  The row becomes the `candidate` in the response. The screen does not move the colour itself.
- The chat shows the server answer as plain text (`white-space: pre-wrap`). A warning
  `ANSWER_UNVERIFIED_NUMBERS` on `answer.warnings` is a calm notice. There is no verified mark.
- Mock rows follow the engine's candidate row, plus two fields the engine does not return: `crop` and
  `mean_yield_t_ha` (`mocks/dashboards.js`).

### Built as mock versus pending wiring

Source for the target: `services/data-engine/docs/INTEGRATION.md` section 6 and `gendd/specs/feature-roadmap.md`.

| Screen | UI today | Pending (roadmap feature) |
|---|---|---|
| Triage tables | `GET /api/chats` and `GET /api/candidates` for the open chat | Evidence card (F1.3) |
| Evidence card | Row only expands the text | `GET /api/candidates/:id` → `engine_detail` (F1.3) |
| Override and decision modal | `PATCH /api/candidates/:id` and `POST /api/candidates/:id/decision`. Reasons from `GET /api/engine/override-reasons` | Crop and yield corrections (F1.4) |
| Chat | `POST /api/chats/:id/messages` with `{ text }` only. History stays on the server | Structured colour and evidence fields in the bubble (F2.1 remainder) |
| Upload | Built, files stay in the browser | `POST /api/chats/:id/messages` multipart (F4.2 / 9A) |
| Backend status | `GET /health` shows `mode` and `engine` | Live candidate list is still F1.2 |
| Trust panel, comparison, disagreements | Not built | F4.1, F4.3, F4.4 |

The backend implements `/api/*` per `docs/api-contract.md` and returns mock analysis in
`ANALYSIS_MODE=mock`. The UI can wire against mock mode before live ingest/explain is complete (Step 9A).
The old `/api/breeder/*` example router in `services/data-engine/clients/node/` is superseded.

## Conventions in force

- React function components, `useState` for local state, `useEffect` only for side effects, handle
  loading / empty / error states, plain CSS colocated, no Next.js APIs, no Redux, no Tailwind:
  `.cursor/rules/40-react-vite.mdc`.
- API calls with `fetch`, base URL from `import.meta.env.VITE_API_URL`, check `res.ok`, show a
  user-readable error: `.cursor/rules/50-frontend-api.mdc`.
- Reuse before creating; shared UI in `src/components/`; no UI libraries:
  `.cursor/rules/90-component-reuse.mdc`.
- Constants in `src/constants/`, never repeat literals: `.cursor/rules/95-shared-constants.mdc`.
  Status keys in `TRIAGE_STATUS` match the engine's `colour` values.
- `data-testid` on interactive elements and status messages: `.cursor/rules/80-testability-lite.mdc`
  (full list in `context/quality-assurance.md`).
- Naming (PascalCase component files, `handle*` handlers, kebab-case CSS classes):
  `.cursor/rules/20-naming-conventions.mdc`. Existing CSS uses BEM-style names (`triage-table__row`,
  `edit-modal__field`).
- Mock data lives only in `src/mocks/`; wired screens must not import from it.
- Lint: `apps/intersfrontend/eslint.config.js` (ESLint 9 flat config, `react`, `react-hooks`,
  `react-refresh`; `react/prop-types` off).

## Testing expectations

- Vitest and Testing Library. `npm test -w apps/intersfrontend`. Fetch is replaced in the test.
  Recorded in `gendd/adr/0001-frontend-tests-use-vitest.md`. See `context/quality-assurance.md`.
- Minimum today: `npm run lint` passes, and the `data-testid` attributes stay stable so a future
  end-to-end suite can target them.

## Danger zones

- The UI must never show a verdict without its reason, and must never let the product look like it
  decides for the breeder (`gendd/specs/uc4-use-case.md`, non-negotiable constraints). Every colour
  shown needs its `reason` or evidence next to it.
- When `overridden` is true, the row shows the engine reason and, separately, the breeder override
  (`override.reason_code` and `override.comment`) plus `engine_colour`.
- The UI must not compute scores or colours itself; it only displays what the server returned
  (`services/data-engine/docs/CONTRACTS.md`).
- Crop and mean yield are not fields on the candidate. Corrections for them are F1.4.
- `OTHER` without a comment is blocked in the modal and is not sent.
- Hardcoding `http://localhost:*` in components instead of `API_BASE_URL` breaks non-local environments.

## Unknowns

- Unknown: how "Create dashboard" and "Recent dashboards" map to the engine, which holds a single
  dataset (one dashboard per upload exists only in the mock).
- Unknown: whether a router will be added (none today; `App.jsx` renders `Workspace`).
- Unknown: the language of the UI copy (all copy is English today; the engine's system prompt replies
  in the breeder's language).
- Unknown: frontend test framework.
