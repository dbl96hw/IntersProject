"""Pattern mining on strings: map characters to numbers, find the combinatorics
behind identifiers, and pull structured facts out of free text.

1. Character encoding. Each character gets a class code and a value code:
       uppercase A-Z -> class 'A' (26 symbols), lowercase -> 'a' (26),
       digit 0-9     -> class '9' (10 symbols), anything else -> itself (1).
   A string becomes its *shape* ("SYN-MZ-00001" -> "AAA-AA-99999") and a vector
   of integers (ord values). Shapes are the "grammar" of a column; the integer
   vectors let us measure, position by position, what actually varies.

2. Combinatorics of an identifier family (all values sharing one shape):
   * per position: alphabet size |Sigma_i| (26 or 10), observed distinct
     symbols, and Shannon entropy H_i in bits;
   * constant positions (H_i = 0) form the fixed prefix/suffix ("SYN-MZ-");
   * capacity = prod_i |Sigma_i| over the varying positions (how many IDs the
     format can hold), utilisation = observed / capacity;
   * if the varying part is numeric, the counter range and its *gaps*: a gap in
     a sequential counter is a record that exists in the source system but is
     missing from the export (a completeness check no schema can give).
   * an inferred regex such as ^SYN-MZ-\\d{5}$ used to validate new data and to
     find the same IDs inside PDFs, chats or HTML.

3. Free-text extraction (the "web-scraping" toolbox applied to documents):
   known ID regexes + a synonym table ("yield", "rendimiento", "t/ha" ->
   YIELD_T_HA) turn sentences like "SYN-MZ-00012: yield 9.4 t/ha, disease 3"
   into records {candidate_id, field, value, unit, provenance}. Values are only
   ever *read* from the text, never guessed; every record keeps the sentence it
   came from.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Iterable

ALPHABET = {"A": 26, "a": 26, "9": 10}


def char_class(ch: str) -> str:
    if "A" <= ch <= "Z":
        return "A"
    if "a" <= ch <= "z":
        return "a"
    if ch.isdigit():
        return "9"
    return ch


def shape(value: str) -> str:
    """'SYN-MZ-00001' -> 'AAA-AA-99999'."""
    return "".join(char_class(c) for c in value)


def compress(shape_str: str) -> str:
    """Run-length form: 'AAA-AA-99999' -> 'A3-A2-95' is ambiguous, so use 'A{3}-A{2}-9{5}'."""
    return re.sub(r"(.)\1*", lambda m: m.group(1) + (f"{{{len(m.group(0))}}}" if len(m.group(0)) > 1 else ""),
                  shape_str)


def encode(value: str) -> list[int]:
    """Characters as integers (Unicode code points)."""
    return [ord(c) for c in value]


def _entropy(counts: Counter) -> float:
    total = sum(counts.values())
    h = -sum((c / total) * math.log2(c / total) for c in counts.values()) if total else 0.0
    return max(0.0, h)  # clamp -0.0 from round-off


@dataclass
class Family:
    shape: str
    count: int
    share: float
    regex: str                 # strict: what the observed values look like
    format_regex: str          # general: what the format allows (digits always \d)
    format_capacity: int       # how many distinct IDs the format can hold
    fixed_prefix: str
    varying_positions: list[int]
    position_entropy_bits: list[float]
    capacity: int
    utilisation: float
    counter: dict[str, Any] | None
    examples: list[str]

    def as_dict(self) -> dict:
        return asdict(self)


def _regex_for(values: list[str]) -> str:
    """Regex that keeps constant positions literal and generalises varying ones by class."""
    n = len(values[0])
    parts = []
    for i in range(n):
        symbols = {v[i] for v in values}
        if len(symbols) == 1:
            parts.append(re.escape(values[0][i]))
        else:
            parts.append({"A": "[A-Z]", "a": "[a-z]", "9": r"\d"}.get(char_class(values[0][i]), "."))
    # merge runs like \d\d\d -> \d{3}
    out, prev, run = [], None, 0
    for p in parts + [None]:
        if p == prev and p in ("[A-Z]", "[a-z]", r"\d"):
            run += 1
            continue
        if prev is not None:
            out.append(prev + (f"{{{run}}}" if run > 1 else ""))
        prev, run = p, 1
    return "^" + "".join(out) + "$"


def _format_regex(values: list[str]) -> tuple[str, int]:
    """Letters/punctuation that never vary stay literal; digit positions are always \\d.

    The strict regex says 'these IDs happen to start with 00'; the format regex
    says 'this is a 5-digit counter', which is what new data must satisfy.
    """
    n = len(values[0])
    parts, capacity = [], 1
    for i in range(n):
        cls = char_class(values[0][i])
        symbols = {v[i] for v in values}
        if cls == "9":
            parts.append(r"\d")
            capacity *= 10
        elif len(symbols) == 1:
            parts.append(re.escape(values[0][i]))
        else:
            parts.append({"A": "[A-Z]", "a": "[a-z]"}.get(cls, "."))
            capacity *= ALPHABET.get(cls, 1)
    joined = "".join(parts)
    joined = re.sub(r"(\\d)+", lambda m: r"\d" + (f"{{{len(m.group(0)) // 2}}}" if len(m.group(0)) > 2 else ""), joined)
    return "^" + joined + "$", capacity


_GUID_RE = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$", re.I)


def _analyse_guids(vals: list[str]) -> dict:
    """GUID columns: hex alphabet (16), and synthetic/sequential GUIDs expose a counter in the last group."""
    uniq = sorted(set(vals))
    prefixes = Counter(v.rsplit("-", 1)[0] for v in uniq)
    nums = sorted(int(v.rsplit("-", 1)[1], 16) for v in uniq)
    span = nums[-1] - nums[0] + 1
    sequential = len(prefixes) == 1 and span <= 10 * len(nums)
    gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in set(nums)] if sequential else []
    return {"n": len(vals), "distinct": len(uniq), "shapes": 1, "kind": "guid", "conforming_share": 1.0,
            "families": [{"shape": "GUID (8-4-4-4-12 hex)", "count": len(vals), "share": 1.0,
                          "regex": _GUID_RE.pattern, "format_regex": _GUID_RE.pattern, "format_capacity": 16 ** 32,
                          "fixed_prefix": next(iter(prefixes)) + "-" if len(prefixes) == 1 else "",
                          "sequential": sequential,
                          "counter": {"min": nums[0], "max": nums[-1], "distinct": len(nums), "gaps": len(gaps),
                                      "gap_examples": gaps[:10], "contiguous": not gaps} if sequential else None,
                          "note": ("sequential GUIDs: generated by a counter, not random (typical of synthetic or "
                                   "migrated data)") if sequential else "random GUIDs",
                          "examples": uniq[:3]}],
            "nonconforming_examples": []}


def analyse_column(values: Iterable[Any], max_families: int = 5) -> dict:
    """Shape families, combinatorics and counter gaps of a string column."""
    vals = [str(v) for v in values if v is not None and str(v) != "nan"]
    if not vals:
        return {"families": [], "n": 0}
    if sum(bool(_GUID_RE.match(v)) for v in vals) > 0.95 * len(vals):
        return _analyse_guids([v for v in vals if _GUID_RE.match(v)])
    by_shape: dict[str, list[str]] = {}
    for v in vals:
        by_shape.setdefault(shape(v), []).append(v)
    families = []
    for shp, members in sorted(by_shape.items(), key=lambda kv: -len(kv[1]))[:max_families]:
        uniq = sorted(set(members))
        L = len(shp)
        ent, varying = [], []
        for i in range(L):
            h = _entropy(Counter(m[i] for m in uniq))
            ent.append(round(h, 3))
            if h > 0:
                varying.append(i)
        prefix_len = varying[0] if varying else L
        capacity = 1
        for i in varying:
            capacity *= ALPHABET.get(shp[i], 1)
        counter = None
        if varying and all(shp[i] == "9" for i in varying) and varying == list(range(varying[0], varying[-1] + 1)):
            nums = sorted(int(m[varying[0]:varying[-1] + 1]) for m in uniq)
            present = set(nums)
            gaps = [n for n in range(nums[0], nums[-1] + 1) if n not in present]
            counter = {"min": nums[0], "max": nums[-1], "distinct": len(nums), "gaps": len(gaps),
                       "gap_examples": gaps[:10], "contiguous": not gaps}
        fmt, fmt_capacity = _format_regex(uniq)
        families.append(Family(
            shape=compress(shp), count=len(members), share=round(len(members) / len(vals), 4),
            regex=_regex_for(uniq), format_regex=fmt, format_capacity=fmt_capacity,
            fixed_prefix=uniq[0][:prefix_len], varying_positions=varying,
            position_entropy_bits=ent, capacity=capacity,
            utilisation=round(len(uniq) / capacity, 6) if capacity else 0.0, counter=counter,
            examples=uniq[:3]).as_dict())
    dominant = families[0]
    return {"n": len(vals), "distinct": len(set(vals)), "shapes": len(by_shape), "kind": "string",
            "families": families, "conforming_share": dominant["share"],
            "nonconforming_examples": [v for v in vals if not re.match(dominant["format_regex"], v)][:5]}


# --------------------------------------------------------------------------- free text
ID_PATTERNS = {
    "candidate_id": re.compile(r"\bSYN-MZ-\d{5}\b"),
    "trial_id": re.compile(r"\bSYN-TR-\d{4}\b"),
    "guid": re.compile(r"\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b", re.I),
}

# field -> (synonyms, unit hints). English and Spanish, because breeders write both.
FIELD_SYNONYMS = {
    "YIELD_T_HA": (["yield", "rendimiento", "produccion", "producción"], ["t/ha", "ton/ha", "t ha"]),
    "MOISTURE_PCT": (["moisture", "humedad"], ["%"]),
    "DISEASE_SCORE": (["disease score", "disease", "enfermedad", "severidad"], []),
    "PLANT_HEIGHT_CM": (["plant height", "height", "altura"], ["cm"]),
    "FLOWERING_DAYS": (["flowering days", "days to flowering", "flowering", "floración", "floracion"], ["d", "days", "días"]),
    "GENOMIC_BREEDING_VALUE": (["genomic breeding value", "gbv", "valor genómico", "valor genomico"], []),
    "QC_CALL_RATE_PCT": (["call rate"], ["%"]),
}
_NUMBER = r"(-?\d+(?:[.,]\d+)?)"


def learn_id_patterns(columns: dict[str, Iterable[Any]]) -> dict[str, re.Pattern]:
    """Derive ID regexes from the data itself (dominant family of each ID column)."""
    learned = {}
    for name, values in columns.items():
        fam = analyse_column(values)["families"]
        if fam and fam[0]["share"] > 0.95:
            learned[name] = re.compile(r"\b" + fam[0]["format_regex"].strip("^$") + r"\b")
    return learned


def extract_facts(text: str, source: str, page: int | None = None,
                  id_patterns: dict[str, re.Pattern] | None = None) -> list[dict]:
    """Sentence-level extraction of (entity id, field, value, unit) with provenance."""
    patterns = id_patterns or ID_PATTERNS
    facts: list[dict] = []
    # OCR and PDF text wrap sentences across lines: re-join a line break that does
    # not follow sentence punctuation, then split into sentences.
    text = re.sub(r"(?<![.;:!?\n])\n(?!\n)", " ", text.replace("\f", "\n\n"))
    for sentence in re.split(r"(?<=[.;!?])\s+|\n{2,}", text):
        sentence = sentence.strip()
        if not sentence:
            continue
        ids = {kind: sorted(set(p.findall(sentence))) for kind, p in patterns.items()}
        ids = {k: v for k, v in ids.items() if v}
        low = sentence.lower()
        for field, (synonyms, units) in FIELD_SYNONYMS.items():
            for syn in sorted(synonyms, key=len, reverse=True):  # longest synonym first
                m = re.search(re.escape(syn) + r"\s*(?:[:=]|is|was|of|de|es)?\s*" + _NUMBER, low)
                if not m:
                    continue
                value = float(m.group(1).replace(",", "."))
                tail = low[m.end():m.end() + 8]
                unit = next((u for u in units if tail.strip().startswith(u)), None)
                facts.append({"field": field, "value": value, "unit": unit, "ids": ids, "matched": syn,
                              "sentence": sentence[:300], "source": source, "page": page})
                break
        if ids and not any(f["sentence"] == sentence[:300] for f in facts):
            facts.append({"field": None, "value": None, "unit": None, "ids": ids, "matched": None,
                          "sentence": sentence[:300], "source": source, "page": page})
    return facts
