"""MCP server exposing the engine's read-only tools (Model Context Protocol).

Run:  python -m data_engine.mcp_server            (stdio transport)

Then any MCP client (Claude Desktop, Cursor, the team's agent) can call the
same tools as the REST API, with the same payloads, because both go through
agent_tools.call_tool. Overrides are intentionally not exposed: they are human
decisions taken in the UI.

Claude Desktop config example (claude_desktop_config.json):
    {"mcpServers": {"breeders-desk": {
        "command": "python", "args": ["-m", "data_engine.mcp_server"],
        "env": {"DATA_ENGINE_DATA_DIR": "C:/path/to/data/synthetic/uc4"}}}}
"""

from __future__ import annotations

from functools import lru_cache

from . import agent_tools


@lru_cache(maxsize=1)
def _engine():
    from .engine import DataEngine
    return DataEngine.from_directory()


def build_server():
    from mcp.server.fastmcp import FastMCP  # optional dependency: pip install mcp

    mcp = FastMCP("breeders-desk", instructions=agent_tools.SYSTEM_PROMPT)

    @mcp.tool()
    def query_candidates(colour: str | None = None, atypical: bool | None = None,
                         min_trials: int | None = None, limit: int = 20) -> str:
        """List candidate lines with colour (GREEN/AMBER/RED) and one-line reason."""
        return agent_tools.call_tool(_engine(), "query_candidates", {"colour": colour, "atypical": atypical,
                                                                     "min_trials": min_trials, "limit": limit})

    @mcp.tool()
    def get_candidate_context(candidate_id: str) -> str:
        """Colour, reason, evidence, trials, similar candidates, document mentions and data gaps of one candidate."""
        return agent_tools.call_tool(_engine(), "get_candidate_context", {"candidate_id": candidate_id})

    @mcp.tool()
    def get_trial(trial_id: str) -> str:
        """Official vs engine verdict of one trial, with evidence and ambiguity."""
        return agent_tools.call_tool(_engine(), "get_trial", {"trial_id": trial_id})

    @mcp.tool()
    def compare_candidates(candidate_ids: list[str]) -> str:
        """Side-by-side comparison of 2-6 candidates."""
        return agent_tools.call_tool(_engine(), "compare_candidates", {"candidate_ids": candidate_ids})

    @mcp.tool()
    def get_lineage(candidate_id: str) -> str:
        """Parents / pedigree of a candidate, or why it is unavailable."""
        return agent_tools.call_tool(_engine(), "get_lineage", {"candidate_id": candidate_id})

    @mcp.tool()
    def apply_scoring(level: str = "candidate") -> str:
        """Colour counts and rule version for candidates or trials."""
        return agent_tools.call_tool(_engine(), "apply_scoring", {"level": level})

    @mcp.tool()
    def explain_scoring_logic() -> str:
        """How colours are decided and how well they reproduce the official verdicts."""
        return agent_tools.call_tool(_engine(), "explain_scoring_logic", {})

    @mcp.tool()
    def get_data_quality() -> str:
        """Known data problems, their root causes and fix status."""
        return agent_tools.call_tool(_engine(), "get_data_quality", {})

    @mcp.tool()
    def search(query: str, limit: int = 10) -> str:
        """Find candidates, trials or document sentences by id or words."""
        return agent_tools.call_tool(_engine(), "search", {"query": query, "limit": limit})

    return mcp


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
