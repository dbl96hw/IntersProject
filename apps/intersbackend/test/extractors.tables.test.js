import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectDelimiter, extractTables, normalizeHeader } from '../src/extractors/tables.js';
import { xlsxBuffer } from './fixtures.js';

const GUID = '1FC9E916-0A2B-4C3D-8E9F-001122334455';
const csv = (text) => Buffer.from(text, 'utf8');

test('the header row is found below title rows and numeric columns become numbers', () => {
  const text = [
    'Maize trials 2024',
    'Exported 2026-09-30,,',
    'MATERIAL_ID,DISEASE_SCORE,YIELD_T_HA,PLOT_NO',
    'SYN-MZ-00001,7.7,10.2,007',
    'SYN-MZ-00002,3,9.8,012',
  ].join('\n');

  const { tables, warnings } = extractTables('trials.csv', csv(text));

  assert.deepEqual(warnings, []);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].label, 'trials.csv#Sheet1');
  assert.deepEqual(tables[0].headers, ['MATERIAL_ID', 'DISEASE_SCORE', 'YIELD_T_HA', 'PLOT_NO']);
  assert.deepEqual(tables[0].records[0], { MATERIAL_ID: 'SYN-MZ-00001', DISEASE_SCORE: 7.7, YIELD_T_HA: 10.2, PLOT_NO: '007' });
  assert.equal(tables[0].records[1].DISEASE_SCORE, 3);
});

test('a CSV with accents and quoted commas keeps its values, and ids stay strings', () => {
  const text = '\uFEFFMATERIAL_GUID,MATERIAL_ID,Responsable,Ubicación\n'
    + `${GUID},SYN-MZ-00001,"Smith, J",Ñandú\n`
    + `${GUID.replace('1FC9', '2FC9')},SYN-MZ-00002,"Pérez, Ana",Análisis\n`;

  const { tables } = extractTables('análisis.csv', csv(text));
  const [first, second] = tables[0].records;

  assert.deepEqual(tables[0].headers, ['MATERIAL_GUID', 'MATERIAL_ID', 'Responsable', 'Ubicación']);
  assert.equal(first.Responsable, 'Smith, J');
  assert.equal(first['Ubicación'], 'Ñandú');
  assert.equal(second['Ubicación'], 'Análisis');
  assert.equal(first.MATERIAL_GUID, GUID);
  assert.equal(typeof first.MATERIAL_ID, 'string');
});

test('id columns stay strings even when every value is numeric', () => {
  const text = 'GID,TRIAL_ID,SCORE\n12345,2024,1\n67890,2025,2\n';

  const { tables } = extractTables('ids.csv', csv(text));

  assert.deepEqual(tables[0].records[0], { GID: '12345', TRIAL_ID: '2024', SCORE: 1 });
});

test('a semicolon CSV is split on semicolons, quoted semicolons included', () => {
  const text = 'MATERIAL_ID;Comentario;DISEASE_SCORE\nSYN-MZ-00001;"bueno; vigoroso";4,5\nSYN-MZ-00002;"sin datos";5\n';

  const { tables } = extractTables('lab.csv', csv(text));

  assert.deepEqual(tables[0].headers, ['MATERIAL_ID', 'Comentario', 'DISEASE_SCORE']);
  assert.equal(tables[0].records[0].Comentario, 'bueno; vigoroso');
  assert.equal(tables[0].records[0].DISEASE_SCORE, '4,5');
});

test('detectDelimiter picks the most frequent delimiter outside quotes', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('\n\na;b;c'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a|b|c'), '|');
  assert.equal(detectDelimiter('"x,y,z";b;c'), ';');
  assert.equal(detectDelimiter('single'), ',');
});

test('duplicate headers are detected after the engine normalisation', () => {
  const text = 'Material ID,MATERIAL-ID,material_id,DISEASE_SCORE,Notes\nSYN-MZ-00001,SYN-MZ-00009,x,7.7,ok\n';

  const { tables, warnings } = extractTables('dupes.csv', csv(text));

  assert.equal(normalizeHeader(' Material-ID '), 'MATERIAL_ID');
  assert.deepEqual(tables[0].headers, ['Material ID', 'DISEASE_SCORE', 'Notes']);
  assert.equal(tables[0].records[0]['Material ID'], 'SYN-MZ-00001');
  assert.equal(warnings.filter((item) => item.code === 'DUPLICATE_HEADER').length, 2);
  assert.match(warnings[0].message, /"MATERIAL-ID" is the same column as "Material ID"/);
});

test('a fully empty column with a header is kept as null in the first record only', () => {
  const text = 'MATERIAL_ID,EMPTY_COLUMN,DISEASE_SCORE,Notes,\nSYN-MZ-00001,,7.7,,\n,,,,\nSYN-MZ-00002,,,ok,\n';

  const { tables, warnings } = extractTables('gaps.csv', csv(text));

  assert.deepEqual(warnings, []);
  assert.deepEqual(tables[0].headers, ['MATERIAL_ID', 'EMPTY_COLUMN', 'DISEASE_SCORE', 'Notes']);
  assert.deepEqual(tables[0].records, [
    { MATERIAL_ID: 'SYN-MZ-00001', DISEASE_SCORE: 7.7, EMPTY_COLUMN: null },
    { MATERIAL_ID: 'SYN-MZ-00002', Notes: 'ok' },
  ]);
});

test('a column with values but no header is skipped with a warning', () => {
  const text = 'MATERIAL_ID,,DISEASE_SCORE,Notes\nSYN-MZ-00001,stray,7.7,ok\n';

  const { tables, warnings } = extractTables('stray.csv', csv(text));

  assert.deepEqual(tables[0].headers, ['MATERIAL_ID', 'DISEASE_SCORE', 'Notes']);
  assert.deepEqual(warnings.map((item) => item.code), ['UNNAMED_COLUMN']);
});

const SYNTHETIC_DIR = new URL('../../../data/synthetic/uc4/', import.meta.url);
const SYNTHETIC_FILES = [
  'genomics_synthetic.csv',
  'germplasm_pedigree_synthetic.csv',
  'lab_observations_synthetic.csv',
  'observation_synthetic.csv',
  'operations_synthetic.csv',
  'trial_recommendations_synthetic.csv',
  'trial_synthetic.csv',
];

// The synthetic exports have their header in row 1 and no quoted header cells.
function csvHeaders(text) {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  return firstLine.split(detectDelimiter(text)).map((header) => header.trim()).filter(Boolean);
}

for (const name of SYNTHETIC_FILES) {
  test(`every header of ${name} reaches the records, including fully empty columns`, () => {
    const buffer = readFileSync(new URL(name, SYNTHETIC_DIR));

    const { tables, warnings } = extractTables(name, buffer);
    const keys = new Set(tables[0].records.flatMap((record) => Object.keys(record)));

    assert.deepEqual(warnings, []);
    assert.equal(tables.length, 1);
    assert.deepEqual([...keys].sort(), csvHeaders(buffer.toString('utf8')).sort());
    assert.deepEqual([...tables[0].headers].sort(), [...keys].sort());
  });
}

test('the three files that were rejected keep their fully empty signature columns', () => {
  const emptyColumnsOf = (name) => {
    const { tables } = extractTables(name, readFileSync(new URL(name, SYNTHETIC_DIR)));
    const [first, ...rest] = tables[0].records;
    return Object.keys(first).filter((key) => first[key] === null && rest.every((record) => !(key in record)));
  };

  for (const name of ['lab_observations_synthetic.csv', 'germplasm_pedigree_synthetic.csv', 'trial_synthetic.csv']) {
    assert.ok(emptyColumnsOf(name).length > 0, `${name} should have fully empty columns sent as null`);
  }
});

test('an XLSX with two sheets yields one table per sheet', () => {
  const buffer = xlsxBuffer({
    Germplasm: [['MATERIAL_GUID', 'MATERIAL_ID', 'PEDIGREE'], [GUID, 'SYN-MZ-00001', 'A/B']],
    Genomics: [['Genomics export'], ['GENOMIC_SAMPLE_GUID', 'MATERIAL_GUID', 'QC_CALL_RATE_PCT'], ['GS-1', GUID, 97.1]],
  });

  const { tables } = extractTables('trials.xlsx', buffer);

  assert.deepEqual(tables.map((table) => table.label), ['trials.xlsx#Germplasm', 'trials.xlsx#Genomics']);
  assert.equal(tables[1].records[0].QC_CALL_RATE_PCT, 97.1);
});
