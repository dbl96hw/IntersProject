// Sends uploaded files to the data engine. Tables go as-is; documents go through Claude's extraction
// (injected) and then as records. This layer never computes colours or joins sources: it only maps
// readable ids to the engine's GUIDs (and back) through the engine's own read-only SQL.

import path from 'node:path';
import {
  FILE_KINDS,
  HTTP_STATUS,
  ID_VALUE_PATTERN,
  KEY_COLUMNS,
  MAX_IDS_IN_WARNING,
  MAX_IDS_PER_SQL,
  MAX_RECORDS_PER_INGEST,
  MAX_SQL_ROWS,
  WARNING_CODES,
} from '../constants/index.js';
import { extractDocxText } from '../extractors/docx.js';
import { toMedia } from '../extractors/media.js';
import { extractTables, normalizeHeader } from '../extractors/tables.js';
import { DataEngineError } from './dataEngineClient.js';
import { fileKindOf } from './responses.js';

const TRIAL_LINK_COLUMNS = ['TRIAL_GUID', 'MATERIAL_GUID'];

const warning = (code, message, file = null) => ({ code, message, file });
const isSafeId = (id) => ID_VALUE_PATTERN.test(id);
const isEngineUnavailable = (err) => err instanceof DataEngineError && err.status === HTTP_STATUS.BAD_GATEWAY;

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

function listIds(ids) {
  const shown = ids.slice(0, MAX_IDS_IN_WARNING).join(', ');
  return ids.length > MAX_IDS_IN_WARNING ? `${shown} (+${ids.length - MAX_IDS_IN_WARNING} more)` : shown;
}

// Only the file name and the reason are logged, never contents or records.
function logFailure(fileName, step, err) {
  console.error(`ingest: ${fileName ?? '-'} ${step} failed (${err?.message})`);
}

async function documentContent(file) {
  if (path.extname(file.name).toLowerCase() === '.docx') {
    return { type: 'text', text: await extractDocxText(file.buffer) };
  }
  return { type: 'media', ...toMedia(file.name, file.buffer) };
}

export function createIngestService({ dataEngine, claudeExtract }) {
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
    const item = { file: file.name, kind, accepted: false, source: null, rows: null, message: null };
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
      if (typeof result.rows === 'number') item.rows = (item.rows ?? 0) + result.rows;
      state.acceptedRecords.push(...recordsChunk);
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
      return;
    }
    state.warnings.push(...extracted.warnings);
    for (const table of extracted.tables) {
      await sendRecords(file, FILE_KINDS.TABLE, table.label, table.records, state);
    }
  }

  async function extractDocumentRecords(file, state) {
    let groups;
    try {
      groups = await claudeExtract({ file: file.name, content: await documentContent(file) });
    } catch (err) {
      logFailure(file.name, 'extract', err);
      state.warnings.push(warning(WARNING_CODES.EXTRACTION_FAILED, `Could not extract records from "${file.name}"`, file.name));
      return [];
    }
    const nonEmpty = (groups ?? []).filter((group) => Array.isArray(group.records) && group.records.length > 0);
    if (nonEmpty.length === 0) {
      state.warnings.push(warning(WARNING_CODES.NO_RECORDS_EXTRACTED, `No records were found in "${file.name}"; nothing from it was sent as records`, file.name));
    }
    return nonEmpty;
  }

  async function lookupGuids(ids, buildQuery, step) {
    const rows = ids.size > 0 ? await queryIds(ids, buildQuery, step) : [];
    return new Map((rows ?? []).map((row) => [String(row.id), row.guid]));
  }

  // Records whose readable id has no GUID in the engine are omitted: a GUID is never guessed.
  async function resolveDocumentIds(file, groups, state) {
    const needed = { MATERIAL: new Set(), TRIAL: new Set() };
    const needsOf = (record) => ({
      MATERIAL: !keyValue(record, 'MATERIAL_GUID') ? keyValue(record, 'MATERIAL_ID') : undefined,
      TRIAL: !keyValue(record, 'TRIAL_GUID') ? keyValue(record, 'TRIAL_ID') : undefined,
    });
    groups.forEach((group) => group.records.forEach((record) => {
      const needs = needsOf(record);
      if (needs.MATERIAL) needed.MATERIAL.add(needs.MATERIAL);
      if (needs.TRIAL) needed.TRIAL.add(needs.TRIAL);
    }));

    const materialGuids = await lookupGuids(needed.MATERIAL, (list) => `SELECT candidate_id AS id, MATERIAL_GUID AS guid FROM materials WHERE candidate_id IN (${list})`, 'resolve material ids');
    const trialGuids = await lookupGuids(needed.TRIAL, (list) => `SELECT TRIAL_ID AS id, TRIAL_GUID AS guid FROM trials WHERE TRIAL_ID IN (${list})`, 'resolve trial ids');

    const unresolved = new Set();
    let omitted = 0;
    const resolvedGroups = groups.map((group) => ({
      source: group.source,
      records: group.records.flatMap((record) => {
        const needs = needsOf(record);
        const materialGuid = needs.MATERIAL && materialGuids.get(needs.MATERIAL);
        const trialGuid = needs.TRIAL && trialGuids.get(needs.TRIAL);
        if (needs.MATERIAL && !materialGuid) unresolved.add(needs.MATERIAL);
        if (needs.TRIAL && !trialGuid) unresolved.add(needs.TRIAL);
        if ((needs.MATERIAL && !materialGuid) || (needs.TRIAL && !trialGuid)) {
          omitted += 1;
          return [];
        }
        return [{
          ...record,
          ...(materialGuid ? { MATERIAL_GUID: materialGuid } : {}),
          ...(trialGuid ? { TRIAL_GUID: trialGuid } : {}),
        }];
      }),
    }));

    if (omitted > 0) {
      state.warnings.push(warning(
        WARNING_CODES.UNRESOLVED_IDS,
        `${omitted} record(s) from "${file.name}" were omitted and not sent to the engine because these ids were not found in the engine: ${listIds([...unresolved])}`,
        file.name,
      ));
    }
    return resolvedGroups;
  }

  async function uploadDocument(file, state) {
    try {
      await dataEngine.uploadDocument(file.name, file.buffer);
    } catch (err) {
      if (!(err instanceof DataEngineError) || isEngineUnavailable(err)) throw err;
      logFailure(file.name, 'upload', err);
      state.warnings.push(warning(WARNING_CODES.DOCUMENT_UPLOAD_FAILED, `"${file.name}" could not be added as searchable evidence: ${err.message}`, file.name));
    }
  }

  async function ingestDocumentFile(file, state) {
    if (!claudeExtract) {
      state.warnings.push(warning(WARNING_CODES.NO_RECORDS_EXTRACTED, `Record extraction from documents is not available yet; "${file.name}" was only added as searchable evidence`, file.name));
    } else {
      const groups = await extractDocumentRecords(file, state);
      const resolvedGroups = groups.length > 0 ? await resolveDocumentIds(file, groups, state) : [];
      for (const group of resolvedGroups.filter((resolved) => resolved.records.length > 0)) {
        await sendRecords(file, FILE_KINDS.DOCUMENT, `${file.name}#${group.source}`, group.records, state);
      }
    }
    await uploadDocument(file, state);
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
