// Reads CSV / XLSX into one table per sheet with the original header names.
// Values are only cleaned and typed here; sources, joins and colours are the data engine's job.

import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  CSV_DELIMITERS,
  MIN_HEADER_TEXT_CELLS,
  STRING_COLUMN_PATTERN,
  WARNING_CODES,
} from '../constants/index.js';

// No exponent and no leading zeros, so codes like "007" or "1E5" stay strings.
const NUMERIC_TEXT_PATTERN = /^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

// Same normalisation as the engine (services/data-engine/src/data_engine/ingest.py).
export function normalizeHeader(header) {
  return String(header).trim().toUpperCase().replace(/[ -]/g, '_');
}

// Picks the delimiter that occurs most often outside quotes in the first non-empty line.
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const counts = new Map(CSV_DELIMITERS.map((delimiter) => [delimiter, 0]));
  let isQuoted = false;
  for (const character of firstLine) {
    if (character === '"') isQuoted = !isQuoted;
    else if (!isQuoted && counts.has(character)) counts.set(character, counts.get(character) + 1);
  }
  const [best, bestCount] = [...counts].reduce((top, entry) => (entry[1] > top[1] ? entry : top));
  return bestCount > 0 ? best : ',';
}

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const isNumericText = (value) => typeof value === 'string' && NUMERIC_TEXT_PATTERN.test(value.trim());
const isTextCell = (value) => typeof value === 'string' && value.trim() !== '' && !isNumericText(value);

function formatDate(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function cleanCell(value) {
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'string') return value.trim();
  return value;
}

function readWorkbook(name, buffer) {
  if (path.extname(name).toLowerCase() === '.csv') {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return XLSX.read(text, { type: 'string', raw: true, FS: detectDelimiter(text) });
  }
  return XLSX.read(buffer, { type: 'buffer', cellDates: true });
}

function warning(code, message, file) {
  return { code, message, file };
}

// A column with a header is always kept, even when every cell is empty: the engine detects the
// source from the header set, so dropping empty columns would make known sources look UNKNOWN.
function pickColumns(file, label, headerRow, dataRows, warnings) {
  const width = Math.max(headerRow.length, ...dataRows.map((row) => row.length));
  const seen = new Map();
  const columns = [];
  for (let index = 0; index < width; index += 1) {
    const header = isEmpty(headerRow[index]) ? '' : String(cleanCell(headerRow[index]));
    const hasData = dataRows.some((row) => !isEmpty(row[index]));
    if (!header) {
      if (hasData) {
        warnings.push(warning(WARNING_CODES.UNNAMED_COLUMN, `${label}: column ${index + 1} has values but no header; it was skipped`, file));
      }
      continue;
    }
    const normalized = normalizeHeader(header);
    if (seen.has(normalized)) {
      warnings.push(warning(
        WARNING_CODES.DUPLICATE_HEADER,
        `${label}: "${header}" is the same column as "${seen.get(normalized)}" (${normalized}); the later one was skipped`,
        file,
      ));
      continue;
    }
    seen.set(normalized, header);
    columns.push({ index, header, normalized, isEmptyColumn: !hasData });
  }
  return columns;
}

function columnConverter(column, dataRows) {
  const values = dataRows.map((row) => row[column.index]).filter((value) => !isEmpty(value));
  const isNumeric = !STRING_COLUMN_PATTERN.test(column.normalized)
    && values.every((value) => typeof value === 'number' || isNumericText(value));
  return isNumeric ? (value) => Number(value) : (value) => String(value);
}

function buildTable(file, sheetName, rows, warnings) {
  const label = `${file}#${sheetName}`;
  const headerIndex = rows.findIndex((row) => row.filter(isTextCell).length >= MIN_HEADER_TEXT_CELLS);
  if (headerIndex === -1) {
    warnings.push(warning(WARNING_CODES.NO_HEADER_ROW, `${label}: no header row (a row with at least ${MIN_HEADER_TEXT_CELLS} text cells) was found`, file));
    return null;
  }

  const dataRows = rows.slice(headerIndex + 1)
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((value) => !isEmpty(value)));
  const columns = pickColumns(file, label, rows[headerIndex], dataRows, warnings);
  const converters = columns.map((column) => columnConverter(column, dataRows));

  // Missing values stay missing: an empty cell is omitted from the record, never filled.
  // The one exception: a fully empty column appears as null in the first record only, so the
  // engine still sees it in the header set.
  const records = dataRows
    .map((row) => {
      const record = {};
      columns.forEach((column, position) => {
        const value = row[column.index];
        if (!isEmpty(value)) record[column.header] = converters[position](value);
      });
      return record;
    })
    .filter((record) => Object.keys(record).length > 0);

  if (records.length === 0) {
    warnings.push(warning(WARNING_CODES.EMPTY_TABLE, `${label}: no data rows below the header`, file));
    return null;
  }
  columns.filter((column) => column.isEmptyColumn).forEach((column) => {
    records[0][column.header] = null;
  });
  return { label, headers: columns.map((column) => column.header), records };
}

// Throws when the file cannot be parsed at all; the caller reports that as a warning.
export function extractTables(name, buffer) {
  const workbook = readWorkbook(name, buffer);
  const warnings = [];
  const tables = workbook.SheetNames
    .map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false });
      return buildTable(name, sheetName, rows, warnings);
    })
    .filter(Boolean);
  return { tables, warnings };
}
