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

## Linting

```bash
npm run lint
```

Runs each app's own ESLint config via `--workspaces`. This same command is what CI runs on every pull request.

## Branching model

- `dev` — everyone's feature branches merge here first
- `stg` — promoted from `dev` when it's ready to test
- `main` — promoted from `stg`; this is production

All three branches require a pull request, at least one approval, and a passing lint check before merging — no direct pushes. See the team's release pipeline guide for the full CI/branch-protection/deploy setup.
Edit for pr test
