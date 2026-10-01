import { JUSTIFICATION_SOURCES, TABLES, VIEWS } from '../constants/index.js';
import { normalizePage, pickEngineFields, sanitizeSearch, toCandidateRow, toReviewRow } from './rows.js';
import { getSupabase, unwrap } from './supabase.js';

const candidatesTable = () => getSupabase().from(TABLES.CANDIDATES);
const reviewsTable = () => getSupabase().from(TABLES.CANDIDATE_REVIEWS);
const candidatesView = () => getSupabase().from(VIEWS.CANDIDATES_WITH_LATEST_REVIEW);

// Returns null when nothing is left to search, so no .or() filter is added.
export function buildSearchFilter(q) {
  const term = sanitizeSearch(q);
  if (!term) return null;
  return `candidate_id.ilike.%${term}%,reason.ilike.%${term}%`;
}

export async function saveCandidates(inputs) {
  if (inputs.length === 0) return [];
  return unwrap(await candidatesTable().insert(inputs.map(toCandidateRow)).select());
}

export async function getCandidate(id) {
  return unwrap(await candidatesView().select('*').eq('id', id).maybeSingle());
}

export async function listCandidatesByChat(chatId) {
  return unwrap(await candidatesView().select('*').eq('chat_id', chatId).order('created_at', { ascending: true }));
}

export async function updateEngineFields(id, engineRow) {
  unwrap(await candidatesTable().update(pickEngineFields(engineRow)).eq('id', id));
  return getCandidate(id);
}

export async function listCandidates(filters = {}) {
  const { page, page_size: pageSize } = normalizePage(filters);
  const from = (page - 1) * pageSize;

  let query = candidatesView().select('*', { count: 'exact' });
  if (filters.colour) query = query.eq('latest_colour', filters.colour);
  if (filters.decision) query = query.eq('decision', filters.decision);
  if (filters.chat_id) query = query.eq('chat_id', filters.chat_id);
  const searchFilter = buildSearchFilter(filters.q);
  if (searchFilter) query = query.or(searchFilter);

  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  const candidates = unwrap({ data, error });
  return { candidates, page, page_size: pageSize, total: count ?? 0 };
}

export async function addReview(input) {
  const latestReview = unwrap(await reviewsTable()
    .select('*')
    .eq('candidate_row_id', input.candidate_row_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  return unwrap(await reviewsTable().insert(toReviewRow(input, latestReview)).select().single());
}

export async function listReviews(candidateRowId) {
  return unwrap(await reviewsTable().select('*').eq('candidate_row_id', candidateRowId).order('created_at', { ascending: true }));
}

export async function findReusableJustification(candidateId, ruleVersion, evidenceHash) {
  return unwrap(await candidatesTable()
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('rule_version', ruleVersion)
    .eq('evidence_hash', evidenceHash)
    .eq('justification_source', JUSTIFICATION_SOURCES.CLAUDE)
    .eq('verified', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}
