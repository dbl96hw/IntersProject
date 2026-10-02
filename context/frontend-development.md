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
    - Layout: `Sidebar` (new dashboard, every chat from `GET /api/chats`, user badge; no rename or delete), `Logo`,
      `LeafDecoration`, `PlantDecoration`.
    - Upload: `WelcomeView` (drag-and-drop / browse, file chips inside the dropzone, "Create dashboard").
      While analysis runs, the greeting becomes the loading status and the browse and submit buttons hide.
    - Triage: `DashboardView` (filters, sections, context menu, modal; no dashboard title), `DashboardFilters`
      (search box + status chips with counts), `TriageSection` (one table per colour, expandable rows,
      justification, Decision column), `RowContextMenu` (right-click "Edit row"), `EditCandidateModal`
      (status, override-reason radios, comment, decision select). `IngestionList` is still in this folder
      and nothing imports it.
    - Chat: `ChatWidget` (floating widget; open, expand from the header, minimize, close, history, typing
      indicator).
  - `apps/intersfrontend/src/constants/` - re-exported from `index.js`:
    - `api.js` - `API_BASE_URL` (`VITE_API_URL`), `HEALTH_PATH`, `API_PATHS`, `CANDIDATES_PAGE_SIZE`.
    - `messages.js` - `APP_NAME` ("Git Push & Pray") and UI copy per area (`SIDEBAR_TEXT`,
      `WELCOME_TEXT`, `DASHBOARD_TEXT`, `FILTER_TEXT`, `EDIT_TEXT`, `CHAT_TEXT`).
    - `triage.js` - `TRIAGE_STATUS` (GREEN / AMBER / RED labelled Strong candidate / Needs review /
      Concerns), `TRIAGE_STATUS_ORDER` (green first), `STATUS_FILTER_ALL`, `TABLE_COLUMNS` (id, trials,
      justification, decision), `CANDIDATE_DECISIONS` (`pending` is display-only; `pass` and `no_pass`
      are sent), `ACCEPTED_FILE_TYPES`, upload size limits. There is no `dashboards.js` constants file
      and no recent-dashboard cap.
    - `decorations.js` - `LEAF_PATH`.
  - `apps/intersfrontend/src/mocks/` - `dashboards.js` (`RECENT_DASHBOARDS`, `createMockDashboard`).
    Wired screens do not import it. Chat replies are not mocked.
  - `apps/intersfrontend/src/styles/theme.css` - theme variables, imported in `main.jsx` before `index.css`.
- Entry points:
  - `apps/intersfrontend/index.html` -> `src/main.jsx` -> `src/App.jsx` -> `src/pages/Workspace.jsx`.
  - Run: `npm run dev:frontend` from the root (http://localhost:5173); build: `npm run build -w apps/intersfrontend`.
  - Configuration: `VITE_API_URL` (`apps/intersfrontend/.env.example`, default `http://localhost:3000`).
    `VITE_BREEDER_USER` is the name recorded on an override or a decision. It is not a login.

### Current behaviour

The workspace does not call `GET /health`. `getHealth()` remains on `src/api/client.js`. The sidebar
lists every chat from `GET /api/chats` and scrolls. Opening one loads every page of
`GET /api/candidates?chat_id=` (`page_size` 100, cap `MAX_CANDIDATE_PAGES`). The chat widget posts
`{ text }` to `POST /api/chats/:id/messages` and shows `answer.text`. It starts minimized: the header
(`chat-widget-header`) expands it, and the minus button is only there while it is open. With no
chat open it shows `chat-no-chat` and does not call the server.

- "Create dashboard" uploads the files: `POST /api/chats`, then `POST /api/chats/:id/messages` (multipart,
  one `files` field per file). While it runs, the greeting is `analysis-loading` (the analyzing sentence
  plus animated dots; three static dots when `prefers-reduced-motion` matches) and the browse and submit
  buttons are hidden. The request is never aborted (about 90 s for 150 candidates). On `status: "error"`
  the welcome screen shows `upload-error`. On success the new chat opens. `Workspace` still stores
  `analysis.warnings` and `analysis.ingestion`, and neither the dashboard nor the empty state renders
  them. Accepted types match the backend.
- One Save can send a colour change and a decision. A colour change sends `PATCH /api/candidates/:id`
  (reason required; `OTHER` requires a comment). Pass / no pass sends `POST /api/candidates/:id/decision`.
  Choosing Pending does not call the decision endpoint. The row becomes the last `candidate` returned.
  The screen does not move the colour itself. The Decision column shows Pass, No pass, or Pending.
  An overridden row shows `candidate.reason` and, when present, `override.reason_code` and
  `override.comment`. It does not show `engine_colour`, an Overridden badge, `ambiguous_trials`,
  `atypical`, `justification_source`, or an unverified badge.
- The chat shows the server answer as plain text (`white-space: pre-wrap`); only `**bold**` / `*bold*`
  become `<strong>` (`src/chatText.jsx`, React elements, never innerHTML). A warning
  `ANSWER_UNVERIFIED_NUMBERS` on `answer.warnings` is a calm notice. There is no verified mark.
- Mock rows follow the engine's candidate row, plus two fields the engine does not return: `crop` and
  `mean_yield_t_ha` (`mocks/dashboards.js`).

### Built versus later improvements

Source for the target: `services/data-engine/docs/INTEGRATION.md` section 6 and `gendd/specs/feature-roadmap.md`.

| Screen | UI today | Improvement |
|---|---|---|
| Left panel | Lists every chat. Selecting one opens it. The title comes from the uploaded file names | Rename a chat. Delete a chat, and return to the welcome screen when that chat was open |
| Triage tables | `GET /api/chats` and `GET /api/candidates` for the open chat. Columns: id, trials, justification, decision | Evidence card (F1.3). `engine_colour` and an Overridden badge on the row. `ambiguous_trials` and `atypical` on the row |
| Evidence card | Expanding a row wraps the justification text | `GET /api/candidates/:id` → `engine_detail` (F1.3) |
| Override and decision modal | One Save. `PATCH /api/candidates/:id` when the colour changes; `POST /api/candidates/:id/decision` for pass / no pass. Reasons are radios from `GET /api/engine/override-reasons` | Crop and yield corrections (F1.4) |
| Chat | `POST /api/chats/:id/messages` with `{ text }` only. History stays on the server. Header expands a minimized widget | Structured colour and evidence fields in the bubble (F2.1) |
| Upload | Multipart create-dashboard. Limits sit under the dropzone (`upload-limits`) | Show each file's ingestion result and analysis warnings |
| Backend status | Not rendered. `getHealth()` is unused by the workspace | Status indicator |
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
- When `overridden` is true, the row shows `candidate.reason` and, when `override` is present,
  `override.reason_code` and `override.comment`. It does not show `engine_colour` or an Overridden
  badge. Showing `engine_colour` beside the effective colour is an improvement
  (`gendd/specs/feature-roadmap.md`, Improvements). Do not treat the section colour as the engine's
  original colour.
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
