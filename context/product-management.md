# Context: Product Management

## Area and confidence

- Area id: `product-management`
- Confidence: MANUAL

## Signals

- Supplied by a human: the hackathon use case, stored at `gendd/specs/uc4-use-case.md`.
- Supporting evidence in the repo: `services/data-engine/README.md` names the product "Breeder's Desk"
  (Syngenta x HatchWorks AI Hackathon 2026, Use Case 4).

## What lives here

- Directories:
  - `gendd/specs/` - the use case and future specs.
  - `gendd/tickets/` - local mirror of the Trello board (<https://trello.com/b/ZSIH6hun/hackathon-project>).
- Entry points:
  - `gendd/specs/uc4-use-case.md` - the source of every product claim below.

### Problem

Plant breeders track trial, lab and operational data across disconnected Excel sheets, PDFs and
WhatsApp messages, re-entering the same information and roughly doubling the breeding cycle.

### Primary persona

A senior plant breeder, 30+ years of experience, non-technical, working mostly in spreadsheets and on
paper. Job to be done: when deciding which candidate lines advance, see trial, lab and operational
data in one place with a recommendation and its reasoning, without chasing five systems.

### Success criteria and demo-ready definition

- Ingest the four mock sources (trial, operations, lab / pedigree, germplasm).
- Answer breeder questions in natural language.
- Return a red / amber / green recommendation per candidate with a stated reason.
- Demo-ready: show a flagged candidate with a one-line explanation the breeder can challenge and
  override, with the override logged.

### Non-negotiable constraints

- Human in the loop is mandatory (an earlier pilot left breeders wary of automated decisions).
- Every recommendation shows its reasoning, never just a verdict.
- Framed as an assistant, not a replacement.

### Out of scope

- Any connection to a live research system.

### What judges likely value

- Simple conversational interfaces (for example WhatsApp or voice), sustainability metrics, and
  solutions designed as modules / APIs that plug into Cropwise.

### Coverage of the use case today

- Implemented and pending features, by phase and priority, each with its checklist:
  `gendd/specs/feature-roadmap.md`. Phase 0 (data engine and scaffold) is done; the breeder-facing UI,
  the Express integration and the chat assistant are pending.

## Conventions in force

- Stories follow `gendd/definition-of-ready.md` (Gherkin acceptance criteria, test level per
  criterion, explicit out of scope) and are written to `gendd/tickets/`, then copied to Trello
  (`gendd/config.md`).

## Testing expectations

- See `context/quality-assurance.md`. The demo-ready definition above should become end-to-end
  acceptance criteria.

## Danger zones

- Any feature that lets the system decide without the breeder, or shows a colour without a reason,
  violates the non-negotiable constraints.
- The candidate rule `UC4_MATERIAL_V0` is the team's own proposal, not Syngenta's logic
  (`services/data-engine/README.md`, "Honest limits"); present it as such in the demo.
- Connecting to any live research system is out of scope.

## Unknowns

- Unknown: judging criteria and weights, demo length and format.
- Unknown: whether the demo includes a conversational channel beyond the web UI (for example WhatsApp
  or voice).
- Unknown: whether integration with Cropwise should be shown or only described.
- Unknown: the language(s) the breeder persona uses (English, Spanish, or both).
- Unknown: who acts as product owner for prioritisation on the Trello board.
