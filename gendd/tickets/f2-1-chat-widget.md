---
id: f2-1-chat-widget
title: Chat widget asks the live answer endpoint
status: ready-for-agent
blocked_by: [9b-chat-agent]
trello:
---

## Problem

The chat widget still replies from `getMockChatReply`. A breeder who asks a question in the browser does not see the engine-backed answer the backend now stores. The widget must not invent history: the backend reads saved messages itself.

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

- An answer can mention a colour the open chat's rows do not show, because overrides on the engine are global (see 9B).
- Search answers can mention ingested documents.

## Size

One session for the widget, after the backend answer path is in place.
