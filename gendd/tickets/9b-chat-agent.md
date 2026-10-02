---
id: 9b-chat-agent
title: Live text questions are answered with engine tools
status: ready-for-agent
blocked_by: []
trello:
---

## Problem

A breeder asks a question in a chat with no file attached. In live mode the chat used to answer that analysis is not implemented. The breeder needs an answer that uses the engine's tools, cites only numbers those tools returned, and does not change any colour.

## Acceptance criteria

Each criterion names its test level. Engine and Claude are mocked. No network.

1. Given live mode and a text-only message, when the model calls `query_candidates` and then answers, then the assistant message is `kind: "answer"`, `status: "ok"`, the text is saved, `tool_calls` lists that tool, and `usage` sums every Claude call. Test level: unit.
2. Given the model keeps asking for tools, when the loop reaches `MAX_TOOL_ROUNDS` (6), then there is no seventh Claude call and the message is `status: "error"` with code `ANSWER_ROUND_LIMIT`. Test level: unit.
3. Given the question runs longer than `CHAT_QUESTION_DEADLINE_MS` (90 seconds), when the deadline passes, then the message is `status: "error"` with code `ANSWER_TIMEOUT`. Test level: unit.
4. Given saved messages on the chat, when a new question is sent, then Claude receives the prior user texts and successful answers from the database. Messages of `kind: "analysis"` are left out. The browser does not send history. Test level: integration.
5. Given the answer names `SYN-MZ-00003` and no other number, when no tool result is required to back an id, then there is no `ANSWER_UNVERIFIED_NUMBERS` warning. A digit that exists only inside an id does not count as backing a bare number. Test level: unit.
6. Given a number that appears in this question's tool JSON, when the answer repeats it, then there is no warning. Given a number that does not appear, when the answer uses it, then the text is still returned and `warnings` contains `ANSWER_UNVERIFIED_NUMBERS` with `file` null. Given numbers and zero tool calls, the same warning is present. Test level: unit.
7. Given `ANTHROPIC_API_KEY` is missing, when the question is asked, then the message is `LLM_UNAVAILABLE` with a clear message and Claude is not called. Test level: unit.
8. Given `GET /tools` fails because the engine is down, when the question is asked, then the message is `status: "error"` with code `DATA_ENGINE_UNAVAILABLE`. Test level: unit.
9. Given a tool returns a 400, when the loop continues, then that error is sent back to the model as a tool result. It is not replaced with a made-up answer. Test level: unit.
10. Given the model asks for an override tool, when the loop runs, then `runTool` is not called for that name. The tool list has no override tool. Test level: unit.
11. Given a successful answer, when it is saved, then `versions` is `{ explanation_prompt: null, rule_version, model, chat_prompt: "engine" }`. `rule_version` is taken from a tool result when one is present. `getPromptVersions` still returns only `explanation_prompt`, `rule_version` and `model` for file analysis. Test level: unit.
12. Given mock mode, when the breeder asks a question, then the canned answer is unchanged. Test level: integration (existing test).

The backend never recomputes colour, verdict or evidence. `src/llm/evidence.check.js` is not modified. The number check reuses `extractNumbers` and `normaliseNumber` only.

## Edge cases

- Empty: a question with no prior messages sends only that question. Test level: integration.
- Maximum: six tool rounds (criterion 2) and 90 seconds (criterion 3). History sent to Claude is at most `MAX_CHAT_HISTORY_MESSAGES` (6) prior bubbles.
- Unauthorised: there is no breeder login. A missing API key is criterion 7.
- Concurrent: two questions in the same chat are not coordinated beyond the order they are saved. This case does not add a lock.

## Integration points

- Data engine: `GET /tools` (tool definitions and the system prompt) and `POST /tools/:name`. No new engine route.
- Claude: `completeChat` with `tool_choice: { type: "auto" }`. Model stays the configured `ANTHROPIC_MODEL` (`claude-haiku-4-5-20251001` in `.env.example`). Justifications keep forced `tool_choice`.
- Postgres columns already in `supabase/migrations/001_init.sql` (`usage`, `versions`, `tool_calls`, `analysis`). Warnings for an answer are stored in the existing `analysis` jsonb and returned on `answer.warnings`. No new migration.

## Context pack

- `context/backend-development.md`
- `docs/api-contract.md`
- `services/data-engine/docs/INTEGRATION.md` section 3
- `gendd/adr/0003-chat-tool-choice-auto.md`

## Out of scope

- The chat widget (F2.1, a later pull request). It does not send history.
- File upload and `explainAll` (9A).
- `PATCH /api/candidates/:id` and `POST /api/candidates/:id/decision`.
- Editing `evidence.check.js` or the Python engine.
- Streaming, and cancelling a question from the browser.

## Decision

History has one source: messages already saved on that chat. The backend ignores `kind: "analysis"`. The system prompt is the string from `GET /tools`, recorded as `versions.chat_prompt: "engine"`. Numbers in the answer are checked against this question's tool JSON. An id is not a number. A spelled count (`tres`, `three`) is not seen by `extractNumbers`; the answer check still warns when that word is not in the tool results. The text is shown either way.

## Known risks

- The engine applies overrides globally. A chat answer can describe a colour that another chat's saved rows do not show yet.
- `search` can return sentences from ingested documents, not only candidate and trial rows.
- A number written only as a word is invisible to `extractNumbers`. The answer warning covers `NUMBER_WORDS`. Other words (`eleven`, `once`) are not in that set.
- The 90 second deadline can fire while a single Claude call is still inside its own timeout. The message is then `ANSWER_TIMEOUT`.
- (Fixed on `fix/demo-readiness`: the tool now returns `total`, `returned` and `truncated`.) `query_candidates` returned a bare list. The default limit is 20. The payload has no total and no truncated flag (`CONTRACTS.md` documents the candidate row, not a wrapper). A live answer counted that page and said there were 20 red lines. `apply_scoring` already returns colour counts for every candidate (rule colour RED 54 on this dataset). With `limit` 200 the same filter returned 50 rows, because overrides had moved some lines off red. The chat can report the page instead of either figure.
- On the first live chat, `ANSWER_UNVERIFIED_NUMBERS` fired on 3 of 4 answers. Two of those were the word `dos` for a count the text had already named. The third answer, about data quality, did not warn.
- A later widget check asked for colour counts and got rule colours 54 / 71 / 25 with no warning, while that chat's board showed 53 / 72 / 25. The follow-up about SYN-MZ-00001 warned, and `GET /api/chats/:id` still returned that warning on `answer.warnings` after reload.
- Small digits can match a different field and pass with no warning. On the red page, 5 is `n_trials` on every row, 3 and 4 are `n_fail` and also sit inside `reason`, and 4 is the digit in `rule_version` `UC4_MATERIAL_V0`. On one candidate context, 1 appears inside trial strings. An answer can cite 1, 3, 4 or 5 from the wrong place and still look backed.

## Size

One session for the backend path, tests, contract and ADR. The widget is a separate pull request.
