# Tickets (local mirror of the Trello board)

The team tracks work on Trello: <https://trello.com/b/ZSIH6hun/hackathon-project>. GenDD cannot talk
to Trello, so agents write stories here and a human copies them to the board. See `gendd/config.md`
(Tracker section).

## Flow

1. An agent (or a person) writes a ticket at `gendd/tickets/<slug>.md`.
2. A human creates the matching Trello card and pastes its URL into the `trello` field.
3. Status changes happen on Trello first; the `status` field here is updated to match.
4. When Trello and this folder disagree, Trello wins.

## Ticket format

```markdown
---
id: uc4-001
title: Show the candidate triage table
status: ready-for-agent   # ready-for-agent | in-review | blocked (or empty while in refinement)
blocked_by: []            # list of ticket ids
trello:                   # Trello card URL, filled in by a human
---

(story body: see gendd/definition-of-ready.md for what a ready story contains)

## Comments

- 2026-09-30T10:00Z (name): comment text
```

- Create: write a new file with the frontmatter above.
- Change status: edit the `status` field in place.
- Block: add the blocking ticket's id to `blocked_by`.
- Comment: append a timestamped line under `## Comments`.
