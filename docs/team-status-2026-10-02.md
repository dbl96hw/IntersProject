# Team status — Breeder's Desk (UC4), 2026-10-02

Branch `fix/demo-readiness` (on top of `dev` 233a6aa). Pull it, restart the engine and the backend, and run the demo from it. Do not merge into `dev` until the team agrees.

## 1. New data: the integrated V2 drop

- The engine now loads **only the 8 CSVs at the root of Syngenta's zip** ("integrated V2 (fixed)"), copied to `data/synthetic/uc4_v2/`. The `[DEPRECATED]` folders are ignored. The 29-Sep drop (`data/synthetic/uc4/`) is kept only as the fixture of the trial-level tests.
- **Keys:** `MATERIAL_GUID` (the pedigree is the master: 152 = 150 candidates + 2 commercial checks), `TRAIT_GUID` (trait dictionary, 6 traits), `TRIAL_ENTRY_GUID` / `FIELD_ENTITY_ID` (trial-germplasm bridge: 72 trials, 1,728 entries). **Referential integrity 100 %** on the 10 reference paths the engine checks on every build.
- **Official logic reproduced 150/150.** The official suggestion is now per candidate (`SYSTEM_RAG`: 32 green, 53 amber, 65 red). Rule (thresholds in `services/data-engine/config/rules.yaml`, `candidate_rag`):
  - RED if a must-pass fails: yield vs checks < 95 %, disease > 6.0, fumonisin > 4.0.
  - AMBER if a check fails: yield vs checks < 103 %, disease > 4.0, moisture > 23.0, germination < 90 %, susceptible disease marker, only 1 usable trial, or no field data.
  - GREEN otherwise.
- **Every number of the official summary is recomputed from the plots and the lab** (trials, usable trials, yield vs checks, disease, moisture, germination, fumonisin). All 150 candidates agree within rounding. A trial is unusable when its irrigation was missed, exactly as the official caveat says.
- **Findings** (also in `services/data-engine/docs/FINDINGS.md`, section 0, and `GET /quality`):
  - There is no V2 trial table, and its TRIAL_GUIDs match none of the deprecated one, so trial location and year are unknown. The year is derived from the sowing date.
  - `BREEDER_DECISION` is empty for all 150 candidates. This is the gap the app closes.
  - 2 lines are genotyped but in no trial (SYN-MZ-00149, 00150). They stay AMBER: "No field data yet".
  - 2 commercial checks (CHK01, CHK02). They are only the yield reference and are never triaged.
  - Operations: 11 delayed, 5 missed (all irrigation, which excludes the trial for 30 candidates), and 140 recorded on paper, PDF or WhatsApp.
- What the app shows now:
  - Uploading `candidate_recommendations_synthetic.csv` (or any V2 file) gives the 150 candidates with Syngenta's colours.
  - "Trials failed/total" is the candidate's per-trial result with the official thresholds. This is an engine view, because V2 has no trial verdicts.
  - The commercial checks never appear as candidates.

## 2. Fixes from the handoff list

| Area | What changed |
|---|---|
| Engine stability | An upload that fails is rolled back and answered `accepted: false`. Before, one bad file (the old archive) made every later ingest fail with 500 until a restart. |
| Re-uploads | Exports win. Identical rows are ignored, contradicting rows are counted as conflicts and never applied, and readable ids stay unique. |
| Documents | A PDF / DOCX that names candidates or trials adds those candidates, checked against the engine. Before, a document alone classified nothing. Off-topic files are refused by the relevance gate, with the reason. |
| Chat | Answers in English. Counts come from `apply_scoring` (rule colour and effective colour after overrides). `query_candidates` returns `total` / `truncated`. Numbers are written in digits. **Bold** is rendered safely. |
| Upload screen | "Create dashboard" works. It shows "Analyzing" while it runs, then the new dashboard, with each file listed as used or not used and why. |
| Warnings | Near-duplicate Claude notes are shown once. |
| CI / docs | `.github/workflows/test.yml` runs pytest, node:test and Vitest. There is a root README runbook, a demo script (`gendd/specs/demo-script.md`) and an updated roadmap. |

## 3. Verification

| Check | Result |
|---|---|
| Data engine | 101 tests in the cloud; 100 pass and 1 is skipped (no Tesseract) on the dev VM |
| Backend | 153 tests (`node --test`) |
| Frontend | 47 tests (Vitest); eslint clean and `vite build` OK |

End to end, on the real engine and the real Express app in live mode (in-memory DB, Claude stood in):

- V2 recommendations: 150 candidates, 32 / 53 / 65.
- Bridge: 148 candidates; the checks are excluded.
- Field notes DOCX: 8 candidates.
- Invoice: refused, with its reason.
- Chat: correct counts, in English, with bold.

## 4. How to run (details in the root README)

1. Engine: `cd services/data-engine && python -m uvicorn data_engine.api:app --port 8001`. Check `/health`: `candidates: 150, trials: 72, profile: v2`.
2. Backend: `$env:ANALYSIS_MODE="live"; npm run dev:backend`, with `DATA_ENGINE_URL=http://127.0.0.1:8001`.
3. Frontend: `npm run dev:frontend`.

Start them in this order. Upload V2 files only, and use one chat for overrides.

## 5. Still open

- Clean the test data: the engine overrides log and Supabase reviews and chats. Keep one chat with the 150 saved justifications.
- Warmup, Render, and rotating the API keys.
- Decide whether the demo runs locally or on `stg`.
- Pick an e2e runner with the mentor.
- Showing `mean_yield_t_ha` in the table needs a Supabase column.
- Persist the engine state and build a Docker image with OCR.

## 6. State of the art (what the system is)

```
files (CSV/XLSX, PDF/scan/DOCX/photo) ─► Express ─► data engine (Python)
                                              │        ├ relevance gate (is it about breeding?)
                                              │        ├ detect source by header signature (12 sources, 2 drops)
                                              │        ├ reconcile uploads with exports (exports win)
                                              │        ├ canonical model + referential integrity + recomputation
                                              │        ├ deterministic rules → colour + cited evidence (150/150)
                                              │        ├ quality issues with root cause and fix status
                                              │        └ spectral model (atypical / similar), diagnostics, audit log
                                              ├─► Claude: explains (never decides), chat through read-only engine tools
                                              └─► React UI: dashboard, overrides with reason, decisions, chat
```

The engine decides the colour and the breeder has the last word. Claude only explains, citing the engine's numbers.
