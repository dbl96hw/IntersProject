import {
  API_BASE_URL,
  API_ERROR_CODES,
  API_PATHS,
  CANDIDATES_PAGE_SIZE,
  HEALTH_PATH,
  MAX_CANDIDATE_PAGES,
} from '../constants/api';
import { DASHBOARD_TEXT, HEALTH_TEXT, SIDEBAR_TEXT } from '../constants/messages';

export class ApiError extends Error {
  constructor({ code, message, field }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Error bodies are parsed too: the contract puts code, message and field there.
export async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError({
      code: API_ERROR_CODES.NETWORK,
      message: HEALTH_TEXT.UNREACHABLE,
      field: null,
    });
  }

  const body = await readJson(response);
  if (!response.ok) {
    const error = body?.error;
    throw new ApiError({
      code: error?.code ?? API_ERROR_CODES.UNEXPECTED,
      message: error?.message ?? HEALTH_TEXT.UNEXPECTED,
      field: error?.field ?? null,
    });
  }

  if (body === null) {
    throw new ApiError({
      code: API_ERROR_CODES.UNEXPECTED,
      message: HEALTH_TEXT.UNEXPECTED,
      field: null,
    });
  }

  return body;
}

export function getHealth() {
  return requestJson(HEALTH_PATH);
}

export async function listChats() {
  const body = await requestJson(API_PATHS.CHATS);
  if (!Array.isArray(body.chats)) {
    throw new ApiError({
      code: API_ERROR_CODES.UNEXPECTED,
      message: SIDEBAR_TEXT.LOAD_FAILED,
      field: null,
    });
  }
  return body.chats;
}

export function getChat(chatId) {
  return requestJson(`${API_PATHS.CHATS}/${chatId}`);
}

// Text only. The backend loads history from saved messages.
export function postChatMessage(chatId, text) {
  return sendJson(`${API_PATHS.CHATS}/${chatId}/messages`, 'POST', { text });
}

function sendJson(path, method, body) {
  return requestJson(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function listOverrideReasons() {
  return requestJson(API_PATHS.OVERRIDE_REASONS);
}

export function updateCandidate(id, body) {
  return sendJson(`${API_PATHS.CANDIDATES}/${id}`, 'PATCH', body);
}

export function recordCandidateDecision(id, body) {
  return sendJson(`${API_PATHS.CANDIDATES}/${id}/decision`, 'POST', body);
}

function incompleteListError() {
  return new ApiError({
    code: API_ERROR_CODES.UNEXPECTED,
    message: DASHBOARD_TEXT.LIST_INCOMPLETE,
    field: null,
  });
}

// Pages of 100 until `total` is reached. An empty page or the page cap is an error,
// so the screen never shows a partial dashboard.
export async function listChatCandidates(chatId) {
  const collected = [];
  let total = 0;

  for (let page = 1; page <= MAX_CANDIDATE_PAGES; page += 1) {
    const params = new URLSearchParams({
      chat_id: chatId,
      page: String(page),
      page_size: String(CANDIDATES_PAGE_SIZE),
    });
    const body = await requestJson(`${API_PATHS.CANDIDATES}?${params}`);
    const batch = Array.isArray(body.candidates) ? body.candidates : null;
    total = body.total;
    if (batch === null || !Number.isInteger(total) || total < 0) {
      throw incompleteListError();
    }
    if (batch.length === 0) {
      if (collected.length === total) {
        return { candidates: collected, total };
      }
      throw incompleteListError();
    }
    collected.push(...batch);
    if (collected.length >= total) {
      if (collected.length !== total) {
        throw incompleteListError();
      }
      return { candidates: collected, total };
    }
  }

  throw incompleteListError();
}
