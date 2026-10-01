/**
 * Table names and allowed values. Mirrors the check constraints in supabase/migrations/001_init.sql.
 */

export const TABLES = {
  CHATS: 'chats',
  MESSAGES: 'messages',
  FILES: 'files',
  CANDIDATES: 'candidates',
  CANDIDATE_REVIEWS: 'candidate_reviews',
};

export const VIEWS = {
  CANDIDATES_WITH_LATEST_REVIEW: 'candidates_with_latest_review',
};

export const COLOURS = { GREEN: 'GREEN', AMBER: 'AMBER', RED: 'RED' };
export const VERDICTS = { PASS: 'PASS', HOLD: 'HOLD', FAIL: 'FAIL' };
export const ROLES = { USER: 'user', ASSISTANT: 'assistant' };
export const MESSAGE_KINDS = { TEXT: 'text', ANALYSIS: 'analysis', ANSWER: 'answer' };
export const MESSAGE_STATUS = { OK: 'ok', ERROR: 'error' };
export const DECISIONS = { PENDING: 'pending', PASS: 'pass', NO_PASS: 'no_pass' };
export const JUSTIFICATION_SOURCES = { CLAUDE: 'claude', ENGINE: 'engine' };
export const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

export const WARNING_CODES = { SAMPLE_DATA: 'SAMPLE_DATA' };

export const DEFAULT_CHAT_TITLE = 'New chat';
export const MAX_CHAT_TITLE_LENGTH = 80;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;
