/**
 * Limits and column names for extracting files and sending records to the data engine.
 * Key column names and aliases mirror services/data-engine/config/sources.yaml.
 */

export const MAX_RECORDS_PER_INGEST = 5000;
export const MIN_HEADER_TEXT_CELLS = 3;
export const MAX_IDS_PER_SQL = 1000;
export const MAX_SQL_ROWS = 10000;
export const MAX_IDS_IN_WARNING = 10;

export const CSV_DELIMITERS = [',', ';', '\t', '|'];

export const MEDIA_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const KEY_COLUMNS = {
  MATERIAL_GUID: ['MATERIAL_GUID', 'GID'],
  MATERIAL_ID: ['MATERIAL_ID'],
  TRIAL_GUID: ['TRIAL_GUID', 'ATTACHED_TO_FIELD_ENTITY_ID'],
  TRIAL_ID: ['TRIAL_ID'],
};

// Matched against the normalised header: these columns hold identifiers and always stay strings.
export const STRING_COLUMN_PATTERN = /(_GUID|_ID|_UUID|_LID)$|^(GID|BARCODE)$/;

// Only values of this shape are ever placed inside an engine SQL query.
export const ID_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;
