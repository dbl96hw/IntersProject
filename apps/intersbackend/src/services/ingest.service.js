// Sends uploaded files to the data engine. Tables go as records (POST /ingest/records).
// Documents first pass the engine's relevance gate, then go as bytes (POST /documents/base64).
// Claude does not extract them. The gate is the engine's own check, not a Claude call.
// Tables skip the gate: the engine already rejects a table whose columns match no known source.
// This layer never computes colours: it only maps readable ids to the engine's GUIDs
// through the engine's own read-only SQL.

import {
  FILE_KINDS,
  HTTP_STATUS,
  ID_VALUE_PATTERN,
  KEY_COLUMNS,
  MAX_IDS_PER_SQL,
  MAX_RECORDS_PER_INGEST,
  MAX_SQL_ROWS,
  RELEVANCE_DECISIONS,
  WARNING_CODES,
} from '../constants/index.js';
import { extractTables, normalizeHeader } from '../extractors/tables.js';
import { DataEngineError } from './dataEngineClient.js';
import { fileKindOf } from './responses.js';

const TRIAL_LINK_COLUMNS = ['TRIAL_GUID', 'MATERIAL_GUID'];

const warning = (code, message, file = null) => ({ code, message, file });
const isSafeId = (id) => ID_VALUE_PATTERN.test(id);
const isEngineUnavailable = (err) => err instanceof DataEngineError && err.status === HTTP_STATUS.BAD_GATEWAY;
// Engine counts summed over chunks; null when the engine did not report them (never guessed).
const addCount = (total, value) => (typeof value === 'number' ? (total ?? 0) + value : total);

function chunk(items, size) {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

// The engine detects the source from the columns of each call, so every chunk must show every
// column of the table: a column missing from a chunk is added as null to its first record only.
function withAllColumns(recordsChunk, allColumns) {
  const present = new Set(recordsChunk.flatMap((record) => Object.keys(record)));
  const missing = allColumns.filter((column) => !present.has(column));
  if (missing.length === 0) return recordsChunk;
  const [first, ...rest] = recordsChunk;
  return [{ ...first, ...Object.fromEntries(missing.map((column) => [column, null])) }, ...rest];
}

// Ids are pattern-checked before this; quotes are escaped anyway.
function sqlList(ids) {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
}

function keyValue(record, key) {
  const field = Object.keys(record).find((name) => KEY_COLUMNS[key].includes(normalizeHeader(name)));
  if (field === undefined) return undefined;
  const value = String(record[field] ?? '').trim();
  return value === '' ? undefined : value;
}

// Only the file name and the reason are logged, never contents or records.
function logFailure(fileName, step, err) {
  console.error(`ingest: ${fileName ?? '-'} ${step} failed (${err?.message})`);
}

export function createIngestService({ dataEngine }) {
  // Runs one SELECT per batch of ids. Engine-side query errors (not outages) return null so the
  // caller can warn and continue; an unreachable engine still fails the whole ingestion.
  async function queryIds(ids, buildQuery, step) {
    const rows = [];
    try {
      for (const batch of chunk([...ids].filter(isSafeId), MAX_IDS_PER_SQL)) {
        const result = await dataEngine.sql(buildQuery(sqlList(batch)), MAX_SQL_ROWS);
        rows.push(...(result.rows ?? []));
      }
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      logFailure(null, step, err);
      return null;
    }
    return rows;
  }

  async function ingestChunk(label, records) {
    try {
      return await dataEngine.ingestRecords(label, records);
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      return { accepted: false, detection: null, message: err.message };
    }
  }

  async function sendRecords(file, kind, label, records, state) {
    const item = {
      file: file.name,
      kind,
      accepted: false,
      source: null,
      rows: null,
      rows_added: null,
      duplicates_ignored: null,
      conflicts: null,
      message: null,
    };
    const allColumns = [...new Set(records.flatMap((record) => Object.keys(record)))];
    for (const [index, recordsChunk] of chunk(records, MAX_RECORDS_PER_INGEST).entries()) {
      const result = await ingestChunk(label, withAllColumns(recordsChunk, allColumns));
      if (index === 0) {
        item.accepted = result.accepted === true;
        item.source = result.detection?.source ?? null;
      }
      if (result.accepted !== true) {
        item.message = result.message ?? null;
        break;
      }
      item.rows = addCount(item.rows, result.rows);
      item.rows_added = addCount(item.rows_added, result.rows_added);
      item.duplicates_ignored = addCount(item.duplicates_ignored, result.duplicates_ignored);
      item.conflicts = addCount(item.conflicts, result.conflicts);
      if (result.message) item.message = result.message;
      state.acceptedRecords.push(...recordsChunk);
    }
    // The export is the system of record: the engine keeps it and reports the disagreement instead.
    if (item.conflicts > 0) {
      state.warnings.push(warning(
        WARNING_CODES.UPLOAD_CONFLICTS,
        `${item.conflicts} row(s) in "${file.name}" contradict the system-of-record export and were not applied; the export values are kept`,
        file.name,
      ));
    }
    state.ingestion.push(item);
  }

  async function ingestTableFile(file, state) {
    let extracted;
    try {
      extracted = extractTables(file.name, file.buffer);
    } catch (err) {
      logFailure(file.name, 'read', err);
      state.warnings.push(warning(WARNING_CODES.EXTRACTION_FAILED, `Could not read "${file.name}": the file is damaged or not a valid spreadsheet`, file.name));
      state.ingestion.push({
        file: file.name,
        kind: FILE_KINDS.TABLE,
        accepted: false,
        source: null,
        rows: null,
        rows_added: null,
        duplicates_ignored: null,
        conflicts: null,
        message: err.message,
      });
      return;
    }
    state.warnings.push(...extracted.warnings);
    for (const table of extracted.tables) {
      await sendRecords(file, FILE_KINDS.TABLE, table.label, table.records, state);
    }
  }

  // A gate failure that is not an outage (an engine without /relevance) lets the file through.
  async function relevanceOf(file) {
    if (typeof dataEngine.checkRelevance !== 'function') return null;
    try {
      return await dataEngine.checkRelevance({ filename: file.name, buffer: file.buffer });
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      logFailure(file.name, 'relevance', err);
      return null;
    }
  }

  // Returns false when the file must stop here (off-topic), true otherwise.
  async function passesRelevanceGate(file, state) {
    const relevance = await relevanceOf(file);
    if (relevance?.decision === RELEVANCE_DECISIONS.IRRELEVANT) {
      const reasons = (relevance.reasons ?? []).join('; ');
      state.ingestion.push({
        file: file.name,
        kind: FILE_KINDS.DOCUMENT,
        accepted: false,
        source: null,
        rows: null,
        rows_added: null,
        duplicates_ignored: null,
        conflicts: null,
        message: `Not about breeding or trial data, so it was not read or added${reasons ? ` (${reasons})` : ''}`,
      });
      state.warnings.push(warning(
        WARNING_CODES.IRRELEVANT_FILE,
        `"${file.name}" does not look like breeding or trial data; it was skipped`,
        file.name,
      ));
      return false;
    }
    if (relevance?.decision === RELEVANCE_DECISIONS.UNCERTAIN) {
      state.warnings.push(warning(
        WARNING_CODES.RELEVANCE_UNCERTAIN,
        `It is unclear whether "${file.name}" is about breeding; it was processed, please check the result`,
        file.name,
      ));
    }
    return true;
  }

  // The engine reads the file. We do not turn it into records here.
  async function ingestDocumentFile(file, state) {
    if (!(await passesRelevanceGate(file, state))) return;
    const item = {
      file: file.name,
      kind: FILE_KINDS.DOCUMENT,
      accepted: false,
      source: null,
      rows: null,
      rows_added: null,
      duplicates_ignored: null,
      conflicts: null,
      message: null,
    };
    try {
      await dataEngine.uploadDocument(file.name, file.buffer);
      item.accepted = true;
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      logFailure(file.name, 'upload', err);
      item.message = err.message;
      state.warnings.push(warning(
        WARNING_CODES.DOCUMENT_UPLOAD_FAILED,
        `"${file.name}" could not be added as searchable evidence: ${err.message}`,
        file.name,
      ));
    }
    state.ingestion.push(item);
  }

  async function hasTrialLink(state) {
    try {
      const { columns = [] } = await dataEngine.sql('SELECT * FROM trial_material LIMIT 1', 1);
      const normalized = columns.map(normalizeHeader);
      if (TRIAL_LINK_COLUMNS.every((column) => normalized.includes(column))) return true;
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      logFailure(null, 'check trial_material', err);
    }
    state.warnings.push(warning(WARNING_CODES.TRIAL_LINK_UNAVAILABLE, 'The engine has no trial-to-candidate link yet, so candidates touched only through trials are not listed'));
    return false;
  }

  // A record is linked by its most precise key: material id, then material GUID, then trial GUID, then trial id.
  async function findTouchedCandidateIds(state) {
    const candidateIds = new Set();
    const keys = { MATERIAL_GUID: new Set(), TRIAL_GUID: new Set(), TRIAL_ID: new Set() };
    for (const record of state.acceptedRecords) {
      const materialId = keyValue(record, 'MATERIAL_ID');
      if (materialId && isSafeId(materialId)) {
        candidateIds.add(materialId);
        continue;
      }
      const key = ['MATERIAL_GUID', 'TRIAL_GUID', 'TRIAL_ID'].find((name) => keyValue(record, name));
      if (key) keys[key].add(keyValue(record, key));
    }

    const queries = [];
    if (keys.MATERIAL_GUID.size > 0) {
      queries.push([keys.MATERIAL_GUID, (list) => `SELECT DISTINCT candidate_id FROM materials WHERE MATERIAL_GUID IN (${list})`]);
    }
    if ((keys.TRIAL_GUID.size > 0 || keys.TRIAL_ID.size > 0) && await hasTrialLink(state)) {
      queries.push([keys.TRIAL_GUID, (list) => `SELECT DISTINCT m.candidate_id FROM trial_material tm JOIN materials m ON m.MATERIAL_GUID = tm.MATERIAL_GUID WHERE tm.TRIAL_GUID IN (${list})`]);
      queries.push([keys.TRIAL_ID, (list) => `SELECT DISTINCT m.candidate_id FROM trials t JOIN trial_material tm ON tm.TRIAL_GUID = t.TRIAL_GUID JOIN materials m ON m.MATERIAL_GUID = tm.MATERIAL_GUID WHERE t.TRIAL_ID IN (${list})`]);
    }
    for (const [ids, buildQuery] of queries.filter(([ids]) => ids.size > 0)) {
      const rows = await queryIds(ids, buildQuery, 'resolve touched candidates');
      for (const row of rows ?? []) {
        if (row.candidate_id) candidateIds.add(String(row.candidate_id));
      }
    }
    return [...candidateIds].sort();
  }

  async function ingestNow(files) {
    const state = { ingestion: [], warnings: [], acceptedRecords: [] };
    for (const file of files) {
      if (fileKindOf(file.name) === FILE_KINDS.TABLE) await ingestTableFile(file, state);
      else await ingestDocumentFile(file, state);
    }
    const touchedCandidateIds = await findTouchedCandidateIds(state);
    return { ingestion: state.ingestion, touchedCandidateIds, warnings: state.warnings };
  }

  // The engine rebuilds its model on every ingest, so two uploads must never interleave their calls.
  let queue = Promise.resolve();
  function ingestFiles(files) {
    const run = queue.then(() => ingestNow(files));
    queue = run.catch(() => {});
    return run;
  }

  return { ingestFiles };
}
