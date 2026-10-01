// Turn db rows into the exact response shapes of docs/api-contract.md.
// Engine fields pass through verbatim; internal columns (evidence_hash, latest_colour, ...) are dropped.

import path from 'node:path';
import { DECISIONS, FILE_KINDS, MESSAGE_KINDS, MESSAGE_STATUS, ROLES, TABLE_FILE_EXTENSIONS } from '../constants/index.js';
import { ENGINE_CANDIDATE_FIELDS } from '../db/rows.js';

const OUR_CANDIDATE_FIELDS = [
  'id',
  'chat_id',
  'message_id',
  'justification_source',
  'verified',
  'confidence',
  'created_at',
];

export function fileKindOf(name) {
  return TABLE_FILE_EXTENSIONS.includes(path.extname(name).toLowerCase()) ? FILE_KINDS.TABLE : FILE_KINDS.DOCUMENT;
}

export function toChatResponse({ id, title, created_at, updated_at }) {
  return { id, title, created_at, updated_at };
}

export function toFileRef({ id, name, mime_type, size_bytes }) {
  return { id, name, mime_type, size_bytes, kind: fileKindOf(name) };
}

export function toCandidateResponse(row) {
  const pick = (fields) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
  return {
    candidate_id: row.candidate_id,
    ...pick(ENGINE_CANDIDATE_FIELDS),
    data_gaps: row.data_gaps ?? [],
    ...pick(OUR_CANDIDATE_FIELDS),
    // A freshly saved row has no review yet, so it is still pending and unedited.
    decision: row.decision ?? DECISIONS.PENDING,
    edited: row.edited ?? false,
    // The breeder's edit replaces the generated text; justification_source and verified keep describing the original.
    justification: row.review_justification ?? row.justification ?? null,
  };
}

function toUserMessageResponse(message, files) {
  return {
    id: message.id,
    chat_id: message.chat_id,
    role: message.role,
    text: message.text,
    files: files.map(toFileRef),
    created_at: message.created_at,
  };
}

function toAssistantMessageResponse(message, candidates) {
  const isOk = message.status === MESSAGE_STATUS.OK;
  const isAnalysis = message.kind === MESSAGE_KINDS.ANALYSIS;
  const analysis = isOk && isAnalysis
    ? { ...message.analysis, candidates: candidates.map(toCandidateResponse), usage: message.usage, versions: message.versions }
    : null;
  const answer = isOk && !isAnalysis
    ? { text: message.text, tool_calls: message.tool_calls ?? [], usage: message.usage }
    : null;
  return {
    id: message.id,
    chat_id: message.chat_id,
    role: message.role,
    kind: message.kind,
    status: message.status,
    error: message.error ?? null,
    analysis,
    answer,
    created_at: message.created_at,
  };
}

export function toMessageResponse(message, { files = [], candidates = [] } = {}) {
  return message.role === ROLES.USER
    ? toUserMessageResponse(message, files)
    : toAssistantMessageResponse(message, candidates);
}
