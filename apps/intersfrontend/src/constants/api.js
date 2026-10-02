/**
 * Frontend API-related constants.
 * Import these instead of repeating the same base URL or path.
 * The base URL is the only place that reads VITE_API_URL.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const HEALTH_PATH = '/health';

export const API_PATHS = {
  CHATS: '/api/chats',
  CANDIDATES: '/api/candidates',
  OVERRIDE_REASONS: '/api/engine/override-reasons',
};

// Candidates list page size. The contract maximum is 100.
export const CANDIDATES_PAGE_SIZE = 100;

// Stop paging if the list never reaches `total`. 150 candidates need 2 pages.
export const MAX_CANDIDATE_PAGES = 10;

export const API_ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  UNEXPECTED: 'UNEXPECTED_RESPONSE',
};
