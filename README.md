# interns-project

A monorepo with two apps, managed as npm workspaces:

- `apps/intersbackend` — Node.js + Express API
- `apps/intersfrontend` — React + Vite frontend

## Requirements

- Node.js 20+
- npm 10+ (ships with recent Node; workspaces need npm 7+)

## Getting started

```bash
npm install          # installs both apps' dependencies from the root
npm run dev:backend  # starts the API on http://localhost:3000
npm run dev:frontend # in another terminal — starts the frontend on http://localhost:5173
```

The frontend reads the API's address from `VITE_API_URL` (see `apps/intersfrontend/.env.example`). It defaults to `http://localhost:3000` for local dev.

The data engine (Python) runs next to the API on port 8001; see `services/data-engine/README.md`. Start it a minute before a demo: its first build also compiles the native back-ends.

**If `npm install` fails on `xlsx`:** the backend takes SheetJS from `cdn.sheetjs.com` (the npm registry copy, 0.18.5, is outdated and has known security advisories, so do not switch to it). On a network that blocks that CDN, download `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` once on a machine that can reach it, save it as `apps/intersbackend/vendor/xlsx-0.20.3.tgz`, and point the dependency at `file:vendor/xlsx-0.20.3.tgz`.

## Linting

```bash
npm run lint
```

Runs each app's own ESLint config via `--workspaces`. This same command is what CI runs on every pull request.

## Branching model

- `dev` — everyone's feature branches merge here first
- `stg` — promoted from `dev` when it's ready to test
- `main` — promoted from `stg`; this is production

## Test
- Delete later

All three branches require a pull request, at least one approval, and a passing lint check before merging — no direct pushes. See the team's release pipeline guide for the full CI/branch-protection/deploy setup.
