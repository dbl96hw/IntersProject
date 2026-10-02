---
id: f2-1-chat-widget
title: Chat widget asks the live answer endpoint
status: ready-for-agent
blocked_by: [9b-chat-agent]
trello:
---

## Problem

The widget posts `{ text }` and shows the saved answer. It does not invent history: the backend reads saved messages itself. `src/mocks/chatReplies.js` is gone.

## Acceptance criteria

Each criterion names its test level. Fetch is replaced in the test. This story is not part of the backend pull request.

1. Given a chat is open, when the breeder sends a question, then the widget `POST`s `{ text }` only. It does not send a history array. The reply on screen is `assistant_message.answer.text`. Test level: component.
2. Given the welcome screen (no chat open), when the breeder tries to ask, then the widget shows a clear message and does not throw. The message has `data-testid="chat-no-chat"`. Test level: component.
3. Given the assistant message is `status: "error"`, when it is shown, then the widget shows `error.message` for `LLM_UNAVAILABLE`, `DATA_ENGINE_UNAVAILABLE`, `ANSWER_TIMEOUT` and `ANSWER_ROUND_LIMIT`. Test level: component.
4. Given `answer.warnings` contains `ANSWER_UNVERIFIED_NUMBERS`, when the answer is shown, then the text stays visible and the warning is visible. Test level: component.
5. Given mock mode, when the breeder asks, then the backend still returns the canned answer. The widget does not keep a second local reply path. Test level: component.
6. Given the widget is opened, when the page loads, then it starts minimized. A short read-only notice is visible: the chat cannot change a colour. Test level: component.

Candidate ids in the answer may be rendered as buttons that scroll to that row, only if that does not complicate the widget. If it does, leave the ids as plain text.

## Edge cases

- Empty: the welcome screen is criterion 2.
- Maximum: the widget does not trim history. The backend keeps the last `MAX_CHAT_HISTORY_MESSAGES`.
- Unauthorised: there is no login. A missing key is an error message, not a crash.
- Concurrent: the send control stays disabled while a question is in flight. Test level: component.

## Integration points

- `POST /api/chats/:id/messages` with `{ text }` and no files.
- `GET /api/chats/:id` when opening a chat, so earlier answers are on screen.
- No call to the data engine from the browser.

## Context pack

- `context/frontend-development.md`
- `docs/api-contract.md` (`answer.warnings`, `answer.versions`)
- `gendd/tickets/9b-chat-agent.md`

## Out of scope

- Backend `agent.service.ask` (already specified in 9B).
- File upload (F4.2).
- Override and decision controls.
- Computing colours in the widget.

## Decision

The widget always posts the question and renders the saved answer. It does not send history. On the welcome screen it shows `chat-no-chat` and does not call the API. Id-as-buttons is optional and only if it stays a small addition.

## Known risks

- (Fixed on `fix/demo-readiness`: the tool returns `total` and `truncated`.) `query_candidates` returned at most 20 rows, with no total and no truncated flag. A live answer said "20 red lines" when the rule colour count is 54.
- `apply_scoring` counts rule colour (RED 54). `query_candidates` filters effective colour after overrides (50 on that check). The chat can report both. On the widget check it said 54 / 71 / 25 while the open board showed 53 / 72 / 25.
- `ANSWER_UNVERIFIED_NUMBERS` is a partial net. It fired on 3 of 4 answers in the first live chat, including correct counts written as words (`dos`). Digits 1, 3, 4 and 5 can match another field and pass. The widget shows a calm notice when the warning is present and never a verified mark. No warning does not mean the numbers were checked.
- The chat uses the engine's effective colour, which is global. The board uses the colour saved on that chat. They can differ after an override in another chat.
- Ingested documents can appear in `search`. The chat is read-only, so the risk is misleading text.
- Switching chats while a question is in flight drops that answer; it is not painted on the new chat.
- `GET /api/chats/:id` returns warnings on `answer.warnings` (not on the message root). After reload, the SYN-MZ-00001 answer still showed the notice. The colour-count answer (12.0 s) had no notice; the line question (13.9 s) did. The welcome screen shows `chat-no-chat` and does not call the server. Candidate ids stay plain text.

## Size

One session for the widget, after the backend answer path is in place.
