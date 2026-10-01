/**
 * Triage-related constants for the use case 4 dashboard.
 * Status keys match the data engine's `colour` values (GREEN / AMBER / RED).
 */

export const TRIAGE_STATUS = {
  GREEN: {
    key: 'GREEN',
    label: 'Approved',
    description: 'Meet the established criteria',
    modifier: 'green',
  },
  AMBER: {
    key: 'AMBER',
    label: 'Conditional',
    description: 'Partially meet the criteria',
    modifier: 'amber',
  },
  RED: {
    key: 'RED',
    label: 'Not approved',
    description: 'Do not meet the criteria',
    modifier: 'red',
  },
};

// Filter value meaning "show every status"; kept separate from the real status keys.
export const STATUS_FILTER_ALL = 'ALL';

export const TRIAGE_STATUS_ORDER = [TRIAGE_STATUS.GREEN.key, TRIAGE_STATUS.AMBER.key, TRIAGE_STATUS.RED.key];

// One shared config keeps the three tables' columns aligned (used with table-layout: fixed).
export const TABLE_COLUMNS = [
  { key: 'candidate_id', label: 'Candidate ID', width: '17%' },
  { key: 'crop', label: 'Crop', width: '13%' },
  { key: 'mean_yield_t_ha', label: 'Mean yield (t/ha)', width: '17%' },
  { key: 'trials', label: 'Trials failed/total', width: '17%' },
  { key: 'reason', label: 'Justification', width: '36%' },
];

// Same codes as the data engine's override audit log (`GET /overrides/reasons`).
export const OVERRIDE_REASONS = [
  { code: 'FIELD_OBSERVATION', label: 'Field observation not captured in the data' },
  { code: 'DATA_ERROR', label: 'The underlying data is wrong or incomplete' },
  { code: 'MARKET_FIT', label: 'Commercial or market considerations' },
  { code: 'PEDIGREE_KNOWLEDGE', label: "Knowledge of the line's pedigree or crosses" },
  { code: 'ENVIRONMENT_CONTEXT', label: 'Unusual season, location, or disease pressure' },
  { code: 'STRATEGIC_KEEP', label: 'Kept for a breeding-programme reason' },
  { code: 'OTHER', label: 'Other (explain in the comment)' },
];

// The file upload component accepts these file types (can be changed depending of the BE)
export const ACCEPTED_FILE_TYPES =
  '.csv,.tsv,.xlsx,.json,.parquet,.pdf,.png,.jpg,.jpeg,.tiff,.docx,.pptx,.html,.txt';

export const MOCK_ANALYSIS_DELAY_MS = 1500;

export const MOCK_CHAT_DELAY_MS = 800;
