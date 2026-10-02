export const APP_NAME = 'Git Push & Pray';

export const SIDEBAR_TEXT = {
  NEW_DASHBOARD: 'New dashboard',
  RECENT_DASHBOARDS: 'Recent dashboards',
  NO_DASHBOARDS: 'No dashboards yet',
  LOADING: 'Loading dashboards.',
  LOAD_FAILED: 'The dashboard list could not be loaded.',
  HIDDEN_DASHBOARDS: 'more dashboards are not shown',
  BREEDER: 'Breeder',
};

export const WELCOME_TEXT = {
  GREETING: 'How can I help you today?',
  DROPZONE_TITLE: 'Upload your files to create your dashboard',
  DROPZONE_HINT: 'Drag and drop them here, or browse from your computer',
  LIMITS: 'Up to 10 files of 10 MB each: CSV, XLSX, XLS, PDF, DOCX, PNG, JPG or WEBP.',
  DROPZONE_ACTIVE: 'Drop your files to add them',
  BROWSE_FILES: 'Browse files',
  REMOVE_FILE: 'Remove file',
  SUBMIT: 'Create dashboard',
  ANALYZING: 'Analyzing your files. With many candidates this takes about a minute and a half; keep this tab open.',
  UPLOAD_FAILED: 'The files could not be analyzed. Try again, or check the backend status above.',
  FILES_SELECTED: 'Selected files',
  UPLOAD_COMING_SOON: 'File upload is coming soon. Creating a dashboard from files is not available yet.',
};

export const HEALTH_TEXT = {
  LOADING: 'Checking whether the backend and the data engine are reachable.',
  UNREACHABLE: 'The backend is not reachable.',
  UNEXPECTED: 'The backend returned an unexpected error.',
  STATUS_LABEL: 'Backend status',
  MODE_LABEL: 'Mode',
  ENGINE_LABEL: 'Engine',
  MOCK_NOTICE: 'The backend is in mock mode. Colour changes are not saved.',
};

export const DASHBOARD_TEXT = {
  TITLE: 'Candidate triage dashboard',
  SUBTITLE: 'Result of the analysis of the files you uploaded',
  FILES_ANALYZED: 'Files analyzed',
  CANDIDATES_EVALUATED: 'candidates evaluated',
  CANDIDATE_ONE: 'candidate',
  CANDIDATE_OTHER: 'candidates',
  EMPTY_SECTION: 'No candidates in this group',
  OVERRIDDEN_BADGE: 'Overridden',
  ROW_HINT: 'Click a row to expand it. Right-click a row to edit it.',
  LOADING: 'Loading candidates.',
  EMPTY: 'This dashboard has no candidates.',
  LIST_INCOMPLETE: 'The candidate list stopped before every row arrived. Nothing is shown.',
  UNVERIFIED_BADGE: 'Unverified',
  AMBIGUOUS_TRIALS: 'Ambiguous trials',
  ATYPICAL: 'Atypical',
  SOURCE_LABEL: 'Source',
  ENGINE_REASON: 'Engine reason',
  BREEDER_OVERRIDE: 'Breeder override',
  DECISION_LABEL: 'Decision',
  FILES_TITLE: 'Files in this analysis',
  FILE_USED: 'used',
  FILE_NOT_USED: 'not used',
  ROWS: 'rows',
};

export const FILTER_TEXT = {
  SEARCH_LABEL: 'Search candidates',
  SEARCH_PLACEHOLDER: 'Search by ID or justification',
  STATUS_GROUP_LABEL: 'Filter by status',
  STATUS_ALL: 'All',
  NO_RESULTS: 'No candidates match your filters.',
};

export const EDIT_TEXT = {
  MENU_EDIT_ROW: 'Edit row',
  MODAL_TITLE: 'Edit candidate',
  STATUS: 'Status',
  OVERRIDE_REASON: 'Override reason',
  OVERRIDE_REASON_PLACEHOLDER: 'Select a reason',
  COMMENT_OPTIONAL: 'Comment (optional)',
  COMMENT_REQUIRED: 'Comment (required for Other)',
  REASON_REQUIRED: 'Choose an override reason to change the status.',
  COMMENT_REQUIRED_ERROR: 'A comment is required when the reason is Other.',
  USER_REQUIRED: 'Enter a breeder name before saving. This is not a login.',
  REASONS_LOADING: 'Loading override reasons.',
  REASONS_FAILED: 'Override reasons could not be loaded.',
  ENGINE_DOWN: 'The data engine is down. The row was not changed.',
  PASS: 'Pass',
  NO_PASS: 'No pass',
  CANCEL: 'Cancel',
  SAVE: 'Save colour change',
};

export function missingReasonText(count) {
  if (count === 1) {
    return '1 candidate has no reason and is not shown';
  }
  return `${count} candidates have no reason and are not shown`;
}

export const CHAT_TEXT = {
  TITLE: 'Chat with Git Push & Pray',
  INPUT_PLACEHOLDER: 'Ask about a candidate...',
  SEND: 'Send message',
  MINIMIZE: 'Minimize chat',
  CLOSE: 'Close chat',
  OPEN: 'Open chat',
  TYPING: 'Typing...',
  NO_CHAT: 'Open a dashboard before asking a question.',
  READONLY: 'This chat cannot change a colour. Decide on the table.',
  NUMBER_WARNING: 'Some numbers in this answer could not be checked against the engine data. Review them before relying on them.',
  ERROR_FALLBACK: 'The assistant could not answer. Try again.',
  NETWORK: 'The server did not answer. Check that the backend is running.',
};
