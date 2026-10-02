---
id: f1-5-override-ui
title: Override a colour and record pass or no pass from the screen
status: ready-for-agent
blocked_by: [f1-2-live-dashboard]
trello:
---

## Problem

A breeder who disagrees with a colour, or who has decided pass or no pass, can only change the row inside the browser. A reload loses it, and the screen invents `overridden` by comparing colours. The breeder still decides. The screen must send the decision and then show the row the backend returned.

## Acceptance criteria

No network. Fetch is replaced in the test. Each criterion names its test level.

1. Given the override modal is opened, when it loads, then the reason list is the body of `GET /api/engine/override-reasons`, not a hardcoded list. Test level: integration.
2. Given a new colour, a reason, a comment and a non-empty user, when the breeder saves, then the client sends `PATCH /api/candidates/:id` with `new_colour`, `reason_code`, `comment` and `user`, and the row on screen becomes the `candidate` in the response, including `colour` and `engine_colour`. Test level: integration.
3. Given `overridden` is true, when the row is shown, then it stays in the section of `colour` and the value of `engine_colour` is visible beside it. Test level: integration.
4. Given pass or no pass and a non-empty user, when the breeder decides, then the client sends `POST /api/candidates/:id/decision` and the row shows the returned `decision` without a change to `colour` or `engine_colour` unless that same response changed them. Test level: integration.
5. Given the user field is empty, when the breeder saves a colour or a decision, then no request is sent and a validation message is visible. Test level: integration.
6. Given reason `OTHER` and a blank comment on a colour change, when the breeder saves, then no request is sent and the comment error is visible. Test level: integration.
7. Given the backend responds 400 or 501 with `{ error: { code, message, field } }`, when the breeder saves, then that message is visible and the row stays as it was. Test level: integration.
8. Given a successful PATCH, when the screen updates, then it does not copy that colour onto any other chat's rows and it does not recompute `overridden`. Test level: integration.
9. Given the modal, when it is shown, then crop and mean yield are not fields that can be saved. Test level: integration.

`user` is the editable value that starts from `VITE_BREEDER_USER`. It is not a login.

## Edge cases

- Empty: criterion 5. A comment of `""` is allowed when the reason is not `OTHER`.
- Maximum: no comment length is added. The backend does not define one.
- Unauthorised: there is no login. An empty user is criterion 5. The value is not checked against an identity.
- Concurrent: a second save is not sent while the first request is in flight. The button stays disabled. Test level: integration.

## Integration points

- `GET /api/engine/override-reasons`.
- `PATCH /api/candidates/:id` and `POST /api/candidates/:id/decision`.
- In mock mode those two writes return 501. The screen shows the error and does not change the row (criterion 7).
- The error table in `docs/api-contract.md` is updated so 501 is described as mock mode only. No backend code change.

## Out of scope

- The evidence card (F1.3).
- Field corrections for crop and mean yield (F1.4).
- Live chat.
- File upload. A later pull request sends files to `POST /api/chats/:id/messages`, with a visible wait of about 90 seconds, the submit button disabled, no second submit, and no client abort.
- Making an override appear on other chats. That limit is recorded on f1-2. This story paints only the row PATCH returned.
- A review history list. The contract exposes the current decision and the current `override`, not every past review.
- Backend, the Python engine, `evidence.check.js`, and the 9A upload flow.

## Context pack

- `context/frontend-development.md` — modal, override badge, `engine_colour`.
- `docs/api-contract.md` — PATCH, decision, override reasons, errors.
- `gendd/tickets/f1-2-live-dashboard.md` — the cross-chat colour limit.

## Known limitation

The cross-chat colour limit in f1-2 stays. This screen does not paper over it.

## Size

One story and one pull request, after f1-2.
