# Findings on the UC4 mock data

## 0. Integrated V2 drop (2026-10-02) — current data

Only the 8 CSVs at the root of the zip are used (`data/synthetic/uc4_v2/`); the `[DEPRECATED]` folders are ignored.

**Keys.** `MATERIAL_GUID` (the pedigree is the master: 152 materials = 150 candidates + 2 commercial checks), `TRAIT_GUID` (trait dictionary, 6 traits: yield, moisture, disease in the field; germination, cold test, fumonisin in the lab), `TRIAL_ENTRY_GUID` / `FIELD_ENTITY_ID` (trial-germplasm bridge: 72 trials × 24 entries = 1,728; 6 candidates + 2 checks × 3 replications per trial). Referential integrity is 100 % on all 10 reference paths the engine checks (bridge, observations, operations, lab, genomics and recommendations against the pedigree, the bridge and the dictionary).

**The official logic, reconstructed (150/150).** The suggestion is per candidate now:

| Tier | Criterion (field) | RED if (must-pass) | AMBER if (check) |
|---|---|---|---|
| Yield | `YIELD_VS_CHECK_PCT` | < 95 % | < 103 % |
| Disease | `DISEASE_SCORE_MEAN` | > 6.0 | > 4.0 |
| Fumonisin | `FUMONISIN_PPM` | > 4.0 | — |
| Moisture | `MOISTURE_PCT_MEAN` | — | > 23.0 (wording says "limit" above 25.0, still AMBER) |
| Germination | `GERMINATION_PCT` | — | < 90 % (wording says "minimum" below 85 %, still AMBER) |
| Marker | `MARKER_DISEASE_RESISTANCE` | — | SUSCEPTIBLE |
| Usable trials | `N_TRIALS_USED` | — | 1 ("only 1 usable trial"); 0 → AMBER "No field data yet (genotyped only)" |

GREEN otherwise ("Beats checks (x %) with all field and lab checks passing"). Thresholds live in `config/rules.yaml` (`candidate_rag`).

**Recomputed from raw data.** A trial is unusable for its candidates when its IRRIGATION operation was MISSED (the official caveat "1 trial(s) excluded: irrigation missed"). With that rule, the engine recomputes from the plots and the lab every number of the official summary: number of trials and usable trials (exact), yield vs checks as mean candidate yield ÷ mean check yield over the usable trials (≤ 0.05 points), disease and moisture means (≤ rounding), germination and fumonisin (≤ rounding). All 150 candidates agree, so the sources are joined correctly.

| Finding | Records | Root cause | What the engine does |
|---|---|---|---|
| No trial table in V2 | 72 trials | the TRIAL_GUIDs match none of the deprecated trial table | location unknown; year derived from the SOWING date; G×E cannot be assessed |
| BREEDER_DECISION empty | 150 | no decision recorded yet (system: 32 G / 53 A / 65 R) | the app records pass / no pass and overrides with a reason |
| Genotyped without trials | 2 (SYN-MZ-00149, 00150) | in pedigree and genomics, not in the bridge | AMBER "No field data yet" |
| Commercial checks | 2 (SYN-MZ-CHK01, CHK02) | ENTRY_ROLE_LID = CHECK | yield reference only, never triaged |
| Operations delayed | 11 | actual after planned date | reported |
| Operations missed | 5 (all IRRIGATION) | not done | trial excluded for its candidates (30 candidates) |
| Recorded off-system | 140 (paper 124, WhatsApp 11, PDF 5) | re-typed by hand | upload the original: the document pipeline reads it and links what it names |
| Pedigree parents empty | 152 | exported without values | lineage reported as unavailable |

# Findings on the 29-Sep drop (deprecated; kept as the fixture of the trial-level tests)

These findings were produced by the data engine as a **test run** on the Syngenta mock exports committed in `data/synthetic/uc4/`. Every number can be reproduced with:

```bash
python -m data_engine.evaluate --export-date 2026-09-29 --out report.json
```

## 1. The official scoring logic

| Criterion | Field | Threshold | Gap between OK / not-OK values |
|---|---|---|---|
| Yield | `YIELD_T_HA` | ≥ 9.0 t/ha | 8.90 – 9.14 |
| Moisture | `MOISTURE_PCT` | ≤ 22 % | 21.8 – 22.1 |
| Disease | `DISEASE_SCORE` | ≤ 5 | 4.9 – 5.2 |
| Genomic value | `GENOMIC_BREEDING_VALUE_MEAN` | ≥ 102 | 101.0 – 103.4 |

- These thresholds reproduce the official per-criterion rationale texts on 72/72 trials.
- **PASS** = all four criteria met **and** `RESISTANT_MATERIAL_PCT` > 40 %. This rule is exact (7/7).
- **FAIL vs HOLD cannot be decided from the flags.** Identical flag combinations receive different verdicts, so any flag-only rule tops out at 60/72 (Bayes ceiling).
- **It is decided by the size of the misses.**

| Rule | Parity | Out-of-sample |
|---|---|---|
| Yield gates FAIL | 55/72 | AUC 0.79 |
| Calibrated logistic model | — | AUC 0.91 ± 0.09 |
| Severity, equal weights, 1 cut | 68/72 | accuracy 0.90 ± 0.07 |
| **Severity, max-margin weights** | **72/72** | **accuracy 0.987 ± 0.035** |

- Weights (relative to yield): yield 1.00, disease 0.56, moisture 0.19, genomic value 0.08. The cut is 0.248.
- Only the yield and disease weights are stable across folds; moisture and genomic value may well be 0.
- In words: **a yield shortfall weighs about twice a disease excess.**
- The margin to the cut is thin (4e-5, trial SYN-TR-0004), so the SME should confirm the official weights.

**Root cause of the 4 trials the equal-weight rule missed.** All four are caused by the weighting:

| Trial | Official | What the data shows |
|---|---|---|
| SYN-TR-0022 | FAIL | a 33 % yield shortfall alone |
| SYN-TR-0036 | FAIL | a 30 % yield shortfall plus 3 % on genomic value |
| SYN-TR-0061 | HOLD | a 40 % disease excess alone |
| SYN-TR-0068 | HOLD | a 34 % disease excess plus 16 % moisture |

**Ambiguous trials, sent for breeder review** (out-of-fold P(FAIL) between 0.35 and 0.65): SYN-TR-0001, 0016, 0024, 0025, 0031, 0039, 0042, 0046, 0048, 0051, 0071.

## 2. Data-quality issues (categorised, root-caused, fixed where honest)

| Issue | Records | Root cause (measured) | Fix |
|---|---|---|---|
| Trial GBV mean ≠ mean of the observed materials | 64/72 trials | correlation between reported and recomputed values is −0.20: the summary is not derived from the observed materials | **applied**: recomputed value stored next to the original. The rules keep the reported one; recomputing drops parity 72 → 65, which shows the official verdicts used the reported values |
| Trial resistant % ≠ observed materials | 62/72 trials | correlation −0.13, same cause | **applied**: same treatment |
| Operation references a material not observed in that trial | 131/216 operations | in 131/131 cases the material is observed at the same location in a sibling trial: wrong trial key | **applied** (quarantine) + reassignment not unique (4–5 sibling trials each), so a human must decide |
| Operation year ≠ trial year | 144/216 | all dates fall in Apr–Sep 2026 whatever the trial year: they look like record timestamps | **applied**: flagged; seasonality feature removed from the model |
| Harvest/irrigation before planting | 6 trials | offsets are not physical (std 52 d) | **not fixable**: no imputation |
| PLANNED operations dated in the past | 114 | status not updated; 60 of their trials are COMPLETE | **proposed**: set to COMPLETED |
| Trials without a PLANTING operation | 20 | operations are sampled (3 per trial) | **not fixable** |
| Pedigree parents empty | 150 | columns exported without values | **not fixable**: lineage reported as unavailable |
| Lab traits only by GUID | 4 traits | no trait dictionary in the export | **not fixable**: names and units needed |
| One location-year per candidate | 150 | trial design | **not fixable**: G×E cannot be assessed |

What we can say in general about the mocks:

- The identifiers are contiguous counters with no gaps (SYN-MZ-00001..00150, SYN-TR-0001..0072). The GUIDs are sequential too.
- The data is internally consistent at the key level: no key is lost or orphaned.
- The candidate feature cloud has no persistent cluster structure (H0 persistent homology): it is one connected group.

## 3. Questions for the SME (Diganta Adhikari)

1. Is FAIL vs HOLD a weighted severity of the misses? What are the official weights? (Ours: yield 1, disease ~0.56.)
2. From which material set are the trial-level GBV mean and resistant share computed?
3. Is `OPERATION_DATE` the field date or the record's creation date? Are operations booked per trial or per location block?
4. What are the names, units and direction of the four lab traits?
5. Is advancement decided across locations and years in the real programme?
