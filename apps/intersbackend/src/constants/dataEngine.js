// Constants for talking to the data engine from the Express backend.
// Copied from services/data-engine/clients/node/constants.js; URL and timeout are read from config.

export const DEFAULT_DATA_ENGINE_URL = 'http://localhost:8001';
export const DEFAULT_DATA_ENGINE_TIMEOUT_MS = 30000;
export const HEALTH_CHECK_TIMEOUT_MS = 2000;
// Ingesting records or a document makes the engine rebuild its model, which takes far longer than a read.
export const DEFAULT_DATA_ENGINE_INGEST_TIMEOUT_MS = 120000;
export const MIN_DATA_ENGINE_INGEST_TIMEOUT_MS = 60000;

export const DATA_ENGINE_PATHS = {
  HEALTH: '/health',
  CANDIDATES: '/candidates',
  LLM_CONTEXT: '/llm-context',
  TRIALS: '/trials',
  COMPARE: '/compare',
  SEARCH: '/search',
  SQL: '/sql',
  TOOLS: '/tools',
  OVERRIDES: '/overrides',
  OVERRIDE_REASONS: '/overrides/reasons',
  BASELINE: '/baseline',
  QUALITY: '/quality',
  DIAGNOSTICS: '/diagnostics',
  DOCUMENTS_BASE64: '/documents/base64',
  INGEST_RECORDS: '/ingest/records',
  RELEVANCE: '/relevance',
};

// Decisions of the engine's relevance gate (POST /relevance): is a file about breeding / trials?
export const RELEVANCE_DECISIONS = { RELEVANT: 'RELEVANT', UNCERTAIN: 'UNCERTAIN', IRRELEVANT: 'IRRELEVANT' };

// The agent loop stops after this many tool rounds so a confused model cannot loop forever.
export const MAX_TOOL_ROUNDS = 6;
// Whole question, including every tool round. Separate from the per-call LLM timeout.
export const CHAT_QUESTION_DEADLINE_MS = 90000;
// Prior user and answer bubbles loaded from the chat. Analysis messages are not part of this.
export const MAX_CHAT_HISTORY_MESSAGES = 6;
// messages.versions.chat_prompt when the system prompt came from the engine's GET /tools.
export const CHAT_PROMPT_SOURCE = 'engine';
// The chat agent never calls a tool whose name looks like a write, even if a model asks for it.
export const BLOCKED_CHAT_TOOL_PATTERN = /override|ingest|upload|delete|insert|update|patch/i;
