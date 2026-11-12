// Thin client for the Python data engine (Node >= 20, global fetch, ESM).
// Every method returns the engine's JSON as-is: the engine is the only place
// numbers are produced, so the backend never recomputes or reshapes them.
// Copied from services/data-engine/clients/node/dataEngineClient.js.

import { config } from '../config/env.js';
import {
  DATA_ENGINE_MAX_RETRY_DELAY_MS,
  DATA_ENGINE_PATHS,
  DATA_ENGINE_RETRY_DELAY_MS,
  DATA_ENGINE_STATIC_CACHE_TTL_MS,
  ERROR_CODES,
  HTTP_STATUS,
} from '../constants/index.js';

const RETRYABLE_STATUSES = new Set([HTTP_STATUS.TOO_MANY_REQUESTS, HTTP_STATUS.SERVICE_UNAVAILABLE]);

export class DataEngineError extends Error {
  constructor(status, error) {
    super(error?.message || `data engine responded ${status}`);
    this.name = 'DataEngineError';
    this.status = status;
    this.code = error?.code || ERROR_CODES.DATA_ENGINE_ERROR;
    this.field = error?.field;
  }
}

function unavailableError() {
  return new DataEngineError(HTTP_STATUS.BAD_GATEWAY, {
    code: ERROR_CODES.DATA_ENGINE_UNAVAILABLE,
    message: 'Data engine is unreachable',
  });
}

// The engine always answers errors with { error: { code, message } }. Without that body the
// status came from whatever answers at DATA_ENGINE_URL (proxy, tunnel, another program on the port).
function notFromEngineError(status) {
  if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return new DataEngineError(status, {
      code: ERROR_CODES.DATA_ENGINE_BUSY,
      message: 'The data engine is receiving too many requests. Wait a moment and try again.',
    });
  }
  return new DataEngineError(status);
}

function retryDelayFrom(res) {
  const header = res.headers.get('retry-after');
  const seconds = header === null ? Number.NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return DATA_ENGINE_RETRY_DELAY_MS;
  return Math.min(seconds * 1000, DATA_ENGINE_MAX_RETRY_DELAY_MS);
}

const defaultWait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createDataEngineClient({
  baseUrl = config.dataEngineUrl,
  timeoutMs = config.dataEngineTimeoutMs,
  ingestTimeoutMs = config.dataEngineIngestTimeoutMs,
  cacheTtlMs = DATA_ENGINE_STATIC_CACHE_TTL_MS,
  wait = defaultWait,
  clock = Date.now,
  logger = console,
} = {}) {
  async function send(url, { method, body, timeoutMs: requestTimeoutMs }) {
    try {
      return await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw unavailableError();
    }
  }

  // Only reads are retried: repeating a POST /overrides or an ingest could apply it twice.
  async function request(path, {
    method = 'GET', body, query, timeoutMs: requestTimeoutMs = timeoutMs, isRetryable = method === 'GET',
  } = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });

    const options = { method, body, timeoutMs: requestTimeoutMs };
    let res = await send(url, options);
    if (isRetryable && RETRYABLE_STATUSES.has(res.status)) {
      await res.body?.cancel();
      await wait(retryDelayFrom(res));
      res = await send(url, options);
    }

    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload;
    if (payload?.error) throw new DataEngineError(res.status, payload.error);
    logger.error(`data engine ${method} ${url.origin}${url.pathname} -> ${res.status} without the engine's error body; `
      + 'check what answers at DATA_ENGINE_URL');
    throw notFromEngineError(res.status);
  }

  const cache = new Map();
  async function cachedRead(path) {
    const hit = cache.get(path);
    if (hit && clock() - hit.storedAt < cacheTtlMs) return hit.payload;
    const payload = await request(path);
    cache.set(path, { payload, storedAt: clock() });
    return payload;
  }

  const candidatePath = (id) => `${DATA_ENGINE_PATHS.CANDIDATES}/${encodeURIComponent(id)}`;

  return {
    health: ({ timeoutMs: healthTimeoutMs } = {}) => request(DATA_ENGINE_PATHS.HEALTH, {
      timeoutMs: healthTimeoutMs, isRetryable: false,
    }),
    listCandidates: (filters) => request(DATA_ENGINE_PATHS.CANDIDATES, { query: filters }),
    getCandidate: (id) => request(candidatePath(id)),
    getLlmContext: (id) => request(`${candidatePath(id)}${DATA_ENGINE_PATHS.LLM_CONTEXT}`),
    getTrial: (id) => request(`${DATA_ENGINE_PATHS.TRIALS}/${encodeURIComponent(id)}`),
    compare: (ids) => request(DATA_ENGINE_PATHS.COMPARE, { query: { ids: ids.join(',') } }),
    search: (q) => request(DATA_ENGINE_PATHS.SEARCH, { query: { q } }),
    sql: (query, limit) => request(DATA_ENGINE_PATHS.SQL, { method: 'POST', body: { query, limit } }),
    getTools: () => cachedRead(DATA_ENGINE_PATHS.TOOLS),
    // The chat only runs read-only tools (BLOCKED_CHAT_TOOL_PATTERN), so a retry is safe.
    runTool: (name, input) => request(`${DATA_ENGINE_PATHS.TOOLS}/${encodeURIComponent(name)}`, {
      method: 'POST', body: input || {}, isRetryable: true,
    }),
    listOverrideReasons: () => cachedRead(DATA_ENGINE_PATHS.OVERRIDE_REASONS),
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
