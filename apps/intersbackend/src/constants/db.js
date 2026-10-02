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

export const WARNING_CODES = {
  SAMPLE_DATA: 'SAMPLE_DATA',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  NO_HEADER_ROW: 'NO_HEADER_ROW',
  DUPLICATE_HEADER: 'DUPLICATE_HEADER',
  UNNAMED_COLUMN: 'UNNAMED_COLUMN',
  EMPTY_TABLE: 'EMPTY_TABLE',
  NO_RECORDS_EXTRACTED: 'NO_RECORDS_EXTRACTED',
  UNRESOLVED_IDS: 'UNRESOLVED_IDS',
  DOCUMENT_UPLOAD_FAILED: 'DOCUMENT_UPLOAD_FAILED',
  TRIAL_LINK_UNAVAILABLE: 'TRIAL_LINK_UNAVAILABLE',
  EXPLANATION_FAILED: 'EXPLANATION_FAILED',
  EXPLANATION_DEFERRED: 'EXPLANATION_DEFERRED',
  JUSTIFICATION_UNVERIFIED: 'JUSTIFICATION_UNVERIFIED',
  ANSWER_UNVERIFIED_NUMBERS: 'ANSWER_UNVERIFIED_NUMBERS',
  CLAUDE_NOTE: 'CLAUDE_NOTE',
  IRRELEVANT_FILE: 'IRRELEVANT_FILE',
  RELEVANCE_UNCERTAIN: 'RELEVANCE_UNCERTAIN',
  UPLOAD_CONFLICTS: 'UPLOAD_CONFLICTS',
};

export const DEFAULT_CHAT_TITLE = 'New chat';
export const MAX_CHAT_TITLE_LENGTH = 80;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 100;
