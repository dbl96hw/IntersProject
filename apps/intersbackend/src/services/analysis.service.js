// Runs an analysis (files) or an answer (question only) and returns what to save:
// the assistant message fields (as accepted by db.messages.saveMessage) and the candidate rows.
// Live uploads: the engine owns colours. Claude only writes justifications for up to EXPLAIN_MAX_SYNC rows.

import { createHash } from 'node:crypto';
import {
  ANALYSIS_MODES,
  COLOURS,
  ERROR_CODES,
  EXPLAIN_MAX_SYNC,
  HTTP_STATUS,
  MESSAGE_KINDS,
  MESSAGE_STATUS,
  WARNING_CODES,
} from '../constants/index.js';
import { emptyUsage } from '../llm/claude.client.js';
import { engineFallback } from '../llm/evidence.check.js';
import { loadSample } from '../mocks/index.js';
import { getPromptVersions } from '../prompts/index.js';
import { DataEngineError } from './dataEngineClient.js';
import { fileKindOf } from './responses.js';

const MOCK_SOURCE = 'SAMPLE';
const MOCK_INGESTION_MESSAGE = 'Mock mode: file not sent to the engine';

function mockIngestion(files) {
  return files.map((file) => ({
    file: file.name,
    kind: fileKindOf(file.name),
    accepted: true,
    source: MOCK_SOURCE,
    rows: null,
    rows_added: null,
    duplicates_ignored: null,
    conflicts: null,
    message: MOCK_INGESTION_MESSAGE,
  }));
}

function mockAnalysis(files) {
  const { candidates, usage, versions, ...analysis } = loadSample('analysis');
  return {
    message: {
      kind: MESSAGE_KINDS.ANALYSIS,
      status: MESSAGE_STATUS.OK,
      analysis: { ...analysis, ingestion: mockIngestion(files) },
      usage,
      versions,
    },
    candidates,
  };
}

function mockAnswer() {
  const { text, tool_calls: toolCalls, usage } = loadSample('answer');
  return {
    message: { kind: MESSAGE_KINDS.ANSWER, status: MESSAGE_STATUS.OK, text, tool_calls: toolCalls, usage },
    candidates: [],
  };
}

const COLOUR_RANK = { [COLOURS.RED]: 0, [COLOURS.AMBER]: 1, [COLOURS.GREEN]: 2 };
const HASH_SKIP = new Set(['instructions', 'tokens']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// SHA-256 of the llm-context payload. instructions and tokens are not evidence, so they are left out.
export function evidenceHash(payload) {
  const source = Object.fromEntries(Object.entries(payload ?? {}).filter(([key]) => !HASH_SKIP.has(key)));
  return createHash('sha256').update(JSON.stringify(canonical(source))).digest('hex');
}

function byPriority(a, b) {
  const rank = (COLOUR_RANK[a.row.colour] ?? 9) - (COLOUR_RANK[b.row.colour] ?? 9);
  if (rank !== 0) return rank;
  return String(a.row.candidate_id).localeCompare(String(b.row.candidate_id));
}

function buildSummary(candidates) {
  const counts = { [COLOURS.GREEN]: 0, [COLOURS.AMBER]: 0, [COLOURS.RED]: 0 };
  candidates.forEach((candidate) => {
    if (counts[candidate.colour] !== undefined) counts[candidate.colour] += 1;
  });
  return `${candidates.length} candidates analysed: ${counts[COLOURS.GREEN]} green, ${counts[COLOURS.AMBER]} amber, ${counts[COLOURS.RED]} red.`;
}

function notImplementedAnswer() {
  return {
    message: {
      kind: MESSAGE_KINDS.ANSWER,
      status: MESSAGE_STATUS.ERROR,
      error: { code: ERROR_CODES.LLM_UNAVAILABLE, message: 'Live analysis is not implemented yet' },
    },
    candidates: [],
  };
}

function engineDown(err) {
  return {
    message: {
      kind: MESSAGE_KINDS.ANALYSIS,
      status: MESSAGE_STATUS.ERROR,
      error: { code: err.code, message: err.message },
    },
    candidates: [],
  };
}

const isEngineDown = (err) => err instanceof DataEngineError && err.status === HTTP_STATUS.BAD_GATEWAY;

function toStoredCandidate(row, explanation, hash) {
  return {
    candidate_id: row.candidate_id,
    colour: row.colour,
    engine_colour: row.engine_colour,
    overridden: row.overridden,
    override: row.override,
    verdict: row.verdict,
    reason: row.reason,
    n_trials: row.n_trials,
    n_fail: row.n_fail,
    ambiguous_trials: row.ambiguous_trials,
    atypical: row.atypical,
    rule_version: row.rule_version,
    evidence: row.evidence,
    data_gaps: row.data_gaps,
    evidence_hash: hash,
    justification: explanation.justification,
    justification_source: explanation.justification_source,
    verified: explanation.verified,
    confidence: explanation.confidence,
  };
}

async function loadCandidate(dataEngine, id, warnings) {
  try {
    const [row, context] = await Promise.all([
      dataEngine.getCandidate(id),
      dataEngine.getLlmContext(id),
    ]);
    if (!row?.candidate_id || !context?.payload) {
      warnings.push({
        code: ERROR_CODES.DATA_ENGINE_UNAVAILABLE,
        message: `Candidate ${id} could not be loaded from the engine`,
        file: null,
      });
      return null;
    }
    return { row, payload: context.payload };
  } catch (err) {
    if (isEngineDown(err)) throw err;
    warnings.push({ code: err.code, message: err.message, file: null });
    return null;
  }
}

function reusedExplanation(stored) {
  return {
    justification: stored.justification,
    justification_source: stored.justification_source,
    verified: stored.verified,
    confidence: stored.confidence,
  };
}

async function liveAnalysis({ text, files, ingest, claude, dataEngine, db, model }) {
  let ingested;
  try {
    ingested = await ingest.ingestFiles(files);
  } catch (err) {
    if (isEngineDown(err)) return engineDown(err);
    throw err;
  }

  const warnings = [...ingested.warnings];
  let loaded;
  try {
    loaded = (await Promise.all(
      ingested.touchedCandidateIds.map((id) => loadCandidate(dataEngine, id, warnings)),
    )).filter(Boolean);
  } catch (err) {
    if (isEngineDown(err)) return engineDown(err);
    throw err;
  }

  const prepared = [];
  for (const item of loaded) {
    const hash = evidenceHash(item.payload);
    const reusable = await db.candidates.findReusableJustification(
      item.row.candidate_id,
      item.row.rule_version,
      hash,
    );
    prepared.push({ ...item, hash, reusable });
  }

  const fresh = prepared.filter((item) => !item.reusable).sort(byPriority);
  const toExplain = fresh.slice(0, EXPLAIN_MAX_SYNC);
  const deferred = fresh.slice(EXPLAIN_MAX_SYNC);

  let explained = { results: [], warnings: [], usage: emptyUsage() };
  if (toExplain.length > 0) {
    explained = await claude.explainAll(toExplain.map((item) => item.payload), text ?? '');
  }
  warnings.push(...(explained.warnings ?? []));
  if (deferred.length > 0) {
    const label = deferred.length === 1 ? '1 candidate was' : `${deferred.length} candidates were`;
    warnings.push({
      code: WARNING_CODES.EXPLANATION_DEFERRED,
      message: `${label} not explained in this response. The justification is the engine reason.`,
      file: null,
    });
  }

  const byId = new Map((explained.results ?? []).map((result) => [result.candidate_id, result]));
  const deferredIds = new Set(deferred.map((item) => item.row.candidate_id));
  const explanationFor = (item) => {
    if (item.reusable) return reusedExplanation(item.reusable);
    if (deferredIds.has(item.row.candidate_id)) return engineFallback(item.payload);
    return byId.get(item.row.candidate_id) ?? engineFallback(item.payload);
  };

  const candidates = prepared.map((item) => toStoredCandidate(item.row, explanationFor(item), item.hash));
  const ruleVersion = prepared[0]?.row.rule_version ?? null;

  return {
    message: {
      kind: MESSAGE_KINDS.ANALYSIS,
      status: MESSAGE_STATUS.OK,
      analysis: {
        summary: buildSummary(candidates),
        warnings,
        ingestion: ingested.ingestion,
      },
      usage: explained.usage ?? emptyUsage(),
      versions: getPromptVersions({ ruleVersion, model }),
    },
    candidates,
  };
}

export function createAnalysisService({ config, ingest, claude, dataEngine, db }) {
  return {
    // files: [{ name, mime_type, size_bytes, buffer }]
    async handleMessage({ text, files }) {
      const hasFiles = files.length > 0;
      if (config.analysisMode === ANALYSIS_MODES.LIVE) {
        if (!hasFiles) return notImplementedAnswer();
        return liveAnalysis({
          text,
          files,
          ingest,
          claude,
          dataEngine,
          db,
          model: config.anthropicModel,
        });
      }
      return hasFiles ? mockAnalysis(files) : mockAnswer();
    },
  };
}
