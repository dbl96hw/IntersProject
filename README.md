# interns-project

A monorepo with two apps, managed as npm workspaces:

- `apps/intersbackend` — Node.js + Express API
- `apps/intersfrontend` — React + Vite frontend

## Requirements

- Node.js 22.9+ (the backend uses `--env-file-if-exists`) and npm 10+
- Python 3.10+ for the data engine (`services/data-engine`)
- Optional: Tesseract OCR for scanned PDFs and images

## Getting started (mock mode)

```bash
npm install          # installs both apps' dependencies from the root
npm run dev:backend  # starts the API on http://localhost:3000
npm run dev:frontend # in another terminal — starts the frontend on http://localhost:5173
```

The frontend reads the API's address from `VITE_API_URL` (see `apps/intersfrontend/.env.example`). It defaults to `http://localhost:3000` for local dev.

## Running the full app (live mode)

Start the three parts in this order, each in its own terminal.

1. **Data engine** (port 8001). It loads the integrated V2 drop (`data/synthetic/uc4_v2`, the 8 root CSVs of Syngenta's 2-Oct zip) on start-up; the first start also compiles the native back-ends, so start it a minute early.
   ```bash
   cd services/data-engine
   python -m pip install -r requirements.txt
   python -m pip install -e .
   python -m uvicorn data_engine.api:app --port 8001
   ```
   Check `http://127.0.0.1:8001/health` (`"healthy": true, "candidates": 150`). On Windows use `python -m uvicorn`, because `uvicorn` alone may not be on the PATH.
2. **Backend** (port 3000). Copy `apps/intersbackend/.env.example` to `.env` and fill `ANTHROPIC_*` and `SUPABASE_*`. Keep `ANALYSIS_MODE=mock` in the file and switch to live only in the terminal:
   ```powershell
   $env:ANALYSIS_MODE="live"; npm run dev:backend      # PowerShell
   ```
   ```bash
   ANALYSIS_MODE=live npm run dev:backend              # bash
   ```
   Use `DATA_ENGINE_URL=http://127.0.0.1:8001`, not `localhost` (Node on Windows may try IPv6 first).
3. **Frontend** (port 5173): `npm run dev:frontend`. `VITE_BREEDER_USER` in `apps/intersfrontend/.env` is the name recorded on overrides; it is not a login.

Demo notes:

- **Create dashboard** uploads the files. `candidate_recommendations_synthetic.csv` (or any of the 8 V2 files) gives the 150 candidates: 65 Concerns, 53 Needs review, 32 Strong candidate, the same as Syngenta's `SYSTEM_RAG`. With 150 candidates the analysis takes about a minute and a half; Claude explains the first 30 (red first) and the rest show the engine's reason.
- Upload each file once, and use one chat for overrides: an engine override is global, but it is saved on the chat where it was made.
- Off-topic documents are refused by the engine's relevance gate and listed as "not used" with the reason. A document that names candidates or trials (for example field notes) adds those candidates to the dashboard.
- Do not upload the deprecated drops (`data/synthetic/uc4/`, the `[DEPRECATED]` folders of the zip) or `README.md`. They have other GUIDs; the engine no longer breaks on them, but they add unrelated rows.
- Engine overrides live in `services/data-engine/.state/overrides.jsonl` (or `DATA_ENGINE_STATE_DIR`). To start a demo clean, stop the engine, move that file out of the folder and start it again.

## Tests

```bash
npm test                                         # backend (node:test) and frontend (Vitest)
cd services/data-engine && python -m pytest -q   # data engine
```

CI runs lint and all three test suites on every pull request (`.github/workflows/`).

**If `npm install` fails on `xlsx`:** the backend takes SheetJS from `cdn.sheetjs.com` (the npm registry copy, 0.18.5, is outdated and has known security advisories, so do not switch to it). On a network that blocks that CDN, download `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` once on a machine that can reach it, save it as `apps/intersbackend/vendor/xlsx-0.20.3.tgz`, and point the dependency at `file:vendor/xlsx-0.20.3.tgz`.

## Linting

```bash
npm run lint
```

Runs each app's own ESLint config via `--workspaces`. CI runs it on every pull request, next to the tests.

## Branching model

- `dev` — everyone's feature branches merge here first
- `stg` — promoted from `dev` when it's ready to test
- `main` — promoted from `stg`; this is production

## Test
- Delete later

All three branches require a pull request, at least one approval, and passing lint and test checks before merging — no direct pushes. See the team's release pipeline guide for the full CI/branch-protection/deploy setup.
