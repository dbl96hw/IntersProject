// Constants for talking to the data engine from the Express backend.
// Copied from services/data-engine/clients/node/constants.js; URL and timeout are read from config.

export const DEFAULT_DATA_ENGINE_URL = 'http://localhost:8001';
export const DEFAULT_DATA_ENGINE_TIMEOUT_MS = 30000;
export const HEALTH_CHECK_TIMEOUT_MS = 2000;

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
};

// The agent loop stops after this many tool rounds so a confused model cannot loop forever.
export const MAX_TOOL_ROUNDS = 6;
