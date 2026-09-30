// Constants for talking to the data engine from the Express backend.
// Copy into apps/intersbackend/src/constants/ (team rule: constants live per app).

export const DATA_ENGINE_URL = process.env.DATA_ENGINE_URL || 'http://localhost:8001';

export const DATA_ENGINE_PATHS = {
  HEALTH: '/health',
  CANDIDATES: '/candidates',
  TRIALS: '/trials',
  COMPARE: '/compare',
  SEARCH: '/search',
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
export const DATA_ENGINE_TIMEOUT_MS = 30000;
