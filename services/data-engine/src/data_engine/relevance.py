"""Relevance gate: is an uploaded file about UC4 (vegetable-seed breeding R&D)?

Why it exists: Express pays Claude to extract records from every document, and
the engine indexes every document's sentences as evidence. An invoice, a
football report or a holiday photo must stop at the door, with a reason a
person can read, before it costs money or pollutes the evidence.

Decision ladder (deterministic first, a model only where the rules are silent):

  1. KNOWN ENTITY  the text mentions an id / GUID the engine already holds, or an
                   id with the engine's learned id grammar (SYN-MZ-\\d{5})  -> RELEVANT
  2. SIGNATURE     a table in the file matches a known source signature    -> RELEVANT
  3. MODEL         p = sigmoid(w0 + w . z) on two standardised features
                     lex   = log(1 + 100 * weighted lexicon hits / words)
                     delta = s_in - s_off, where s_* is the mean of the top-k
                             cosine similarities between the text's char n-gram
                             TF-IDF vector and the in-domain / off-topic examples
                   w: L2-regularised logistic regression (Newton / IRLS) on the
                   labelled examples of config/relevance.yaml, with leave-one-out
                   features (an example is never compared with itself).
                   p >= relevant_at -> RELEVANT, p <= irrelevant_at -> IRRELEVANT,
                   otherwise UNCERTAIN: the person uploading decides.

Why char n-grams (3-5, inside word boundaries): they work for English and
Spanish at once, survive OCR noise ("rendirniento") and inflection, and need no
tokenizer, stemmer or model download. Digits are mapped to 0, so "9.4 t/ha" and
"8.7 t/ha" have the same shape: the identity of a number is noise here, its form
is signal.

Why a contrast (in minus off) and not in-domain similarity alone: frequent
n-grams (" the", "cion", " de ") are shared by every text in a language; the
off-topic similarity contains the same language component, so the difference
measures topic rather than language. The query is projected onto the reference
vocabulary (unseen n-grams are dropped), so long documents are not penalised for
words the examples never used.

Everything is deterministic (no random state), fitted in milliseconds at
start-up, and its generalisation is reported by nested leave-one-out
(`RelevanceModel.loo_report`): the held-out example is excluded both from the
reference corpus and from the logistic fit.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np

from .settings import load_yaml

RELEVANT, UNCERTAIN, IRRELEVANT = "RELEVANT", "UNCERTAIN", "IRRELEVANT"
NGRAMS = (3, 4, 5)
TOP_K = 3
L2_PENALTY = 1.0           # ridge on the standardised weights; keeps them finite on separable data
MAX_CHARS = 20_000         # n-gram budget per document (windows spread over longer texts)
MIN_WORDS = 5              # below this there is too little text to judge
_ID_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_\-]{3,}")
_WORD = re.compile(r"\w+")


# ----------------------------------------------------------------------------- text normalisation
def fold(text: str) -> str:
    """Lower case, accents removed (OCR and phone keyboards drop them), whitespace collapsed."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def _windows(text: str, budget: int = MAX_CHARS, parts: int = 4) -> str:
    """Whole text if short; otherwise `parts` evenly spaced windows (head, middle, tail are all seen)."""
    if len(text) <= budget:
        return text
    size = budget // parts
    starts = np.linspace(0, len(text) - size, parts).astype(int)
    return " ".join(text[s:s + size] for s in starts)


def char_ngrams(text: str) -> Counter:
    folded = re.sub(r"\d", "0", fold(text))
    counts: Counter = Counter()
    for token in re.findall(r"\w+|[/%]", folded):
        padded = f" {token} "
        for n in NGRAMS:
            for i in range(len(padded) - n + 1):
                counts[padded[i:i + n]] += 1
    return counts


# ----------------------------------------------------------------------------- lexicon
class Lexicon:
    """Weighted domain terms matched on word boundaries (multi-word terms allowed)."""

    def __init__(self, weighted_terms: dict[Any, list[str]]):
        self.weight: dict[str, float] = {}
        for w, terms in weighted_terms.items():
            for term in terms:
                self.weight[fold(str(term))] = float(w)
        alternatives = sorted(self.weight, key=len, reverse=True)   # longest first: "plant breeding" before "plant"
        self.pattern = re.compile(r"(?<!\w)(" + "|".join(re.escape(t) for t in alternatives) + r")(?!\w)")

    def score(self, folded: str) -> dict:
        hits = Counter(self.pattern.findall(folded))
        weighted = sum(self.weight[t] * c for t, c in hits.items())
        words = len(_WORD.findall(folded))
        density = 100.0 * weighted / max(words, 20)
        top = sorted(hits.items(), key=lambda kv: (-self.weight[kv[0]] * kv[1], kv[0]))[:8]
        return {"feature": math.log1p(density), "weighted_hits": weighted, "words": words,
                "distinct_terms": len(hits), "top_terms": [{"term": t, "count": c} for t, c in top]}


# ----------------------------------------------------------------------------- TF-IDF corpus (numpy)
class _Corpus:
    """Labelled examples as a dense TF matrix over their joint n-gram vocabulary.

    tf_ij = 1 + log(count) (sublinear: the 10th "trial" says less than the first).
    A reference set E (a row mask) defines idf_j = log((1 + |E|) / (1 + df_j)) + 1 on the
    n-grams present in E and 0 elsewhere, which is exactly "project onto E's vocabulary".
    """

    def __init__(self, texts: list[str]):
        grams = [char_ngrams(t) for t in texts]
        vocab = sorted(set().union(*grams))
        self.index = {g: j for j, g in enumerate(vocab)}
        self.tf = np.zeros((len(texts), len(vocab)))
        for i, counts in enumerate(grams):
            for g, c in counts.items():
                self.tf[i, self.index[g]] = 1.0 + math.log(c)
        self.present = self.tf > 0

    def query(self, counts: Counter) -> np.ndarray:
        v = np.zeros(self.tf.shape[1])
        for g, c in counts.items():
            j = self.index.get(g)
            if j is not None:
                v[j] = 1.0 + math.log(c)
        return v

    def reference(self, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        df = self.present[rows].sum(axis=0)
        idf = np.where(df > 0, np.log((1.0 + len(rows)) / (1.0 + df)) + 1.0, 0.0)
        ref = self.tf[rows] * idf
        norms = np.linalg.norm(ref, axis=1, keepdims=True)
        return idf, ref / np.where(norms > 0, norms, 1.0)


def _top_mean(values: np.ndarray, k: int = TOP_K) -> float:
    if values.size == 0:
        return 0.0
    k = min(k, values.size)
    return float(np.mean(np.partition(values, -k)[-k:]))


def _similarities(q_tf: np.ndarray, idf: np.ndarray, ref: np.ndarray, ref_labels: np.ndarray) -> dict:
    q = q_tf * idf
    norm = np.linalg.norm(q)
    sims = ref @ (q / norm) if norm > 0 else np.zeros(len(ref))
    s_in, s_off = _top_mean(sims[ref_labels == 1]), _top_mean(sims[ref_labels == 0])
    return {"s_in": s_in, "s_off": s_off, "delta": s_in - s_off, "sims": sims}


# ----------------------------------------------------------------------------- logistic regression
def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = L2_PENALTY, iters: int = 100) -> np.ndarray:
    """Newton / IRLS for L2-penalised logistic regression (intercept not penalised).

    The penalised negative log-likelihood is strictly convex, so Newton's method
    converges to the unique minimiser; no learning rate, no random start.
    """
    Xb = np.c_[np.ones(len(X)), X]
    penalty = np.diag([0.0] + [l2] * X.shape[1])
    w = np.zeros(Xb.shape[1])
    for _ in range(iters):
        p = _sigmoid(Xb @ w)
        hessian = Xb.T @ (Xb * (p * (1 - p))[:, None]) + penalty
        step = np.linalg.solve(hessian, Xb.T @ (p - y) + penalty @ w)
        w -= step
        if np.linalg.norm(step) < 1e-10:
            break
    return w


# ----------------------------------------------------------------------------- model
@dataclass
class Assessment:
    decision: str
    probability: float
    reasons: list[str]
    signals: dict = field(default_factory=dict)
    model: dict = field(default_factory=dict)

    @property
    def relevant(self) -> bool:
        return self.decision == RELEVANT

    def as_dict(self) -> dict:
        return {"decision": self.decision, "relevant": self.relevant, "needs_review": self.decision == UNCERTAIN,
                "probability": round(self.probability, 4), "reasons": self.reasons,
                "signals": self.signals, "model": self.model}


class RelevanceModel:
    def __init__(self, cfg: dict | None = None):
        cfg = cfg or load_yaml("relevance")
        self.cfg = cfg
        self.relevant_at = float(cfg["relevant_at"])
        self.irrelevant_at = float(cfg["irrelevant_at"])
        self.lexicon = Lexicon(cfg["lexicon"])
        self.examples = [str(t) for t in cfg["in_domain"]] + [str(t) for t in cfg["off_topic"]]
        self.labels = np.array([1] * len(cfg["in_domain"]) + [0] * len(cfg["off_topic"]))
        self.corpus = _Corpus(self.examples)
        self.lex_features = np.array([self.lexicon.score(fold(t))["feature"] for t in self.examples])
        everyone = np.arange(len(self.examples))
        X = self._features_for(everyone, everyone)
        self.mu, self.sd = X.mean(axis=0), np.where(X.std(axis=0) > 0, X.std(axis=0), 1.0)
        self.w = fit_logistic((X - self.mu) / self.sd, self.labels.astype(float))
        self.idf, self.ref = self.corpus.reference(everyone)
        self.version = hashlib.sha256(json.dumps(cfg, sort_keys=True, default=str).encode()).hexdigest()[:12]
        self._loo: dict | None = None

    # -- training features: each example against the reference set minus itself
    def _features_for(self, rows: np.ndarray, reference_pool: np.ndarray) -> np.ndarray:
        out = []
        for i in rows:
            ref_rows = reference_pool[reference_pool != i]
            idf, ref = self.corpus.reference(ref_rows)
            delta = _similarities(self.corpus.tf[i], idf, ref, self.labels[ref_rows])["delta"]
            out.append([self.lex_features[i], delta])
        return np.array(out)

    def _probability(self, lex: float, delta: float, w=None, mu=None, sd=None) -> float:
        w = self.w if w is None else w
        mu = self.mu if mu is None else mu
        sd = self.sd if sd is None else sd
        z = (np.array([lex, delta]) - mu) / sd
        return float(_sigmoid(w[0] + w[1:] @ z))

    def _decide(self, p: float) -> str:
        if p >= self.relevant_at:
            return RELEVANT
        if p <= self.irrelevant_at:
            return IRRELEVANT
        return UNCERTAIN

    # -- the public entry point
    def assess(self, text: str = "", tables: Iterable[list[str]] = (), known_ids: set[str] | None = None,
               id_patterns: dict[str, re.Pattern] | None = None) -> Assessment:
        """Score one file from its text and the column lists of its tables."""
        from . import detect as det

        text = text or ""
        signals: dict[str, Any] = {}
        reasons: list[str] = []

        # 1) entities the engine knows, or ids with its learned grammar
        known_ids = known_ids or set()
        tokens = {t.upper() for t in _ID_TOKEN.findall(text)}
        known = sorted(tokens & known_ids)
        grammar = sorted({m for name, rx in (id_patterns or {}).items() if name != "guid"
                          for m in rx.findall(text)})
        signals["known_entities"] = known[:10]
        signals["id_grammar_matches"] = grammar[:10]

        # 2) table signatures
        sources = []
        for columns in tables:
            d = det.detect([str(c).strip().upper().replace(" ", "_") for c in columns])
            if d.confident:
                sources.append({"source": d.source, "score": d.score})
        signals["table_sources"] = sources

        # 3) the model (always computed, so the probability is reported even when a rule decides)
        folded = fold(text)
        lex = self.lexicon.score(folded)
        sim = _similarities(self.corpus.query(char_ngrams(_windows(text))), self.idf, self.ref, self.labels)
        p = self._probability(lex["feature"], sim["delta"])
        nearest_in = int(np.argmax(np.where(self.labels == 1, sim["sims"], -np.inf)))
        nearest_off = int(np.argmax(np.where(self.labels == 0, sim["sims"], -np.inf)))
        signals["lexicon"] = {k: lex[k] for k in ("weighted_hits", "words", "distinct_terms", "top_terms")}
        signals["similarity"] = {"in_domain": round(sim["s_in"], 4), "off_topic": round(sim["s_off"], 4),
                                 "nearest_in_domain": self.examples[nearest_in],
                                 "nearest_off_topic": self.examples[nearest_off]}
        model = {"version": self.version, "probability": round(p, 4),
                 "thresholds": {"relevant_at": self.relevant_at, "irrelevant_at": self.irrelevant_at}}

        if known:
            reasons.append(f"mentions {len(known)} id(s) the engine already holds (e.g. {known[0]})")
        if grammar:
            reasons.append(f"mentions id(s) with the engine's id format (e.g. {grammar[0]})")
        if sources:
            reasons.append("contains a table with a known source layout ("
                           + ", ".join(sorted({s['source'] for s in sources})) + ")")
        if reasons:
            return Assessment(RELEVANT, 1.0, reasons, signals, model)

        if lex["words"] < MIN_WORDS and not sources:
            why = "no readable text (a scan without OCR, or an empty file)" if lex["words"] == 0 \
                else f"only {lex['words']} word(s): too little text to judge"
            return Assessment(UNCERTAIN, 0.5, [why], signals, model)

        decision = self._decide(p)
        terms = ", ".join(t["term"] for t in lex["top_terms"][:5]) or "none"
        reasons.append(f"breeding vocabulary: {lex['distinct_terms']} distinct term(s) ({terms})")
        reasons.append(f"closer to {'breeding' if sim['delta'] > 0 else 'off-topic'} examples "
                       f"(similarity {sim['s_in']:.2f} vs {sim['s_off']:.2f})")
        return Assessment(decision, p, reasons, signals, model)

    # -- honest error estimate
    def loo_report(self) -> dict:
        """Nested leave-one-out: example i is held out of the reference corpus AND of the fit."""
        if self._loo is not None:
            return self._loo
        n = len(self.examples)
        everyone = np.arange(n)
        probs = np.zeros(n)
        for i in range(n):
            train = everyone[everyone != i]
            X = self._features_for(train, train)
            mu, sd = X.mean(axis=0), np.where(X.std(axis=0) > 0, X.std(axis=0), 1.0)
            w = fit_logistic((X - mu) / sd, self.labels[train].astype(float))
            idf, ref = self.corpus.reference(train)
            delta = _similarities(self.corpus.tf[i], idf, ref, self.labels[train])["delta"]
            probs[i] = self._probability(self.lex_features[i], delta, w, mu, sd)
        decisions = [self._decide(p) for p in probs]
        wrong = [{"example": self.examples[i], "label": int(self.labels[i]), "probability": round(float(probs[i]), 4)}
                 for i, d in enumerate(decisions)
                 if (d == RELEVANT and self.labels[i] == 0) or (d == IRRELEVANT and self.labels[i] == 1)]
        self._loo = {
            "n": n, "accuracy_at_0_5": round(float(np.mean((probs >= 0.5) == (self.labels == 1))), 4),
            "decided": sum(d != UNCERTAIN for d in decisions), "uncertain": decisions.count(UNCERTAIN),
            "wrong_decisions": wrong,
            "weights": {"intercept": round(float(self.w[0]), 4), "lexicon": round(float(self.w[1]), 4),
                        "contrast": round(float(self.w[2]), 4)},
        }
        return self._loo


_HAS_LETTER, _HAS_DIGIT = re.compile(r"[A-Za-z]"), re.compile(r"\d")


def identifiers(frames: Iterable[Any]) -> set[str]:
    """Values of *_ID / *_GUID columns that look like identifiers, upper-cased.

    Only values with at least one letter AND one digit and >= 6 characters count:
    a bare "2024" or "A1" would match years or grid cells in any text.
    """
    out: set[str] = set()
    for frame in frames:
        for col in frame.columns:
            name = str(col).upper()
            if not (name.endswith("_ID") or name.endswith("_GUID") or name.endswith("_UUID")):
                continue
            for v in frame[col].dropna().astype(str).unique():
                v = v.strip().upper()
                if len(v) >= 6 and _HAS_LETTER.search(v) and _HAS_DIGIT.search(v):
                    out.add(v)
    return out


_MODEL: RelevanceModel | None = None


def model() -> RelevanceModel:
    """Process-wide model (fitted once; config changes need a restart, like the rules)."""
    global _MODEL
    if _MODEL is None:
        _MODEL = RelevanceModel()
    return _MODEL
