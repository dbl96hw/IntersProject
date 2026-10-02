/**
 * Claude call settings, tool names and prompt ids.
 */

export const LLM_TOOL_NAMES = {
  SUBMIT_RECORDS: 'submit_records',
  SUBMIT_JUSTIFICATIONS: 'submit_justifications',
};

export const LLM_MAX_TOKENS = 8192;
export const LLM_TIMEOUT_MS = 60_000;
export const LLM_RETRY_DELAY_MS = 1000;
export const RETRYABLE_STATUSES = [429, 529];
export const MIN_SERVER_ERROR_STATUS = 500;
export const STOP_REASON_MAX_TOKENS = 'max_tokens';

export const PROMPT_IDS = {
  EXPLANATION: 'explanation.v1',
  EXTRACTION: 'extraction.v1',
};

export const MAX_JUSTIFICATION_SENTENCES = 3;
export const EVIDENCE_FALLBACK_STATEMENTS = 2;

// Why the evidence check rejected a justification (internal, not part of the API contract).
export const REJECTION_TYPES = {
  ID: 'id',
  NUMBER: 'number',
  NUMBER_WORD: 'number_word',
  CITED_VALUE: 'cited_value',
  COLOUR: 'colour',
};

// Candidate and trial ids such as SYN-MZ-00001 or SYN-TR-0025, matched case-insensitively.
export const ENTITY_ID_PATTERN = /\b[A-Z]{2,5}-[A-Z]{2,5}-\d{3,6}\b/gi;

// Spelled-out counts (lower-case, accent-free). One / uno / una / un are left out: they are also articles.
export const NUMBER_WORDS = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
]);

// Lower-case, accent-free colour words (English and Spanish, with common Spanish inflections).
export const COLOUR_NAMES = {
  green: 'GREEN',
  verde: 'GREEN',
  verdes: 'GREEN',
  amber: 'AMBER',
  ambar: 'AMBER',
  red: 'RED',
  rojo: 'RED',
  roja: 'RED',
  rojos: 'RED',
  rojas: 'RED',
};
