/**
 * Triage-related constants for the use case 4 dashboard.
 * Status keys match the data engine's `colour` values (GREEN / AMBER / RED).
 * Labels are suggestions, never decisions: the UI must not say "approved" or "rejected"
 * (docs/api-contract.md). The breeder decides; the colour only says where to look first.
 */

export const TRIAGE_STATUS = {
  GREEN: {
    key: 'GREEN',
    label: 'Strong candidate',
    description: 'Meets the advancement criteria in the data',
    modifier: 'green',
  },
  AMBER: {
    key: 'AMBER',
    label: 'Needs review',
    description: 'Mixed or borderline evidence: worth a closer look',
    modifier: 'amber',
  },
  RED: {
    key: 'RED',
    label: 'Concerns',
    description: 'Fails one or more criteria in the data',
    modifier: 'red',
  },
};

// Filter value meaning "show every status"; kept separate from the real status keys.
export const STATUS_FILTER_ALL = 'ALL';

// Red first: the engine sorts that way so the breeder looks at concerns before the rest.
export const TRIAGE_STATUS_ORDER = [TRIAGE_STATUS.RED.key, TRIAGE_STATUS.AMBER.key, TRIAGE_STATUS.GREEN.key];

// One shared config keeps the three tables' columns aligned (used with table-layout: fixed).
export const TABLE_COLUMNS = [
  { key: 'candidate_id', label: 'Candidate ID', width: '22%' },
  { key: 'trials', label: 'Trials failed/total', width: '18%' },
  { key: 'reason', label: 'Justification', width: '60%' },
];

export const CANDIDATE_DECISIONS = {
  PASS: 'pass',
  NO_PASS: 'no_pass',
};

// The file upload component accepts these file types (can be changed depending of the BE)
export const ACCEPTED_FILE_TYPES =
  '.csv,.tsv,.xlsx,.json,.parquet,.pdf,.png,.jpg,.jpeg,.tiff,.docx,.pptx,.html,.txt';

// Upload through the API is a later story. Until then Create dashboard stays disabled.
export const FILE_UPLOAD_AVAILABLE = false;

// The modal sends a real colour change and a real pass / no pass.
export const CANDIDATE_SAVE_AVAILABLE = true;

export const MOCK_ANALYSIS_DELAY_MS = 1500;

export const MOCK_CHAT_DELAY_MS = 800;
