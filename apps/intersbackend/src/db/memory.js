// In-memory data layer for ANALYSIS_MODE=mock and tests. Same functions and rules as the Supabase repos.

import { randomUUID } from 'node:crypto';
import { DECISIONS, JUSTIFICATION_SOURCES } from '../constants/index.js';
import {
  normalizePage,
  pickEngineFields,
  sanitizeSearch,
  toCandidateRow,
  toChatRow,
  toFileRow,
  toMessagePatch,
  toMessageRow,
  toReviewRow,
} from './rows.js';

// Strictly increasing timestamps so "newest first" and "latest review" are deterministic within one millisecond.
function createClock() {
  let lastTime = 0;
  return () => {
    lastTime = Math.max(Date.now(), lastTime + 1);
    return new Date(lastTime).toISOString();
  };
}

const copy = (value) => (value === null || value === undefined ? null : structuredClone(value));
const byCreatedAt = (a, b) => a.created_at.localeCompare(b.created_at);

export function createMemoryDb() {
  const now = createClock();
  const chats = new Map();
  const messages = new Map();
  const files = new Map();
  const candidates = new Map();
  const reviews = [];

  function assertExists(map, id, name) {
    if (!map.has(id)) throw new Error(`${name} ${id} does not exist`);
  }

  function insert(map, row) {
    const stored = { id: randomUUID(), ...structuredClone(row), created_at: now() };
    map.set(stored.id, stored);
    return copy(stored);
  }

  function latestReviewOf(candidateRowId) {
    return reviews.findLast((review) => review.candidate_row_id === candidateRowId) ?? null;
  }

  // Same columns as the candidates_with_latest_review view.
  function withLatestReview(candidate) {
    const latest = latestReviewOf(candidate.id);
    return {
      ...copy(candidate),
      review_colour: latest?.colour ?? null,
      review_justification: latest?.justification ?? null,
      decision: latest?.decision ?? DECISIONS.PENDING,
      edited: Boolean(latest?.justification),
      reviewed_at: latest?.created_at ?? null,
      latest_colour: latest?.colour ?? candidate.colour,
    };
  }

  function matchesFilters(candidate, filters, term) {
    if (filters.colour && candidate.latest_colour !== filters.colour) return false;
    if (filters.decision && candidate.decision !== filters.decision) return false;
    if (filters.chat_id && candidate.chat_id !== filters.chat_id) return false;
    if (!term) return true;
    const needle = term.toLowerCase();
    return [candidate.candidate_id, candidate.reason].some((value) => value?.toLowerCase().includes(needle));
  }

  const chatsRepo = {
    async createChat(input) {
      const createdAt = now();
      const chat = { id: randomUUID(), ...toChatRow(input), created_at: createdAt, updated_at: createdAt };
      chats.set(chat.id, chat);
      return copy(chat);
    },
    async listChats() {
      return [...chats.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(copy);
    },
    async getChat(id) {
      return copy(chats.get(id));
    },
    async updateChatTitle(id, title) {
      const chat = chats.get(id);
      if (!chat) return null;
      Object.assign(chat, { title, updated_at: now() });
      return copy(chat);
    },
    async touchChat(id) {
      const chat = chats.get(id);
      if (chat) chat.updated_at = now();
    },
  };

  const messagesRepo = {
    async saveMessage(input) {
      const row = toMessageRow(input);
      assertExists(chats, row.chat_id, 'chat');
      const message = insert(messages, row);
      await chatsRepo.touchChat(message.chat_id);
      return message;
    },
    async getMessage(id) {
      return copy(messages.get(id));
    },
    async listMessages(chatId) {
      return [...messages.values()].filter((message) => message.chat_id === chatId).sort(byCreatedAt).map(copy);
    },
    async updateMessage(id, patch) {
      assertExists(messages, id, 'message');
      Object.assign(messages.get(id), structuredClone(toMessagePatch(patch)));
      return copy(messages.get(id));
    },
  };

  const filesRepo = {
    async saveFiles(inputs) {
      const rows = inputs.map(toFileRow);
      rows.forEach((row) => assertExists(messages, row.message_id, 'message'));
      return rows.map((row) => insert(files, row));
    },
    async listFilesByChat(chatId) {
      return [...files.values()].filter((file) => file.chat_id === chatId).sort(byCreatedAt).map(copy);
    },
    async listFilesByMessage(messageId) {
      return [...files.values()].filter((file) => file.message_id === messageId).sort(byCreatedAt).map(copy);
    },
  };

  const candidatesRepo = {
    async saveCandidates(inputs) {
      const rows = inputs.map(toCandidateRow);
      rows.forEach((row) => assertExists(messages, row.message_id, 'message'));
      return rows.map((row) => insert(candidates, row));
    },
    async getCandidate(id) {
      const candidate = candidates.get(id);
      return candidate ? withLatestReview(candidate) : null;
    },
    async listCandidatesByChat(chatId) {
      return [...candidates.values()].filter((candidate) => candidate.chat_id === chatId).sort(byCreatedAt).map(withLatestReview);
    },
    async updateEngineFields(id, engineRow) {
      assertExists(candidates, id, 'candidate');
      Object.assign(candidates.get(id), structuredClone(pickEngineFields(engineRow)));
      return candidatesRepo.getCandidate(id);
    },
    async listCandidates(filters = {}) {
      const { page, page_size: pageSize } = normalizePage(filters);
      const term = sanitizeSearch(filters.q);
      const matching = [...candidates.values()]
        .map(withLatestReview)
        .filter((candidate) => matchesFilters(candidate, filters, term))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const from = (page - 1) * pageSize;
      return { candidates: matching.slice(from, from + pageSize), page, page_size: pageSize, total: matching.length };
    },
    async addReview(input) {
      assertExists(candidates, input.candidate_row_id, 'candidate');
      const row = toReviewRow(input, latestReviewOf(input.candidate_row_id));
      const review = Object.freeze({ id: randomUUID(), ...row, created_at: now() });
      reviews.push(review);
      return copy(review);
    },
    async listReviews(candidateRowId) {
      return reviews.filter((review) => review.candidate_row_id === candidateRowId).map(copy);
    },
    async findReusableJustification(candidateId, ruleVersion, evidenceHash) {
      const match = [...candidates.values()]
        .filter((candidate) => candidate.candidate_id === candidateId
          && candidate.rule_version === ruleVersion
          && candidate.evidence_hash === evidenceHash
          && candidate.justification_source === JUSTIFICATION_SOURCES.CLAUDE
          && candidate.verified === true)
        .sort(byCreatedAt)
        .at(-1);
      return copy(match);
    },
  };

  return { chats: chatsRepo, messages: messagesRepo, files: filesRepo, candidates: candidatesRepo };
}
