# Definition of Ready (team baseline)

A story is READY when every line below is true. A story that fails any line goes back to refinement.
A story that passes every line gets the `ready-for-agent` status (in `gendd/tickets/` and on the
Trello board); a story waiting on something outside the team gets `blocked`.

1. The problem is stated from the user's perspective in one or two sentences.
2. Every user-visible behaviour has at least one acceptance criterion in Gherkin form (Given / When / Then).
3. Edge cases are enumerated: the empty case, the maximum case, the unauthorised case, and the concurrent
   case, wherever each applies.
4. Integration points are flagged: every external system, API, queue, job, or shared table the story touches.
5. The Context Pack covers the area being changed: `gendd/architecture/components.md` names the
   component, and `context/<areaId>.md` for the relevant area covers the conventions and testing
   expectations involved.
6. Out of scope is stated explicitly.
7. The story is small enough for one agent session. If it is not, it is split first.
8. Each acceptance criterion names its test level: unit, integration, or end to end.

<!-- TODO(playbook): this baseline is an opinionated default written for the plugin's v1, pending the
     internal GenDD playbook. Edit freely; this file is the team's, not the platform's. -->
