---
id: f1-2-live-dashboard
title: Triage dashboard shows one chat's candidates
status: ready-for-agent
blocked_by: [f1-1-api-client]
trello:
---

## Problem

A breeder opening a dashboard still sees invented rows. They need the candidates stored for one chat, each colour with its reason, and a short list of recent chats instead of every test chat in the database. The breeder still decides. The screen does not recompute a colour.

## Acceptance criteria

No network. Fetch is replaced in the test. Each criterion names its test level.

1. Given `GET /api/chats` returns more than eight chats, newest `updated_at` first, when the sidebar is shown, then only the first eight are listed and a status shows how many are hidden. The limit is `RECENT_DASHBOARD_LIMIT` in `src/constants/`, not a literal in the component. Test level: integration.
2. Given a chat is selected, when its candidates span more than one page, then the client requests `GET /api/candidates?chat_id=` with `page_size=100` until the collected rows equal `total`. Test level: unit.
3. Given that list is in flight, when the dashboard is shown, then a loading status is visible. Test level: integration.
4. Given the list request fails, when the dashboard is shown, then an error message is visible and no candidate colour is shown. Test level: integration.
5. Given the selected chat has no candidates, when the dashboard is shown, then an empty status is visible. Test level: integration.
6. Given candidates of each colour, when the dashboard is shown, then the sections are red, then amber, then green (`TRIAGE_STATUS_ORDER`), and each shown colour has its `reason` on the same row. A row with no `reason` does not show a colour. Test level: integration.
7. Given a candidate with `ambiguous_trials` or `atypical` true, when the row is shown, then those flags are visible. Test level: integration.
8. Given a candidate with `justification_source` and `verified` false, when the row is shown, then both are visible as badges and the reason is still shown. Test level: integration.
9. Given the selected chat's latest analysis message has `warnings`, when the dashboard is shown, then those warnings are visible above the tables. Test level: integration.
10. Given the list response has no `crop` and no `mean_yield_t_ha`, when the table is shown, then those columns are absent. Test level: integration.

Search and the status chips keep filtering the rows already loaded. They do not send a new colour decision.

## Edge cases

- Empty: criterion 5. A chat list of zero chats shows the existing empty sidebar copy.
- Maximum: `page_size` stays at 100, the contract maximum. Eight chats are shown even if the response has more.
- Unauthorised: there is no login. This case does not apply.
- Concurrent: choosing another chat before the first list returns shows only the later chat's rows. Test level: integration.

## Integration points

- `GET /api/chats` and `GET /api/chats/:id` (messages, for the latest analysis warnings).
- `GET /api/candidates` with `chat_id`, `page` and `page_size`.
- No write endpoints. No engine call from the browser.

## Out of scope

- Overrides and pass / no pass (f1-5).
- The evidence card (F1.3). It stays out of this work.
- Live chat.
- File upload. A later pull request sends files to `POST /api/chats/:id/messages`, with a visible wait of about 90 seconds, the submit button disabled, no second submit, and no client abort.
- Asking the backend to cap or paginate `GET /api/chats`. The cap of eight is only in the screen.
- Copying a colour onto another chat's row.
- Backend, the Python engine, `evidence.check.js`, and the 9A upload flow.

## Context pack

- `context/frontend-development.md` — triage components, mocks, colour plus reason.
- `docs/api-contract.md` — Candidate, list query, chats.
- `gendd/adr/0001-frontend-tests-use-vitest.md`.

## Known risks

- The same `candidate_id` can exist on several chats. An override is stored on the engine by `candidate_id`, but Express writes `colour` and the review only on the row id in that request. `GET /api/candidates` does not re-read the engine. Another chat keeps the colour it stored until something calls `GET /api/candidates/:id` for that other row. Pass / no pass never reaches the engine, so it stays on the row that was decided. This story does not hide that and does not copy colours across chats. After an override, f1-5 paints the single row from the PATCH body.
- `GET /api/chats` returns every chat. The sidebar would be long without the limit of eight. The hidden count is the only hint that more exist.
- On a restart the engine can lose ingested rows. A stored chat can then disagree with the engine. This story shows the stored rows.

## Size

One story and one pull request, after f1-1. It replaces the mock dashboard list and the mock rows for the open chat. It does not add the edit modal's save.
