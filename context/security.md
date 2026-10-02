# Context: Security

## Area and confidence

- Area id: `security`
- Confidence: LOW

## Signals

- `apps/intersbackend/src/config/env.js` — validates env; live mode requires API and Supabase keys.
- `apps/intersbackend/.env.example` — documents variable names only.
- `supabase/migrations/001_init.sql` — RLS enabled on tables with **no policies** (service role only).
- `apps/intersbackend/src/middleware/upload.js` — `MAX_FILE_MB`, `MAX_FILES`.
- `apps/intersbackend/src/llm/claude.client.js` — API error logging redacts key substring; no prompt/body logs.
- No authentication on Express or engine; confidence remains LOW.

## What lives here

- **Express:** CORS to `CORS_ORIGIN`; JSON limit 25mb; multer upload limits. No auth middleware.
  Breeder `user` on reviews/overrides is client-supplied text.
- **Secrets:** `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never in frontend
  (`VITE_*` is public). **Rotate keys before the demo** if they were used in shared environments.
- **Supabase:** Service role bypasses RLS; only backend uses it. Storage bucket for uploads.
- **Data engine:** Open CORS locally; unauthenticated overrides; document parsing on untrusted uploads;
  read-only SQL on in-memory DuckDB. Must stay behind Express in deployment.
- **Logging:** Do not log secrets, prompts, or file contents. Claude logs model/tool/tokens/cost only.

## Conventions in force

- Never commit `.env`: `.cursor/rules/30-learning-and-safety.mdc`.
- Team error shape without stack traces in responses.
- DoD security bar Medium (`gendd/config.md`).

## Testing expectations

- No dedicated security test suite. See `context/quality-assurance.md`.

## Danger zones

- Exposing port 8001 (engine) or Supabase service role to the browser.
- Trusting `user` on override/review payloads for audit proof.
- Document bombs / oversized uploads — limits exist but are not pen-tested.
- `npm audit` triage still open for demo gate (F3.1).

## Unknowns

- Unknown: breeder authentication for demo vs post-hackathon.
- Unknown: allowed origins for engine in staging/production.
- Unknown: Syngenta data-handling requirements beyond mock-only data.
- Unknown: automated dependency scanning in CI.
