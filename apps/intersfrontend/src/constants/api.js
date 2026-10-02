/**
 * Frontend API-related constants.
 * Import these instead of repeating the same base URL or path.
 * This module is the only place that reads VITE_API_URL and VITE_BREEDER_USER.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Recorded on an override or a decision. Not a login. Empty until the breeder types a name.
export const BREEDER_USER = import.meta.env.VITE_BREEDER_USER || '';

export const HEALTH_PATH = '/health';

// How often the status line asks GET /health again. The first check still happens on load.
export const HEALTH_REFRESH_MS = 30000;

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
  DATA_ENGINE_UNAVAILABLE: 'DATA_ENGINE_UNAVAILABLE',
};

export const OTHER_REASON_CODE = 'OTHER';
