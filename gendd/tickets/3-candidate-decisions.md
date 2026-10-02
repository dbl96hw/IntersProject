---
id: 3-candidate-decisions
title: Breeder colour overrides and pass / no pass decisions
status: ready-for-agent
blocked_by: []
trello:
---

## Problem

A breeder who disagrees with a line's colour, or who has decided pass or no pass, gets 501. They need the disagreement stored so a later read still shows the effective colour beside the engine colour. The breeder still makes the decision.

## Acceptance criteria

Engine and database are mocked. No network. Each criterion names its test level.

1. Given live mode and a stored red candidate, when PATCH sends `new_colour: AMBER` with a known reason, comment, and `user`, then `createOverride` is called once with that `candidate_id`, the response `colour` is `AMBER`, `engine_colour` stays `RED`, `overridden` is true, and `override` is the engine body. The review stores `user_name` and `engine_override_id` equal to the `id` returned by `POST /overrides`. Test level: integration.
2. Given PATCH with `reason_code: OTHER` and a blank comment, when it is sent, then the status is 400, `field` is `comment`, and the engine is not called. Test level: unit.
3. Given the engine rejects an unknown `reason_code` with 400 `VALIDATION_ERROR`, when PATCH includes `new_colour`, then that status, code, message, and field are returned unchanged and no review is inserted. Test level: integration.
4. Given the engine is unreachable, when PATCH includes `new_colour`, then the status is 502 `DATA_ENGINE_UNAVAILABLE` and no review is inserted. Test level: integration.
5. Given the engine accepts the override and the review insert then fails, when PATCH includes `new_colour`, then the response is that database error, the fake engine still has its override, and nothing tries to delete it. Test level: integration.
6. Given a successful override, when the candidate row is read from the database, then `colour`, `engine_colour`, `overridden`, and `override` are the persisted engine values, not only the HTTP body. Test level: integration.
7. Given that stored override, when `GET /api/candidates/:id` runs, then `colour` is the effective colour, `engine_colour` is the rule colour, and they are not the same field. Test level: integration.
8. Given a stored candidate, when POST decision sends `no_pass` and `user`, then `decision` is `no_pass`, `colour` and `engine_colour` are unchanged, and `createOverride` is not called. Test level: integration.
9. Given one override already stored, when a second PATCH sends a different colour, then both review rows remain and the response colour is the second one. Test level: integration.
10. Given mock mode, when PATCH or decision sends a valid body, then the status is still 501 `NOT_IMPLEMENTED`. Test level: integration (existing tests).

The backend never recomputes colour, verdict or evidence. `engine_colour` never changes because of an override. Engine field names stay as the engine sent them.

## Edge cases

- Empty: PATCH with neither `new_colour` nor `justification`, or a decision without `user`, is 400 and does not call the engine. A comment of `""` is valid unless the reason is `OTHER`.
- Maximum: no comment length is defined. This story does not add one.
- Unauthorised: there is no login. A missing `user` is the 400 above. The body `user` is not checked against an identity.
- Concurrent: two sequential overrides both remain in `candidate_reviews`. The engine file lock orders its own log. Express does not add a lock.

## Integration points

- Data engine: `POST /overrides` only when the body includes `new_colour`. The returned object's `id` is `OverrideLog.record`'s uuid, passed through `DataEngine.record_override` and `create_override`. `GET /overrides/reasons` is already mounted. No chat tool and no Claude.
- Supabase: existing `candidate_reviews` and the candidate columns `colour`, `engine_colour`, `overridden`, `override`. No new table.

## Out of scope

- Connecting the frontend to these routes. That is later, separate work.
- F1.4 field corrections (`POST /corrections`), the F4.4 disagreements panel, revert, and trial-level overrides.
- 9A ingest and explanations, `evidence.check.js`, the Python engine, and a 002 migration.

## Context pack

- `context/backend-development.md` — thin routes, forwarded engine errors, live versus mock.
- `gendd/architecture/components.md` — Express stores reviews and calls the engine.
- `docs/api-contract.md` and `services/data-engine/docs/CONTRACTS.md` ("Override").

## Known limitation

A justification-only PATCH is stored with `addReview` and shown by the mapping that already prefers `review_justification`. It is not the persistence guarantee. A colour change is: the engine log and the candidate row (`colour`, `engine_colour`, `overridden`, `override`) survive without the frontend remembering them. The contract still requires `reason_code` on a text-only edit. That code is not checked against the engine's list, because this path does not call the engine.

## Known risks

- On a host with an ephemeral disk (Render, Step 10), `.state/overrides.jsonl` disappears. The engine and `candidate_reviews` drift apart. The next `GET /api/candidates/:id` re-reads the engine and writes those fields back onto the row.
- After an engine restart, rows ingested in 9A are gone from memory. A stored override can name a candidate the engine no longer has.
- Without login, `user` is whatever the request body sends. It is not authenticated.

## Size

One story and one pull request. The review table, the engine client, and the request validation already exist. This story only stops returning 501 in live mode.
