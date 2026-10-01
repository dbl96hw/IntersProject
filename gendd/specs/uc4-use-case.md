# Syngenta Hackathon Context

Source: `syngenta_hackathon_context.md`, provided by the hackathon organisers and copied here on
2026-09-30 so product claims in the Context Pack are traceable to a file in the repo. Do not edit the
content below; add team interpretations in `context/product-management.md` instead.

## Syngenta in brief

Syngenta is a global agritech leader (HQ in Basel, Switzerland) whose purpose is to help farmers "grow more with less" as the world needs roughly 50% more food by 2050. Its business spans Crop Protection, Seeds, Biologicals, and Digital Farming.

- **Motto:** "Data is the new tractor". AI is used across the lab-to-field pipeline: faster R&D (genetic and chemical data analysis, candidate selection), supply chain optimization, and real-time farmer support.
- **Flagship platform:** Cropwise, a digital farmhand covering 100M+ hectares, with an open platform that lets third parties build apps on top of it.
- **What judges likely value:** simple conversational interfaces (e.g. WhatsApp, voice) for smallholders, sustainability and regenerative agriculture metrics, and solutions designed as modules/APIs that plug into the Cropwise ecosystem.

---

# Use Case 4: R&D Data Source Unification (MCP)

Primary persona: A senior plant breeder, typically with 30 or more years of experience, a non-technical background, and a working day spent mostly in spreadsheets and on paper. The job to be done: when deciding which candidate lines advance, they want the trial, lab and operational data in one place with a recommendation and its reasoning, so they can make the call without chasing five systems.

Success criteria: A working assistant that ingests the four mock data sources (trial, operations, lab/pedigree, germplasm), answers breeder questions in natural language, and returns a red/amber/green recommendation per candidate with a stated reason. Demo-ready means: show a flagged candidate with a one-line explanation the breeder can challenge and override, with the override logged.

Data: Anonymized mock tables with real column headers across the four sources, plus the pass/fail scoring logic.

Out of scope: Any connection to a live research system.

Non-negotiable constraints: A human in the loop is mandatory, not optional, because an earlier pilot left breeders wary of automated decisions. Every recommendation must show its reasoning, never just a verdict. Frame it as an assistant, not a replacement.

Problem statement: Plant breeders track trial, lab, and operational data across disconnected Excel sheets, PDFs, and WhatsApp messages, re-entering the same information multiple times, roughly doubling the breeding cycle length. Build an assistant that unifies the mock sources behind a natural-language interface and triages candidates red/amber/green with an explanation, always deferring the final call to the breeder.

What teams could build (but not limited to):
- A data-unification (MCP) layer over the mock sources
- Natural-language query interface for breeders
- Red-amber-green triage with explained recommendation and override/feedback loop
