# Demo script (UC4 Breeder's Desk)

About 6 minutes. Everything below runs on the real engine in live mode (see the root `README.md`).
Before starting: engine, backend (`ANALYSIS_MODE=live`) and frontend are running; `GET /health` shows
`engine: up`; the overrides log is clean; one chat with the 150 saved justifications exists (reuse makes
the upload fast).

| # | What the presenter does | What the audience sees | Why it matters |
|---|---|---|---|
| 1 | Open the app. Point at the status line. | Mode `live`, engine `up`. | Real data, not a mock. |
| 2 | **Create dashboard** with `trial_recommendations_synthetic.csv` and an off-topic file (any invoice PDF). | "Analyzing" (about 90 s the first time). Then 150 candidates: 54 Concerns, 71 Needs review, 25 Strong candidate. The files panel says the CSV was used and the invoice was not, with the reason. | Unification, and the relevance gate: off-topic files never reach Claude or the evidence. |
| 3 | Open a red row (for example `SYN-MZ-00001`). | One-line reason, the justification, evidence values with their source. | Every number comes from the engine; Claude only explains. |
| 4 | Right-click the row, change the colour, pick a reason, add a comment. | The row moves; "Overridden" badge; the engine colour stays visible. | The breeder decides; the override is logged with who, when and why. |
| 5 | In the chat: "How many lines are there per colour?" | Counts with digits, bold colours, in English. If an override was made in step 4, both the board count and the rule count are given. | The chat uses the same engine as the board. |
| 6 | In the chat: "Why is SYN-MZ-00001 red?" | Colour, reason, 2-5 cited values, the reminder that the breeder decides. A small notice may say some numbers could not be checked. | Honest about what is verified. |
| 7 | Optional: upload field notes (DOCX/PDF) that name a candidate. | That candidate (and the candidates of a named trial) appear, with the note as evidence. | Unstructured data joins the structured view. |

Do not upload `data/synthetic/uc4/archive/*` or `README.md`. Use one chat for overrides.

If something fails: an engine error is shown as a file "not used" with the engine's message; the engine
keeps serving the previous data. Restart order is engine, backend, frontend.
