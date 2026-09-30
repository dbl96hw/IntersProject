# Context: Security

## Area and confidence

- Area id: `security`
- Confidence: LOW

## Signals

- Secrets handling rules: `.cursor/rules/30-learning-and-safety.mdc`, `.cursor/rules/60-express-api.mdc`.
- CORS configuration in `apps/intersbackend/src/index.js` and
  `services/data-engine/src/data_engine/api.py`.
- File upload and SQL endpoints in `services/data-engine/src/data_engine/api.py`.
- Planned third-party API key (`ANTHROPIC_API_KEY`) in `services/data-engine/clients/node/agentLoop.example.js`.
- No authentication, authorisation, or security scanning exists; confidence is LOW.

## What lives here

- Directories: no dedicated security code; concerns are spread across the files below.
- Entry points:
  - `apps/intersbackend/src/index.js` - CORS restricted to `CORS_ORIGIN` (default
    `http://localhost:5173`).
  - `services/data-engine/src/data_engine/api.py`:
    - `CORSMiddleware(allow_origins=["*"])` - any origin can call the engine.
    - `POST /sql` - read-only by string check (one statement starting with `SELECT` / `WITH`),
      executed on an in-memory DuckDB connection (`engine.py` `sql`).
    - `POST /documents`, `POST /documents/base64` - untrusted files written to a temporary directory
      and parsed (PDF, Office, HTML, images).
    - `POST /overrides` - records `user` from the request body (default `"breeder"`); no identity check.
    - Unexpected errors return `INTERNAL_ERROR` without a stack trace; the trace is logged server-side.
  - `services/data-engine/src/data_engine/audit.py` - append-only JSON-Lines override log.

## Conventions in force

- Never commit `.env` files, passwords, tokens or API keys: `.cursor/rules/30-learning-and-safety.mdc`;
  `.env` and `.env.local` are gitignored (root `.gitignore`).
- Never log passwords or tokens; config from `process.env`: `.cursor/rules/60-express-api.mdc`.
- No stack traces in API responses: `.cursor/rules/70-api-contract.mdc`,
  `services/data-engine/docs/CONTRACTS.md` ("Errors").
- Security findings at Medium or above block the Definition of Done (`gendd/config.md`).
- Mock data only: every row is synthetic (`data/synthetic/uc4/README.md`); no live research system
  may be connected (`gendd/specs/uc4-use-case.md`).

## Testing expectations

- No security tests or scanners. See `context/quality-assurance.md`.

## Danger zones

- The data engine is unauthenticated and accepts any origin. Expose it only to the Express backend,
  never directly to the internet.
- Override records trust the `user` field sent by the client, so the audit log cannot prove who
  overrode a colour.
- Document parsing runs third-party parsers on untrusted input (PDF, DOCX, PPTX, HTML). The data
  engine sets no upload size limit; the only bound is the `express.json({ limit: '25mb' })` that
  `services/data-engine/docs/INTEGRATION.md` recommends for Express.
- `POST /sql` must stay on an in-memory connection; pointing it at a persistent database would turn the
  prefix check into the only barrier.
- `ANTHROPIC_API_KEY` must live in `.env` / the hosting secret store only, never in frontend code
  (anything under `VITE_*` is shipped to the browser).
- `npm ci` reported 4 known vulnerabilities (3 moderate, 1 high) in dependencies on 2026-09-29; with a
  Medium severity bar these block the Definition of Done until triaged (`npm audit`).

## Unknowns

- Unknown: whether breeder authentication is required for the demo, and how `user` on overrides will
  be identified.
- Unknown: the allowed origins for the data engine outside local development.
- Unknown: which security scanning (for example `npm audit`, `pip-audit`, GitHub Dependabot) the team
  will run, and where.
- Unknown: data-handling requirements from Syngenta beyond "mock data only".
