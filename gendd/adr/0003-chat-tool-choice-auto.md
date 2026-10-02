# Chat answers use tool_choice auto and check numbers

## Context

File justifications call Claude with a forced `tool_choice` (`submit_justifications`). That fits one known tool. A chat question can need any of the engine's read-only tools, and the model has to decide which.

`extractNumbers` in `evidence.check.js` pulls digit runs out of text. An id such as `SYN-MZ-00003` yields `3`. Spelled counts (`three`, `tres`) are not in that function; the justification checker looks for them separately and this path must not call `checkJustification`.

## Decision

`completeChat` sends `tool_choice: { type: "auto" }` and the tool list from `GET /tools`. Justifications keep the forced tool. The system prompt is the engine's, stored as `versions.chat_prompt: "engine"`. `getPromptVersions` stays the analysis shape (`explanation_prompt`, `rule_version`, `model`) and does not gain `chat_prompt`.

Before an answer is saved, digits are taken with `extractNumbers` only after ids are removed, and spelled counts in `NUMBER_WORDS` are compared with the same tool JSON. A miss adds `ANSWER_UNVERIFIED_NUMBERS` and the text is still returned. The chat agent does not call a tool whose name looks like a write.

The loop also stops at `MAX_TOOL_ROUNDS` (6) and at `CHAT_QUESTION_DEADLINE_MS` (90 seconds, `ANSWER_TIMEOUT`).

## Consequences

An answer can warn on a number the tools did not return, including when the model called no tool. Digits that exist only inside `SYN-MZ-00003` do not warn and do not count as evidence for the number 3. Words outside `NUMBER_WORDS` are not checked. Analysis messages are unchanged.

## Status

accepted
