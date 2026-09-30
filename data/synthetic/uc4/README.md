# UC4 mock data (Syngenta, hackathon 2026)

Anonymized / synthetic exports provided by Syngenta for **Use Case 4: R&D Data Source Unification**. Every row is flagged as synthetic (`IS_SYNTHETIC = TRUE` or `REMARK = "SYNTHETIC — hackathon mock data"`). No real Syngenta data is stored here.

**Why they are in the repo:** they were committed as **test fixtures for `services/data-engine`**. The engine's tests, the evaluation report and the findings in `services/data-engine/docs/FINDINGS.md` were produced from exactly these files, so anyone who clones the repo can reproduce them with one command:

```bash
cd services/data-engine && python -m data_engine.evaluate --export-date 2026-09-29
```

| File | Rows | Content |
|---|---|---|
| `trial_synthetic.csv` | 72 | trial master |
| `trial_recommendations_synthetic.csv` | 72 | trial-level phenotype summary + official PASS/HOLD/FAIL verdict and rationale (`RULE_VERSION = SYNTH_V1`) |
| `operations_synthetic.csv` | 216 | planting / irrigation / harvest operations |
| `lab_observations_synthetic.csv` | 360 | lab trait values per material (trait identified by `TRAIT_GUID` only) |
| `observation_synthetic.csv` | 720 | plot observations linking trial × material × location |
| `germplasm_pedigree_synthetic.csv` | 150 | germplasm / pedigree master (pedigree columns are empty) |
| `genomics_synthetic.csv` | 150 | marker calls, genomic breeding value, QC |
| `archive/2026-09-28/` | — | first drop (different observation schema), kept to test schema-drift detection |

The files of the 2026-09-29 drop were renamed from `* 1.csv` to `*.csv`; their content is unchanged. Known data issues are documented in `services/data-engine/docs/FINDINGS.md`. The engine reports them and never modifies these files.
