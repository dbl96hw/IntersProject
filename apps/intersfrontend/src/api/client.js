import { API_BASE_URL, API_ERROR_CODES, HEALTH_PATH } from '../constants/api';
import { HEALTH_TEXT } from '../constants/messages';

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
