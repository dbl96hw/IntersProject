"""Ready-made tool definitions for the Claude agent, plus the dispatcher.

The teammates wiring the Claude API do not need to know the engine internals:

    tools = TOOLS                       # pass to messages.create(tools=...)
    result = call_tool(engine, name, input)   # for each tool_use block
    -> send back as a tool_result block with content=result (a JSON string)

Over HTTP (Node / Express): GET /tools returns TOOLS, POST /tools/{name} runs
one. The same functions back the MCP server (mcp_server.py).

Design choices, all in service of "the breeder decides":
* Tools are read-only. There is deliberately NO override tool: an override is
  a human decision made in the UI (POST /overrides), never by the model.
* Tools return compact, pre-computed, citation-ready payloads (llm-context),
  not raw rows, which keeps token cost low and leaves nothing to compute.
* Every payload carries its rule version and the data gaps, so the answer can
  say what it does not know.
"""

from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = """You are Breeder's Desk, an assistant for senior plant breeders deciding which candidate lines advance.

How to answer:
1. Always reply in English, even when the question is written in another language. Plain words, no jargon.
2. Start with one line: the candidate or trial, its colour (GREEN / AMBER / RED) and the one-line reason from the tool.
3. Then 2-5 bullet points of evidence, each quoting a value exactly as a tool returned it, with its source
   (for example: "yield 6.07 t/ha, below 9 (trial summary)").
4. The colours come from a deterministic rules engine. Never change, compute or re-derive a colour, a threshold
   or any number. If a number is not in a tool result, say you do not have it.
5. Counts: never count the rows of a list yourself. Lists are cut at `limit` (20 by default). For "how many"
   questions use apply_scoring, or the `total` returned by query_candidates. apply_scoring gives two counts:
   `effective_counts` (after the breeders' overrides, what the dashboard shows) and `counts` (as the rules
   decided). Report effective_counts; if `overridden` is above 0, also give the rule counts and say why they differ.
6. Write every number with digits, exactly as the tool returned it (54, not "fifty-four"). For a candidate's
   trials, cite `trial_counts` from get_candidate_context instead of counting the trial list.
7. Say so explicitly when a trial is "not explained by the data", "ambiguous", or when data gaps apply
   (for example: pedigree unavailable, lab trait names unknown).
8. You recommend, the breeder decides. End by reminding that they can override the colour in the table
   and that the override is logged with their reason.
9. Format: plain text. You may use **bold** for a colour or an id and lines starting with "- " for bullets.
   No headings, tables, links or code blocks.
10. Keep it short: a breeder reads this between field visits."""

DEFAULT_LIMIT = 20

TOOLS: list[dict[str, Any]] = [
    {"name": "query_candidates",
     "description": "List candidate lines with their colour (GREEN/AMBER/RED, after overrides) and one-line reason. "
                    "Use to answer 'which lines are red?', 'show me the atypical ones', 'what should I look at "
                    "first?'. Returns at most `limit` rows (default 20), red first, plus `total` (all matching "
                    "candidates) and `truncated`. For counts use `total` or apply_scoring, never the number of rows.",
     "input_schema": {"type": "object", "properties": {
         "colour": {"type": "string", "enum": ["GREEN", "AMBER", "RED"]},
         "atypical": {"type": "boolean", "description": "only candidates whose profile is statistically atypical"},
         "min_trials": {"type": "integer", "minimum": 0},
         "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20}}}},
    {"name": "get_candidate_context",
     "description": "Everything needed to explain one candidate: colour, reason, evidence statements, its trials "
                    "(with official verdicts and ambiguity), similar candidates, document mentions and data gaps.",
     "input_schema": {"type": "object", "properties": {"candidate_id": {"type": "string",
                                                                        "description": "e.g. SYN-MZ-00001"}},
                      "required": ["candidate_id"]}},
    {"name": "get_trial",
     "description": "One field trial: official verdict, the engine's reconstruction, evidence per criterion, whether "
                    "the verdict is explained by the data or ambiguous, and which candidates were tested in it.",
     "input_schema": {"type": "object", "properties": {"trial_id": {"type": "string", "description": "e.g. SYN-TR-0001"}},
                      "required": ["trial_id"]}},
    {"name": "compare_candidates",
     "description": "Side-by-side comparison of 2-6 candidates (key metrics, colours, reasons, similarity distance).",
     "input_schema": {"type": "object", "properties": {"candidate_ids": {"type": "array", "items": {"type": "string"},
                                                                         "minItems": 2, "maxItems": 6}},
                      "required": ["candidate_ids"]}},
    {"name": "get_lineage",
     "description": "Parents / pedigree of a candidate, or an explicit statement that lineage is unavailable.",
     "input_schema": {"type": "object", "properties": {"candidate_id": {"type": "string"}}, "required": ["candidate_id"]}},
    {"name": "apply_scoring",
     "description": "Colour counts for all candidates or all trials: `effective_counts` (after the breeders' "
                    "overrides, what the dashboard shows), `counts` (as the rules decided), `overridden` and the "
                    "rule version. Use it for every 'how many' question.",
     "input_schema": {"type": "object", "properties": {"level": {"type": "string", "enum": ["candidate", "trial"]}}}},
    {"name": "explain_scoring_logic",
     "description": "How the colours are decided, how well the rules reproduce the official verdicts (parity), and "
                    "why the unexplained trials disagree. Use for 'can I trust this?' questions.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_data_quality",
     "description": "Known data problems (what, how many, root cause, whether it was fixed) and open questions for the SME.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "search",
     "description": "Find candidates, trials or document sentences by id (full or partial) or by words.",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"},
                                                       "limit": {"type": "integer", "default": 10}},
                      "required": ["query"]}},
]


def _compact_baseline(engine) -> dict:
    b = engine.baseline()
    cal = b.get("calibration") or {}
    return {"rule_version": b["rule_version"], "mode": b["mode"], "parity": b["parity"],
            "not_explained": b["not_explained"],
            "root_causes_equal_weights": b["mismatch_root_causes"].get("severity", {}).get("by_category"),
            "weights": (cal.get("weighted") or {}).get("weights_config"),
            "cv_accuracy": (cal.get("weighted") or {}).get("cv_accuracy"),
            "ceiling_flags_only": (cal.get("ceiling") or {}).get("ceiling_accuracy"),
            "ambiguous_trials": cal.get("ambiguous_trials"),
            "plain_summary": ("Trial colours reproduce the official pass/fail verdicts; FAIL vs HOLD depends on how "
                              "far a trial misses its thresholds, with a yield shortfall weighing about twice a "
                              "disease excess. Candidate colours aggregate the candidate's trials and its genomic value "
                              "(team proposal, pending SME confirmation).")}


def _compact_quality(engine) -> dict:
    q = engine.quality_report()
    return {"summary": q["summary"],
            "issues": [{k: i[k] for k in ("id", "title", "count", "fix_status", "root_cause", "sme_question")}
                       for i in q["issues"]]}


def call_tool(engine, name: str, arguments: dict | None = None) -> str:
    """Run one tool and return a JSON string for the tool_result block (errors included, never raised)."""
    args = arguments or {}
    try:
        if name == "query_candidates":
            # The full match is computed so the model gets the true total; only `limit` rows are sent.
            limit = int(args.get("limit") or DEFAULT_LIMIT)
            rows = engine.query_candidates(colour=args.get("colour"), atypical=args.get("atypical"),
                                           min_trials=args.get("min_trials"))
            result: Any = {"total": len(rows), "returned": min(limit, len(rows)), "truncated": len(rows) > limit,
                           "limit": limit, "candidates": rows[:limit]}
        elif name == "get_candidate_context":
            result = engine.llm_context(args["candidate_id"])["payload"]
        elif name == "get_trial":
            result = engine.get_trial(args["trial_id"])
        elif name == "compare_candidates":
            result = engine.compare_candidates(args["candidate_ids"])
        elif name == "get_lineage":
            result = engine.get_lineage(args["candidate_id"])
        elif name == "apply_scoring":
            result = engine.apply_scoring(args.get("level", "candidate"))
        elif name == "explain_scoring_logic":
            result = _compact_baseline(engine)
        elif name == "get_data_quality":
            result = _compact_quality(engine)
        elif name == "search":
            result = engine.search(args["query"], limit=args.get("limit", 10))
        else:
            result = {"error": {"code": "UNKNOWN_TOOL", "message": f"unknown tool '{name}'"}}
    except KeyError as exc:
        result = {"error": {"code": "NOT_FOUND", "message": f"unknown id or missing argument: {exc.args[0]}"}}
    except (TypeError, ValueError) as exc:
        result = {"error": {"code": "VALIDATION_ERROR", "message": str(exc)}}
    return json.dumps(result, default=str)
