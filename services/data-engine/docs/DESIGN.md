# Design rationale

The engine is one argument, carried out in order. Each step says what it assumes, what it guarantees, and which test checks it (`tests/`). The diagnostics re-measure every identity on the real data on each run (`/diagnostics`, `runs/*.json`).

## 0. Principle: deterministic first

Wherever an exact answer exists, it is computed exactly:

- source detection is a set-inclusion question;
- zero-information columns have entropy exactly 0;
- thresholds are comparisons;
- a PDF text layer is read, not OCR'd.

Statistics are used only where the data is genuinely uncertain, and there they qualify a decision instead of making one. This order minimises errors and hallucinations, it reduces token and compute cost, and it keeps every output auditable.

## 1. Resources: measure the machine, then plan (`system`, `parallel`, `accel`)

**Hardware profile.** The engine takes a hardware profile of the machine:

- usable CPUs: affinity and the cgroup CPU quota;
- physical cores: floating-point-bound loops scale with cores, not hyper-threads;
- available RAM, capped by the cgroup memory limit;
- a memory budget: a fraction of the available RAM (default 50 %).

**Time model.** T(p) = c·p + T₁(s + (1 − s)/p), where:

- the serial fraction s is derived rather than guessed: for threads it is the GIL-bound share of the work, for processes a small constant;
- the continuous optimum is p\* = √(T₁(1 − s)/c).

**Memory model.** Each in-flight task holds about m_i = expansion(kind)·bytes_i, so p ≤ ⌊B / max m_i⌋, with B the memory budget.

**Decision.**

- p ∈ [1, min(CPUs, tasks, p_mem)].
- The engine leaves the inline path only when the predicted gain is ≥ 20 %. That margin absorbs model error.
- On the mocks the policy stays inline. The measurement agrees: 50 ms inline vs 57 ms with 2 threads, i.e. a Karp–Flatt serial fraction of 1.25.
- Tests: RAM-limited and CPU-limited plans.

**Native code.**

- C++ splits the query rows over `std::thread`s, one per physical core.
- Julia's thread count is fixed at start-up, so it is set from the same probe before Julia loads.
- NumPy's GEMM blocks are sized from the RAM budget.
- All back-ends return identical results (tested with 1 and 3 threads).

## 2. Documents: exact text first, OCR only where there is none (`documents`)

- A page is OCR'd only if its text layer has fewer than 25 characters.
- The OCR confidence (Tesseract's mean word confidence) is reported, so low-quality scans are visible.
- OCR pages run in parallel. Tesseract runs out of process, so threads work, with `OMP_THREAD_LIMIT=1` to avoid oversubscribing cores.
- The C++ back-end calls Poppler and the Tesseract API in-process, with one Tesseract instance per thread. Tests check that C++ and Python produce the same text.
- Document tables go through the same header detection and source signatures as the CSVs.
- **Exports always win.** This holds for every upload, document tables and records posted to `/ingest/records` alike. An uploaded row whose key exists in an export is never merged: identical values are ignored (re-uploading is idempotent), different values are stored as a conflict (evidence), and new keys are added once. This is tested.

## 2b. Relevance gate: is this file about breeding at all? (`relevance`)

Before a document is indexed, and before Express pays Claude to extract from it, the file is classified RELEVANT / UNCERTAIN / IRRELEVANT.

- **Rules first.** A mention of an id or GUID the engine holds, an id with the learned id grammar (`SYN-MZ-\d{5}`), or a table whose header matches a source signature makes the file RELEVANT with probability 1. These are exact facts, not estimates.
- **Then a small, auditable model** on two features. (i) Lexicon density: weighted English/Spanish breeding terms per 100 words, `log(1 + d)`. (ii) A few-shot contrast `delta = s_in - s_off`: `s_*` is the mean of the top-3 cosine similarities between the file's character n-gram TF-IDF vector (n = 3..5, accents folded, digits mapped to 0) and the labelled in-domain / off-topic examples. Character n-grams handle two languages, OCR errors and inflection without a tokenizer. The subtraction cancels the language component that every text shares, so `delta` measures topic. The query is projected onto the examples' vocabulary, so long files are not penalised for words the examples never used.
- **Fit.** Logistic regression with an L2 penalty, solved by Newton/IRLS (strictly convex, so the minimiser is unique and there is no random start). Training features are leave-one-out: an example is never compared with itself.
- **Honest error.** Nested leave-one-out holds each example out of both the reference corpus and the fit (`GET /relevance/model`). On the shipped 48 examples (22 in-domain, 26 off-topic) it makes no wrong decision; the hard cases fall into UNCERTAIN. The tests add 14 texts the model never saw.
- **UNCERTAIN is a feature.** The file is indexed and flagged `needs_review`, so a person decides. Only IRRELEVANT is refused, and `force` overrides it.

## 3. Renormalization: remove zero-information degrees of freedom (`profile`)

Each column is treated as a discrete random variable, with "missing" as one more symbol.

- H = 0 exactly when the column is constant (all-empty included), so dropping it is lossless: 200 → 54 columns.
- This is a coarse-graining with no approximation: the only degrees of freedom removed are the ones carrying zero information.
- The per-candidate payload sent to the LLM drops by ~95 %.

## 4. Identifier combinatorics (`patterns`)

- Characters map to classes (A-Z → `A`, a-z → `a`, digits → `9`) and to integer codes.
- For each family of values sharing a shape:
  - per-position entropy separates the fixed prefix from the varying part;
  - capacity = ∏|Σᵢ| over the varying positions (for example, SYN-MZ-\d{5} holds 10⁵ IDs, of which 0.15 % are used).
- A numeric counter is checked for **gaps**, which are records that exist upstream but are missing from the export.
- GUIDs are analysed in hex. The mock GUIDs turn out to be sequential, i.e. generated by a counter.
- The learned format regexes are used to find IDs inside PDFs, chats and HTML.

## 5. Canonical model and data quality (`canonical`, `quality`)

**Canonical model.** Key aliases (GID → MATERIAL_GUID, …) are mapped into a star schema.

**Issue records.** Every issue is recorded with its category, root cause (backed by a measurement), fix status, impact and SME question.

**Fix policy.**
- *Applied* fixes are derived and reversible: recomputed columns next to the originals, quarantine flags, feature exclusions.
- *Proposed* fixes need a human.
- *Not fixable* issues are reported, never guessed.

**Evidence that the policy is right.** Recomputing the trial aggregates from the observed materials drops parity from 72 to 65. So the official verdicts were computed on the reported summaries, and the rules must keep using them. This is tested.

**Quality gates feed the models.** Operation dates contradict the trial year in 144/216 records, so the planting-date seasonality feature is excluded from the calibrated model instead of fitting noise.

## 6. Encoding by symmetry group (`encode`)

| Variable | Group that preserves its meaning | Encoding |
|---|---|---|
| Continuous | affine x ↦ ax + b | z-score (quotient by the affine action) |
| Nominal (k categories) | S_k | projection onto the **standard irrep** (Helmert basis, k − 1 dims) |
| Ordinal | order only | centred, scaled ranks |
| Cyclic (day of year) | U(1) | Fourier irreps (cos mθ, sin mθ), m ≤ M |

- **Nominal:** one-hot = trivial ⊕ standard. The trivial part duplicates the intercept. Helmert removes it isometrically: categories stay equidistant (√2), and relabelling acts orthogonally. Tested.
- **Ordinal:** S_k would throw away the order, so the group, and therefore the encoding, is smaller.
- **Cyclic:** Dec 31 and Jan 1 are neighbours in the encoding; unknown phase maps to the origin, which is the mean of the uniform measure on U(1).

## 7. Spectral layer (`spectral`)

We use X = U S Vᵀ, the SVD of the centred data. XᵀX is never formed, because κ(XᵀX) = κ(X)².

- **Certified truncation (Eckart–Young–Mirsky).** ‖X − X_k‖²_F = Σ_{i>k} sᵢ² exactly. The measured error equals the certified one to 1e-17.
- **Diagonal algebra.** Conjugation by V is an algebra isomorphism from the commutative algebra generated by Σ onto the diagonal matrices ≅ ℝᵏ with the pointwise product (spectral theorem / functional calculus). So f(Σ) = V f(Λ) Vᵀ for any f: whitening and Mahalanobis distances are element-wise operations on the eigenvalues, and no inverse is ever formed. This matches an explicit pseudo-inverse to 1e-15.
- **Round trip.** Diagonalising and coming back is exact: ‖X − U S Vᵀ‖/‖X‖ ≈ 2e-15, and U and V are orthogonal to 1e-15.
- **Monitoring.** Hotelling T² on the retained subspace and Q on the residual. The mean and covariance are estimated from the same n points being screened, so the exact limit is a Beta: T²·n/(n−1)² ~ Beta(k/2, (n−k−1)/2) (Tracy, Young & Mason 1992). χ² is only its large-n limit.
- **Explanations in original units.** T² = xᵀMx decomposes exactly into the per-feature terms x_j (Mx)_j (tested), so explanations use original features, never the rotated basis.
- **Scope.** This layer flags atypical candidates and finds similar ones; it never sets a colour.

## 8. From model to rule (`calibrate`, `rules`)

1. **Ceiling.** No deterministic function of the pass/fail flags can exceed (1/N) Σ_x max_y N(x, y) = 60/72.
2. **Discovery.** A logistic model with the scaler fitted *inside* each fold (no leakage), evaluated out-of-fold with 5-fold × 20 CV: AUC 0.91 vs 0.79 for the yield gate. The coefficients say that the *magnitude* of the yield and disease misses matters.
3. **Distillation.** Severity = Σ wᵢ · max(0, relative shortfallᵢ).
   - With equal weights and one tuned cut: 68/72, CV accuracy 0.90.
   - Root-cause analysis attributes all four misses to the weighting.
   - The weights and cut are taken as the maximum-margin linear separator of the shortfall vectors (hard-margin SVM, the most robust separator when the classes are separable), refit on training folds only for the CV estimate.
   - Result: 72/72, CV accuracy 0.987 ± 0.035.
   - The weight intervals across folds show that only yield (1.0) and disease (~0.56) are supported; moisture and genomic value are not distinguishable from 0.
4. **Human in the loop.** Trials with out-of-fold P(FAIL) ∈ [0.35, 0.65], or with severity near the cut, are marked *ambiguous* and go to the breeder.

## 9. Verification of every run (`telemetry`, `diagnostics`)

- **Per stage:** wall and CPU time (CPU/wall > 1 means real parallelism), resident memory, and optionally the exact Python-heap peak.
- **Numerical checks:** SVD round trip, orthogonality, eigen-equation residual, Eckart–Young identity, whitening, Mahalanobis vs pseudo-inverse, T² decomposition, Helmert orthonormality, and evidence re-read (every value the rules cite equals the table value).
- **Integrity:** SHA-256 of every input, and proof that no key was lost on the way to the canonical model.
- **Drift against the previous run:** schema changes, input hash changes, PSI per numeric column (on the previous deciles; < 0.1 stable, < 0.25 moderate) and total-variation distance per categorical column.
- **Topology.** H0 persistent homology of the whitened candidate cloud. The Vietoris–Rips H0 barcode equals the minimum-spanning-tree edge lengths (single linkage). It is coordinate-free and stable under small perturbations. Long bars mean well-separated groups; on the mocks there is one connected cloud. Runs are compared with the 1-Wasserstein distance between barcodes.

## 10. Why the system of record is never overwritten

The official verdicts, the exported values and the dates are shown as they are. The engine adds reconstructions, recomputed values, flags and conflicts *next to* them. Silently replacing an organisational decision is what made breeders distrust the earlier pilot, and a hackathon prototype should not repeat it.
