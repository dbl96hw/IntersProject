# Definition of Done (team baseline)

Work is DONE when every line below is true. Nothing ships on a partial pass. While a pull request
is open for the work, its ticket carries the `in-review` status.

1. Every acceptance criterion is demonstrably satisfied, each mapped by name to a passing test.
2. Tests are green in continuous integration at every level the story named.
3. Coverage on changed files is at or above the threshold in `gendd/config.md` (currently: no
   threshold).
4. The Conventions axis of `gendd-code-review` reports no unresolved findings.
5. No new security finding at or above the severity bar in `gendd/config.md` (currently: Medium).
6. The Context Pack is updated wherever this change invalidated it.
7. A changelog entry is written.
8. Human validation is recorded: who confirmed, and when.

<!-- TODO(playbook): this baseline is an opinionated default written for the plugin's v1, pending the
     internal GenDD playbook. Edit freely; this file is the team's, not the platform's. -->
