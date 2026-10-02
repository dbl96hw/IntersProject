# UC4 mock data, integrated V2 drop (Syngenta, 2026-10-02)

The 8 CSVs at the root of the zip "UC4 - R&D Data Source Unification" (marked "integrated V2 (fixed)"). The `[DEPRECATED]` folders of that zip are not used. Every row is synthetic (`IS_SYNTHETIC = TRUE` or the REMARK says so). This is the data engine's default input (`services/data-engine`, `DATA_ENGINE_DATA_DIR` overrides it).

| File | Rows | Content |
|---|---|---|
| `candidate_recommendations_synthetic.csv` | 150 | official candidate summary: RAG suggestion (`SYSTEM_RAG`), reason, caveats, empty `BREEDER_DECISION` |
| `germplasm_pedigree_synthetic.csv` | 152 | pedigree master: 150 candidates + 2 commercial checks |
| `genomics_synthetic.csv` | 152 | markers, genomic breeding value, QC |
| `lab_observations_synthetic.csv` | 456 | germination, cold test, fumonisin per material (3 traits × 152) |
| `trait_dictionary_synthetic.csv` | 6 | trait code, name, unit, scale, better direction |
| `trial_germplasm_bridge_synthetic.csv` | 1,728 | one row per trial entry: 72 trials × (6 candidates + 2 checks) × 3 replications |
| `observation_synthetic.csv` | 5,184 | plot values: yield, moisture, disease for every entry |
| `operations_field_updates_synthetic.csv` | 360 | 5 operations per trial: planned vs actual date, status, how it was recorded |

Files were renamed from `* 2.csv` / `* 3.csv` to `*.csv`; their content is unchanged. Findings: `services/data-engine/docs/FINDINGS.md`, section 0.
