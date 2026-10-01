// Row builders shared by the Supabase repos and the in-memory store, so both accept
// the same columns and reject the same values as the SQL check constraints.

import {
  COLOURS,
  CONFIDENCE,
  DECISIONS,
  DEFAULT_CHAT_TITLE,
  DEFAULT_PAGE_SIZE,
  JUSTIFICATION_SOURCES,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  MESSAGE_KINDS,
  MESSAGE_STATUS,
  ROLES,
  VERDICTS,
} from '../constants/index.js';

// Engine candidate row fields, stored verbatim and refreshed from the engine.
export const ENGINE_CANDIDATE_FIELDS = [
  'colour',
  'engine_colour',
  'overridden',
  'override',
  'verdict',
  'reason',
  'n_trials',
  'n_fail',
  'ambiguous_trials',
  'atypical',
  'rule_version',
];

function assertOneOf(value, allowed, field, { isNullable = false } = {}) {
  if ((value === null || value === undefined) && isNullable) return;
  if (!Object.values(allowed).includes(value)) {
    throw new Error(`invalid ${field}: must be one of ${Object.values(allowed).join(', ')}`);
  }
}

function assertPresent(value, field) {
  if (value === null || value === undefined || value === '') throw new Error(`${field} is required`);
}

// Missing values stay missing: undefined becomes null, never a guessed value.
const orNull = (value) => (value === undefined ? null : value);

export function toChatRow({ title } = {}) {
  return { title: title || DEFAULT_CHAT_TITLE };
}

export function toMessageRow(input) {
  assertPresent(input.chat_id, 'chat_id');
  assertOneOf(input.role, ROLES, 'role');
  assertOneOf(input.kind, MESSAGE_KINDS, 'kind');
  const status = input.status ?? MESSAGE_STATUS.OK;
  assertOneOf(status, MESSAGE_STATUS, 'status');
  return {
    chat_id: input.chat_id,
    role: input.role,
    kind: input.kind,
    status,
    text: orNull(input.text),
    analysis: orNull(input.analysis),
    versions: orNull(input.versions),
    usage: orNull(input.usage),
    error: orNull(input.error),
    tool_calls: orNull(input.tool_calls),
  };
}

export const MESSAGE_UPDATABLE_FIELDS = ['status', 'text', 'analysis', 'versions', 'usage', 'error', 'tool_calls'];

export function toMessagePatch(patch) {
  if (patch.status !== undefined) assertOneOf(patch.status, MESSAGE_STATUS, 'status');
  return Object.fromEntries(MESSAGE_UPDATABLE_FIELDS.filter((key) => key in patch).map((key) => [key, patch[key]]));
}

export function toFileRow(input) {
  assertPresent(input.chat_id, 'chat_id');
  assertPresent(input.message_id, 'message_id');
  assertPresent(input.name, 'name');
  return {
    chat_id: input.chat_id,
    message_id: input.message_id,
    name: input.name,
    mime_type: orNull(input.mime_type),
    size_bytes: orNull(input.size_bytes),
    storage_path: orNull(input.storage_path),
    ingestion: orNull(input.ingestion),
  };
}

export function pickEngineFields(engineRow) {
  const fields = Object.fromEntries(ENGINE_CANDIDATE_FIELDS.filter((key) => key in engineRow).map((key) => [key, engineRow[key]]));
  if ('colour' in fields) assertOneOf(fields.colour, COLOURS, 'colour');
  if ('engine_colour' in fields) assertOneOf(fields.engine_colour, COLOURS, 'engine_colour');
  if ('verdict' in fields) assertOneOf(fields.verdict, VERDICTS, 'verdict', { isNullable: true });
  return fields;
}

export function toCandidateRow(input) {
  assertPresent(input.chat_id, 'chat_id');
  assertPresent(input.message_id, 'message_id');
  assertPresent(input.candidate_id, 'candidate_id');
  assertOneOf(input.colour, COLOURS, 'colour');
  assertOneOf(input.engine_colour, COLOURS, 'engine_colour');
  assertOneOf(input.verdict, VERDICTS, 'verdict', { isNullable: true });
  assertOneOf(input.justification_source, JUSTIFICATION_SOURCES, 'justification_source', { isNullable: true });
  assertOneOf(input.confidence, CONFIDENCE, 'confidence', { isNullable: true });
  return {
    chat_id: input.chat_id,
    message_id: input.message_id,
    candidate_id: input.candidate_id,
    colour: input.colour,
    engine_colour: input.engine_colour,
    overridden: input.overridden ?? false,
    override: orNull(input.override),
    verdict: orNull(input.verdict),
    reason: orNull(input.reason),
    n_trials: orNull(input.n_trials),
    n_fail: orNull(input.n_fail),
    ambiguous_trials: orNull(input.ambiguous_trials),
    atypical: orNull(input.atypical),
    rule_version: orNull(input.rule_version),
    evidence: orNull(input.evidence),
    data_gaps: orNull(input.data_gaps),
    evidence_hash: orNull(input.evidence_hash),
    justification: orNull(input.justification),
    justification_source: orNull(input.justification_source),
    verified: orNull(input.verified),
    confidence: orNull(input.confidence),
  };
}

// Fields not given are carried forward from the latest review, so the latest row is always the full state.
export function toReviewRow(input, latestReview) {
  assertPresent(input.candidate_row_id, 'candidate_row_id');
  assertPresent(input.user_name, 'user_name');
  const row = {
    candidate_row_id: input.candidate_row_id,
    colour: input.colour ?? latestReview?.colour ?? null,
    justification: input.justification ?? latestReview?.justification ?? null,
    decision: input.decision ?? latestReview?.decision ?? DECISIONS.PENDING,
    reason_code: orNull(input.reason_code),
    comment: orNull(input.comment),
    user_name: input.user_name,
    engine_override_id: orNull(input.engine_override_id),
  };
  assertOneOf(row.colour, COLOURS, 'colour', { isNullable: true });
  assertOneOf(row.decision, DECISIONS, 'decision');
  return row;
}

// Commas and parentheses would change the PostgREST .or() structure; % is an ilike wildcard.
export function sanitizeSearch(q) {
  if (typeof q !== 'string') return '';
  return q.replace(/[,()%]/g, '').trim().slice(0, MAX_SEARCH_LENGTH);
}

export function normalizePage({ page, page_size: pageSize } = {}) {
  const pageNumber = Number.isInteger(Number(page)) && Number(page) >= 1 ? Number(page) : 1;
  const size = Number.isInteger(Number(pageSize)) && Number(pageSize) >= 1 ? Number(pageSize) : DEFAULT_PAGE_SIZE;
  return { page: pageNumber, page_size: Math.min(size, MAX_PAGE_SIZE) };
}
