// Thin client for the Python data engine (Node >= 20, global fetch, ESM).
// Every method returns the engine's JSON as-is: the engine is the only place
// numbers are produced, so the backend never recomputes or reshapes them.

import { DATA_ENGINE_PATHS, DATA_ENGINE_TIMEOUT_MS, DATA_ENGINE_URL } from './constants.js';

export class DataEngineError extends Error {
  constructor(status, error) {
    super(error?.message || `data engine responded ${status}`);
    this.status = status;
    this.code = error?.code || 'DATA_ENGINE_ERROR';
    this.field = error?.field;
  }
}

export function createDataEngineClient({ baseUrl = DATA_ENGINE_URL, timeoutMs = DATA_ENGINE_TIMEOUT_MS } = {}) {
  async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new DataEngineError(res.status, payload.error);
    return payload;
  }

  return {
    health: () => request(DATA_ENGINE_PATHS.HEALTH),
    listCandidates: (filters) => request(DATA_ENGINE_PATHS.CANDIDATES, { query: filters }),
    getCandidate: (id) => request(`${DATA_ENGINE_PATHS.CANDIDATES}/${encodeURIComponent(id)}`),
    getTrial: (id) => request(`${DATA_ENGINE_PATHS.TRIALS}/${encodeURIComponent(id)}`),
    compare: (ids) => request(DATA_ENGINE_PATHS.COMPARE, { query: { ids: ids.join(',') } }),
    search: (q) => request(DATA_ENGINE_PATHS.SEARCH, { query: { q } }),
    getTools: () => request(DATA_ENGINE_PATHS.TOOLS),
    runTool: (name, input) => request(`${DATA_ENGINE_PATHS.TOOLS}/${encodeURIComponent(name)}`, { method: 'POST', body: input || {} }),
    listOverrideReasons: () => request(DATA_ENGINE_PATHS.OVERRIDE_REASONS),
    createOverride: (override) => request(DATA_ENGINE_PATHS.OVERRIDES, { method: 'POST', body: override }),
    baseline: () => request(DATA_ENGINE_PATHS.BASELINE),
    quality: () => request(DATA_ENGINE_PATHS.QUALITY),
    diagnostics: () => request(DATA_ENGINE_PATHS.DIAGNOSTICS),
    // `force: true` indexes a file even when the relevance gate calls it IRRELEVANT (human override).
    uploadDocument: (filename, buffer, { force = false } = {}) => request(DATA_ENGINE_PATHS.DOCUMENTS_BASE64, {
      method: 'POST',
      body: { filename, content_base64: Buffer.from(buffer).toString('base64'), force },
    }),
    // Is a file about breeding / trials? Call before paying an LLM to extract records from it.
    // Pass the file (filename + buffer), text you already extracted, or both.
    checkRelevance: ({ filename, buffer, text } = {}) => request(DATA_ENGINE_PATHS.RELEVANCE, {
      method: 'POST',
      body: {
        filename,
        text,
        content_base64: buffer ? Buffer.from(buffer).toString('base64') : undefined,
      },
    }),
    ingestRecords: (label, records) => request(DATA_ENGINE_PATHS.INGEST_RECORDS, { method: 'POST', body: { label, records } }),
  };
}
