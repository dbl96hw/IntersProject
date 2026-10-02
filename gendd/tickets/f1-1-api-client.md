---
id: f1-1-api-client
title: Frontend API client and backend status
status: ready-for-agent
blocked_by: []
trello:
---

## Problem

A breeder opening the workspace cannot tell whether the backend and the data engine are reachable, and the screen has no shared way to call the API. The breeder still decides pass or no pass. The screen only shows what the backend returns.

## Acceptance criteria

No network. Fetch is replaced in the test. Each criterion names its test level.

1. Given a path and a 200 JSON body, when the client requests that path, then the returned value is that body and the request URL is the base URL from `src/constants/api.js` plus the path. Test level: unit.
2. Given a response that is not ok and a body `{ error: { code, message, field } }`, when the client requests it, then the rejection carries that code, message and field. Test level: unit.
3. Given the request fails before a response, when the client requests a path, then the rejection has a code, a message and `field` null. Test level: unit.
4. Given `GET /health` has not answered yet, when the workspace is shown, then a loading status is visible. Test level: integration.
5. Given `GET /health` returns `mode` and `engine`, when the workspace is shown, then both values are visible. Test level: integration.
6. Given `GET /health` cannot be reached, when the workspace is shown, then an error message is visible. Test level: integration.
7. Given `GET /health` returns `mode` `"mock"`, when the workspace is shown, then a mock-mode notice is visible. Test level: integration.
8. Given the welcome screen, when it is shown, then a status says file upload is coming soon, and Create dashboard does not start an analysis. Test level: integration.

The client does not rename engine fields. It does not decide a colour.

## Edge cases

- Empty: a non-ok response with no JSON body is still a rejection, with `field` null. Covered by the same error path as criterion 2.
- Maximum: health is one small JSON object. No limit is added here.
- Unauthorised: there is no login. This case does not apply.
- Concurrent: a second health request is not sent. One request runs when the workspace opens.

## Integration points

- Express `GET /health` only. The body is `{ healthy, mode, engine }` as in `docs/api-contract.md`.
- Base URL: `VITE_API_URL`, read only in `src/constants/api.js`.

## Out of scope

- Listing chats or candidates, overrides, and pass / no pass (f1-2 and f1-5).
- The evidence card (F1.3).
- Live chat.
- Sending files. A later pull request will post them to `POST /api/chats/:id/messages`. That wait stays visible for about 90 seconds, with the submit button disabled, no second submit, and no client abort. This story only shows that the upload is not available yet.
- Backend, the Python engine, `evidence.check.js`, and the 9A upload flow.

## Context pack

- `context/frontend-development.md` — fetch, `VITE_API_URL`, loading / error, `data-testid`.
- `docs/api-contract.md` — errors and `GET /health`.
- `gendd/adr/0001-frontend-tests-use-vitest.md` and `gendd/adr/0002-backend-tests-use-node-test.md`.

## Known limitation

Create dashboard does not upload. Recent dashboards on this story are still the mock list. The live list is f1-2.

## Size

One story and one pull request. The helper, the status line, and the coming-soon status are the whole change.
