# Integration guide (Claude API, Express backend, frontend)

The data engine is ready to be consumed. Nothing in `apps/` has been modified: the files under `clients/node/` are drop-in examples for the owners of those folders to copy.

```
UI (React) ──► Express (apps/intersbackend) ──► data engine (Python, :8001) ◄── MCP clients
                    │                                 ▲
                    └── Claude API (tool use) ────────┘  tools = GET /tools, execution = POST /tools/:name
```

## 1. Run the engine

```bash
cd services/data-engine
pip install -r requirements.txt && pip install -e .
uvicorn data_engine.api:app --port 8001          # http://localhost:8001/docs
```

Check: `GET /health` → `{"healthy": true, "candidates": 150, "trials": 72, ...}`.

## 2. Express (backend teammates)

1. Copy `clients/node/constants.js` into `apps/intersbackend/src/constants/`.
2. Copy `clients/node/dataEngineClient.js` into `apps/intersbackend/src/services/`.
3. Copy `clients/node/breederRoutes.example.js` into `apps/intersbackend/src/routes/`, and add:
   ```js
   app.use(express.json({ limit: '25mb' }));
   app.use('/api/breeder', breederRouter);
   ```
4. Add `DATA_ENGINE_URL=http://localhost:8001` to `.env`.

Errors come back in the team contract (`{"error": {"code", "message", "field"}}`, with 400/404/500), so the routes just forward them.

## 3. Claude API: tool use (agent teammates)

- `GET /tools` returns the tool definitions **and** the system prompt that formulates the answer:
  - reply in the breeder's language;
  - start with one line (colour + reason), then 2–5 cited evidence bullets;
  - never compute numbers;
  - flag "not explained" and "ambiguous" cases;
  - remind the breeder that they decide and can override.
- `POST /tools/{name}` with the `tool_use.input` as body returns `{"content": "<json string>"}`. Put that string, as is, in the `tool_result` block.
- `clients/node/agentLoop.example.js` is a complete loop with `@anthropic-ai/sdk`. It needs `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, and caps the tool rounds at 6.

| Tool | Use it for |
|---|---|
| `query_candidates` | "which lines are red?", "what should I look at first?" |
| `get_candidate_context` | explaining one candidate (compact, ~270 tokens) |
| `get_trial` | one trial: official vs engine verdict, evidence, ambiguity |
| `compare_candidates` | side-by-side comparison |
| `get_lineage` | parents (or why they are unavailable) |
| `apply_scoring` | colour counts |
| `explain_scoring_logic` | "can I trust this?" — parity, weights, root causes |
| `get_data_quality` | known data problems and SME questions |
| `search` | ids (full or partial) and words in reasons and documents |

There is **no override tool** on purpose: overrides are human decisions made in the UI (`POST /overrides`).

Python agents can skip HTTP entirely:

```python
from data_engine import DataEngine
from data_engine.agent_tools import TOOLS, SYSTEM_PROMPT, call_tool

engine = DataEngine.from_directory()
result_json = call_tool(engine, "get_candidate_context", {"candidate_id": "SYN-MZ-00001"})
```

## 4. MCP (Claude Desktop, Cursor, other agents)

```bash
python -m data_engine.mcp_server      # stdio; same 9 tools, same payloads
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{"mcpServers": {"breeders-desk": {"command": "python", "args": ["-m", "data_engine.mcp_server"],
  "env": {"DATA_ENGINE_DATA_DIR": "C:/Users/<you>/HatchworksAI/IntersProject/data/synthetic/uc4"}}}}
```

## 5. New data during the demo

| What arrives | Endpoint | What happens |
|---|---|---|
| A PDF / scan / photo / DOCX / PPTX / HTML | `POST /documents` (multipart, field `file`) or `POST /documents/base64` | text layer or OCR; tables matching a source are ingested; sentences become searchable evidence; exports always win on conflicts |
| Structured records from the extraction service | `POST /ingest/records` `{"label", "records": [...]}` | routed by header signature; unknown shapes are rejected with the best guess |
| Nothing new, but you want proof it works | `GET /diagnostics` | timings, memory, numerical checks, integrity, drift, topology of the last build |

Incremental rebuilds take ~1 s: the calibration is cached by a content hash.

## 6. Frontend (what to show)

- Candidate table: `GET /api/breeder/candidates`. Show `colour`, `reason`, and the `ambiguous_trials` / `atypical` flags.
- Candidate card: `GET /api/breeder/candidates/:id`. Show `evidence[].statement`, `trials[]` (with `explained_by_data`, `ambiguous`), `document_evidence[]` and `data_gaps`.
- Override: the reason list comes from `GET /api/breeder/override-reasons`; submit with `POST /api/breeder/overrides`. Show `engine_colour` next to `colour` when `overridden` is true.
- Trust panel: `GET /api/breeder/baseline` (parity 72/72 and root causes) and `GET /api/breeder/quality`.
