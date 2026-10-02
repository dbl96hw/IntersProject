// Thin client for the Python data engine (Node >= 20, global fetch, ESM).
// Every method returns the engine's JSON as-is: the engine is the only place
// numbers are produced, so the backend never recomputes or reshapes them.
// Copied from services/data-engine/clients/node/dataEngineClient.js.

import { config } from '../config/env.js';
import { DATA_ENGINE_PATHS, ERROR_CODES, HTTP_STATUS } from '../constants/index.js';

export class DataEngineError extends Error {
  constructor(status, error) {
    super(error?.message || `data engine responded ${status}`);
    this.name = 'DataEngineError';
    this.status = status;
    this.code = error?.code || 'DATA_ENGINE_ERROR';
    this.field = error?.field;
  }
}

function unavailableError() {
  return new DataEngineError(HTTP_STATUS.BAD_GATEWAY, {
    code: ERROR_CODES.DATA_ENGINE_UNAVAILABLE,
    message: 'Data engine is unreachable',
  });
}

export function createDataEngineClient({
  baseUrl = config.dataEngineUrl,
  timeoutMs = config.dataEngineTimeoutMs,
  ingestTimeoutMs = config.dataEngineIngestTimeoutMs,
} = {}) {
  async function request(path, { method = 'GET', body, query, timeoutMs: requestTimeoutMs = timeoutMs } = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw unavailableError();
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new DataEngineError(res.status, payload.error);
    return payload;
  }

  const candidatePath = (id) => `${DATA_ENGINE_PATHS.CANDIDATES}/${encodeURIComponent(id)}`;

  return {
    health: ({ timeoutMs: healthTimeoutMs } = {}) => request(DATA_ENGINE_PATHS.HEALTH, { timeoutMs: healthTimeoutMs }),
    listCandidates: (filters) => request(DATA_ENGINE_PATHS.CANDIDATES, { query: filters }),
    getCandidate: (id) => request(candidatePath(id)),
    getLlmContext: (id) => request(`${candidatePath(id)}${DATA_ENGINE_PATHS.LLM_CONTEXT}`),
    getTrial: (id) => request(`${DATA_ENGINE_PATHS.TRIALS}/${encodeURIComponent(id)}`),
    compare: (ids) => request(DATA_ENGINE_PATHS.COMPARE, { query: { ids: ids.join(',') } }),
    search: (q) => request(DATA_ENGINE_PATHS.SEARCH, { query: { q } }),
    sql: (query, limit) => request(DATA_ENGINE_PATHS.SQL, { method: 'POST', body: { query, limit } }),
    getTools: () => request(DATA_ENGINE_PATHS.TOOLS),
    runTool: (name, input) => request(`${DATA_ENGINE_PATHS.TOOLS}/${encodeURIComponent(name)}`, { method: 'POST', body: input || {} }),
    listOverrideReasons: () => request(DATA_ENGINE_PATHS.OVERRIDE_REASONS),
    createOverride: (override) => request(DATA_ENGINE_PATHS.OVERRIDES, { method: 'POST', body: override }),
    baseline: () => request(DATA_ENGINE_PATHS.BASELINE),
    quality: () => request(DATA_ENGINE_PATHS.QUALITY),
    diagnostics: () => request(DATA_ENGINE_PATHS.DIAGNOSTICS),
    uploadDocument: (filename, buffer) => request(DATA_ENGINE_PATHS.DOCUMENTS_BASE64, {
      method: 'POST',
      body: { filename, content_base64: Buffer.from(buffer).toString('base64') },
      timeoutMs: ingestTimeoutMs,
    }),
    // Is a file about breeding / trials? Deterministic and cheap; called before paying Claude to read it.
    // Uses the ingest timeout: for a scanned PDF the engine runs OCR (cached for the later upload).
    checkRelevance: ({ filename, buffer, text } = {}) => request(DATA_ENGINE_PATHS.RELEVANCE, {
      method: 'POST',
      body: { filename, text, content_base64: buffer ? Buffer.from(buffer).toString('base64') : undefined },
      timeoutMs: ingestTimeoutMs,
    }),
    ingestRecords: (label, records) => request(DATA_ENGINE_PATHS.INGEST_RECORDS, {
      method: 'POST',
      body: { label, records },
      timeoutMs: ingestTimeoutMs,
    }),
  };
}
