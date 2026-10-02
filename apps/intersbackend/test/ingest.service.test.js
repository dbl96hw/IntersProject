import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataEngineError } from '../src/services/dataEngineClient.js';
import { createIngestService } from '../src/services/ingest.service.js';
import { xlsxBuffer } from './fixtures.js';

const GUID_A = 'AAAAAAAA-0000-4000-8000-000000000001';
const GUID_B = 'BBBBBBBB-0000-4000-8000-000000000002';
const TRIAL_GUID_1 = 'TTTTTTTT-0000-4000-8000-000000000001';

const MATERIALS = { [GUID_A]: 'SYN-MZ-00001', [GUID_B]: 'SYN-MZ-00002' };
const TRIALS = { 'SYN-TR-0001': TRIAL_GUID_1 };
const TRIAL_MATERIAL = { [TRIAL_GUID_1]: ['SYN-MZ-00003', 'SYN-MZ-00004'] };

const csvFile = (name, text) => ({ name, buffer: Buffer.from(text, 'utf8') });
const idsIn = (query) => [...query.matchAll(/'([^']+)'/g)].map((match) => match[1]);

// Fake engine: records every call and answers SQL from the small tables above by matching the query text.
// `relevance` (optional) is the gate's answer; without it the fake has no checkRelevance, like an older engine.
// `counts` (optional) adds the engine's reconciliation counts to every accepted ingest.
function fakeEngine({
  reject = () => false,
  trialMaterialColumns = ['TRIAL_GUID', 'MATERIAL_GUID', 'n_observations'],
  delayMs = 0,
  log,
  relevance,
  counts,
} = {}) {
  const calls = { ingest: [], sql: [], upload: [], relevance: [] };
  const pause = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const track = async (entry, work) => {
    log?.push(`start ${entry}`);
    await pause();
    log?.push(`end ${entry}`);
    return work();
  };
  const engine = {
    calls,
    async ingestRecords(label, records) {
      calls.ingest.push({ label, records });
      return track(label, () => (reject(label)
        ? { accepted: false, detection: { source: 'UNKNOWN' }, message: 'no known source matches these fields' }
        : { accepted: true, detection: { source: 'germplasm' }, rows: records.length, ...counts }));
    },
    async sql(query) {
      calls.sql.push(query);
      return track('sql', () => {
        if (query.startsWith('SELECT * FROM trial_material')) return { columns: trialMaterialColumns, rows: [] };
        const ids = idsIn(query);
        if (query.includes('FROM materials WHERE candidate_id IN')) {
          const byId = Object.fromEntries(Object.entries(MATERIALS).map(([guid, id]) => [id, guid]));
          return { columns: ['id', 'guid'], rows: ids.filter((id) => byId[id]).map((id) => ({ id, guid: byId[id] })) };
        }
        if (query.includes('FROM materials WHERE MATERIAL_GUID IN')) {
          return { columns: ['candidate_id'], rows: ids.filter((guid) => MATERIALS[guid]).map((guid) => ({ candidate_id: MATERIALS[guid] })) };
        }
        if (query.includes('FROM trials WHERE TRIAL_ID IN')) {
          return { columns: ['id', 'guid'], rows: ids.filter((id) => TRIALS[id]).map((id) => ({ id, guid: TRIALS[id] })) };
        }
        if (query.includes('WHERE tm.TRIAL_GUID IN')) {
          return { columns: ['candidate_id'], rows: ids.flatMap((guid) => TRIAL_MATERIAL[guid] ?? []).map((id) => ({ candidate_id: id })) };
        }
        if (query.includes('WHERE t.TRIAL_ID IN')) {
          return { columns: ['candidate_id'], rows: ids.flatMap((id) => TRIAL_MATERIAL[TRIALS[id]] ?? []).map((id) => ({ candidate_id: id })) };
        }
        throw new Error(`unexpected query: ${query}`);
      });
    },
    async uploadDocument(filename) {
      calls.upload.push(filename);
      return track(`upload ${filename}`, () => ({ path: filename }));
    },
  };
  if (relevance) {
    engine.checkRelevance = async ({ filename }) => {
      calls.relevance.push(filename);
      if (relevance instanceof Error) throw relevance;
      return relevance;
    };
  }
  return engine;
}

test('a corrupt spreadsheet gives only a warning', async () => {
  const engine = fakeEngine();
  const corrupt = { name: 'broken.xlsx', buffer: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 7)]) };

  const result = await createIngestService({ dataEngine: engine }).ingestFiles([corrupt]);

  assert.deepEqual(result.ingestion, []);
  assert.deepEqual(result.warnings.map((item) => item.code), ['EXTRACTION_FAILED']);
  assert.equal(result.warnings[0].file, 'broken.xlsx');
  assert.equal(engine.calls.ingest.length, 0);
});

test('an XLSX with two sheets makes two ingestRecords calls', async () => {
  const engine = fakeEngine();
  const buffer = xlsxBuffer({
    Germplasm: [['MATERIAL_GUID', 'MATERIAL_ID', 'PEDIGREE'], [GUID_A, 'SYN-MZ-00001', 'A/B']],
    Genomics: [['GENOMIC_SAMPLE_GUID', 'MATERIAL_GUID', 'QC_CALL_RATE_PCT'], ['GS-1', GUID_B, 97.1]],
  });

  const result = await createIngestService({ dataEngine: engine }).ingestFiles([{ name: 'trials.xlsx', buffer }]);

  assert.deepEqual(engine.calls.ingest.map((call) => call.label), ['trials.xlsx#Germplasm', 'trials.xlsx#Genomics']);
  assert.deepEqual(result.ingestion.map((item) => [item.kind, item.accepted, item.rows]), [['table', true, 1], ['table', true, 1]]);
});

test('a table rejected by the engine gives accepted false with the engine message', async () => {
  const engine = fakeEngine({ reject: () => true });

  const result = await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('mystery.csv', 'FOO,BAR,BAZ\n1,2,3\n')]);

  assert.deepEqual(result.ingestion, [{
    file: 'mystery.csv',
    kind: 'table',
    accepted: false,
    source: 'UNKNOWN',
    rows: null,
    rows_added: null,
    duplicates_ignored: null,
    conflicts: null,
    message: 'no known source matches these fields',
  }]);
  assert.deepEqual(result.touchedCandidateIds, []);
});

test('an engine validation error on one table is reported, an unreachable engine fails the call', async () => {
  const validation = fakeEngine();
  validation.ingestRecords = async () => { throw new DataEngineError(400, { code: 'VALIDATION_ERROR', message: 'records: bad shape' }); };
  const down = fakeEngine();
  down.ingestRecords = async () => { throw new DataEngineError(502, { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' }); };
  const file = csvFile('germplasm.csv', `MATERIAL_GUID,MATERIAL_ID,PEDIGREE\n${GUID_A},SYN-MZ-00001,A/B\n`);

  const result = await createIngestService({ dataEngine: validation }).ingestFiles([file]);

  assert.equal(result.ingestion[0].accepted, false);
  assert.equal(result.ingestion[0].message, 'records: bad shape');
  await assert.rejects(createIngestService({ dataEngine: down }).ingestFiles([file]), { status: 502 });
});

test('5001 records are sent in two calls of at most 5000', async () => {
  const engine = fakeEngine();
  const rows = Array.from({ length: 5001 }, (_, index) => `GS-${index},${GUID_A},97.1`).join('\n');

  const result = await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('genomics.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\n${rows}\n`)]);

  assert.deepEqual(engine.calls.ingest.map((call) => call.records.length), [5000, 1]);
  assert.equal(result.ingestion.length, 1);
  assert.equal(result.ingestion[0].rows, 5001);
});

test('every chunk shows every column, so the engine detects the same source each call', async () => {
  const engine = fakeEngine();
  const rows = Array.from({ length: 5001 }, (_, index) => `GS-${index},${GUID_A},${index < 5000 ? '97.1' : ''},`).join('\n');

  await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('genomics.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT,MARKER_MATURITY\n${rows}\n`)]);
  const [firstCall, secondCall] = engine.calls.ingest;
  const columnsOf = (call) => new Set(call.records.flatMap((record) => Object.keys(record)));

  assert.deepEqual([...columnsOf(secondCall)].sort(), [...columnsOf(firstCall)].sort());
  assert.equal(firstCall.records[0].MARKER_MATURITY, null);
  assert.equal(secondCall.records[0].QC_CALL_RATE_PCT, null);
  assert.equal(secondCall.records[0].MARKER_MATURITY, null);
  assert.equal(secondCall.records[0].GENOMIC_SAMPLE_GUID, 'GS-5000');
});

test('touchedCandidateIds covers material ids, material GUIDs, trial GUIDs and trial ids from accepted tables', async () => {
  const engine = fakeEngine({ reject: (label) => label.startsWith('rejected.csv') });
  const files = [
    csvFile('germplasm.csv', 'MATERIAL_ID,PEDIGREE,GENERATION_CODE\nSYN-MZ-00005,A/B,F4\n'),
    csvFile('genomics.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\nGS-1,${GUID_A},97.1\nGS-2,${GUID_B},96\n`),
    csvFile('trial_recommendations_synthetic.csv', `TRIAL_GUID,YIELD_T_HA,DISEASE_SCORE\n${TRIAL_GUID_1},10.2,7.7\n`),
    csvFile('trial_synthetic.csv', 'TRIAL_ID,TRIAL_DESCRIPTION,START_YEAR\nSYN-TR-0001,Maize North,2024\n'),
    csvFile('rejected.csv', 'MATERIAL_ID,FOO,BAR\nSYN-MZ-09999,1,2\n'),
  ];

  const result = await createIngestService({ dataEngine: engine }).ingestFiles(files);
  const probeIndex = engine.calls.sql.findIndex((query) => query === 'SELECT * FROM trial_material LIMIT 1');
  const joinIndex = engine.calls.sql.findIndex((query) => query.includes('JOIN trial_material'));

  assert.deepEqual(result.touchedCandidateIds, ['SYN-MZ-00001', 'SYN-MZ-00002', 'SYN-MZ-00003', 'SYN-MZ-00004', 'SYN-MZ-00005']);
  assert.ok(probeIndex !== -1 && probeIndex < joinIndex);
  assert.equal(result.ingestion.find((item) => item.file === 'rejected.csv').accepted, false);
});

test('without the trial_material link columns no join runs and a warning explains why', async () => {
  const engine = fakeEngine({ trialMaterialColumns: ['TRIAL_GUID', 'n_observations'] });

  const result = await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('trial_synthetic.csv', 'TRIAL_ID,TRIAL_DESCRIPTION,START_YEAR\nSYN-TR-0001,Maize North,2024\n')]);

  assert.deepEqual(result.touchedCandidateIds, []);
  assert.deepEqual(result.warnings.map((item) => item.code), ['TRIAL_LINK_UNAVAILABLE']);
  assert.ok(engine.calls.sql.every((query) => !query.includes('JOIN')));
});

test('document records get their GUIDs from the engine and unresolved records are omitted', async () => {
  const engine = fakeEngine();
  const claudeExtract = async () => [{
    source: 'genomics',
    records: [
      { MATERIAL_ID: 'SYN-MZ-00001', GENOMIC_BREEDING_VALUE: 104.2 },
      { MATERIAL_ID: 'SYN-MZ-07777', GENOMIC_BREEDING_VALUE: 99.1 },
      { MATERIAL_ID: "x'; DROP", GENOMIC_BREEDING_VALUE: 98 },
    ],
  }];
  const pdf = { name: 'lab-report.pdf', buffer: Buffer.from('%PDF-1.4 fake') };

  const result = await createIngestService({ dataEngine: engine, claudeExtract }).ingestFiles([pdf]);
  const unresolved = result.warnings.find((item) => item.code === 'UNRESOLVED_IDS');

  assert.equal(engine.calls.ingest.length, 1);
  assert.equal(engine.calls.ingest[0].label, 'lab-report.pdf#genomics');
  assert.deepEqual(engine.calls.ingest[0].records, [{ MATERIAL_ID: 'SYN-MZ-00001', GENOMIC_BREEDING_VALUE: 104.2, MATERIAL_GUID: GUID_A }]);
  assert.ok(engine.calls.sql.every((query) => !query.includes('DROP')));
  assert.match(unresolved.message, /2 record\(s\) from "lab-report.pdf" were omitted/);
  assert.match(unresolved.message, /SYN-MZ-07777/);
  assert.deepEqual(engine.calls.upload, ['lab-report.pdf']);
  assert.equal(result.ingestion[0].kind, 'document');
  assert.deepEqual(result.touchedCandidateIds, ['SYN-MZ-00001']);
});

test('when Claude finds no records a warning is added and nothing is sent as records', async () => {
  const engine = fakeEngine();

  const result = await createIngestService({ dataEngine: engine, claudeExtract: async () => [] })
    .ingestFiles([{ name: 'photo.png', buffer: Buffer.from('fake png') }]);

  assert.deepEqual(result.warnings.map((item) => item.code), ['NO_RECORDS_EXTRACTED']);
  assert.equal(engine.calls.ingest.length, 0);
  assert.deepEqual(engine.calls.upload, ['photo.png']);
});

test('two concurrent ingestFiles calls never interleave their engine calls', async () => {
  const log = [];
  const service = createIngestService({ dataEngine: fakeEngine({ delayMs: 5, log }) });
  const first = csvFile('first.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\nGS-1,${GUID_A},97.1\n`);
  const second = csvFile('second.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\nGS-2,${GUID_B},96\n`);

  const [firstResult, secondResult] = await Promise.all([service.ingestFiles([first]), service.ingestFiles([second])]);

  let inFlight = 0;
  for (const entry of log) {
    inFlight += entry.startsWith('start') ? 1 : -1;
    assert.ok(inFlight <= 1, 'two engine calls overlapped');
  }
  // The first call ends with its candidate-id SQL; the second call may only start after that.
  assert.ok(log.indexOf('start second.csv#Sheet1') > log.indexOf('end sql'));
  assert.deepEqual(firstResult.touchedCandidateIds, ['SYN-MZ-00001']);
  assert.deepEqual(secondResult.touchedCandidateIds, ['SYN-MZ-00002']);
});

test('an off-topic document stops at the relevance gate: no Claude call, no upload', async () => {
  const engine = fakeEngine({
    relevance: { decision: 'IRRELEVANT', reasons: ['breeding vocabulary: 0 distinct term(s) (none)'] },
  });
  let claudeCalls = 0;
  const claudeExtract = async () => { claudeCalls += 1; return []; };

  const result = await createIngestService({ dataEngine: engine, claudeExtract })
    .ingestFiles([{ name: 'invoice.pdf', buffer: Buffer.from('%PDF-1.4 fake') }]);

  assert.equal(claudeCalls, 0);
  assert.deepEqual(engine.calls.upload, []);
  assert.deepEqual(engine.calls.relevance, ['invoice.pdf']);
  assert.equal(result.ingestion[0].accepted, false);
  assert.match(result.ingestion[0].message, /Not about breeding or trial data/);
  assert.deepEqual(result.warnings.map((item) => item.code), ['IRRELEVANT_FILE']);
});

test('an uncertain document is processed with a warning so a person can check it', async () => {
  const engine = fakeEngine({ relevance: { decision: 'UNCERTAIN', reasons: [] } });

  const result = await createIngestService({ dataEngine: engine, claudeExtract: async () => [] })
    .ingestFiles([{ name: 'field-photo.png', buffer: Buffer.from('fake png') }]);

  assert.deepEqual(engine.calls.upload, ['field-photo.png']);
  assert.deepEqual(result.warnings.map((item) => item.code), ['RELEVANCE_UNCERTAIN', 'NO_RECORDS_EXTRACTED']);
});

test('a relevance check that fails (not an outage) lets the document through as before', async () => {
  const engine = fakeEngine({ relevance: new DataEngineError(404, { code: 'NOT_FOUND', message: 'Not Found' }) });

  const result = await createIngestService({ dataEngine: engine, claudeExtract: async () => [] })
    .ingestFiles([{ name: 'photo.png', buffer: Buffer.from('fake png') }]);

  assert.deepEqual(engine.calls.upload, ['photo.png']);
  assert.deepEqual(result.warnings.map((item) => item.code), ['NO_RECORDS_EXTRACTED']);
});

test('tables do not go through the relevance gate (the engine rejects unknown layouts itself)', async () => {
  const engine = fakeEngine({ relevance: { decision: 'IRRELEVANT', reasons: [] } });

  await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('genomics.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\nGS-1,${GUID_A},97.1\n`)]);

  assert.deepEqual(engine.calls.relevance, []);
  assert.equal(engine.calls.ingest.length, 1);
});

test('re-uploaded and contradicting rows are counted, and conflicts become a warning', async () => {
  const engine = fakeEngine({
    counts: {
      rows_added: 0,
      duplicates_ignored: 1,
      conflicts: 1,
      message: '1 row(s) contradict the export and were not applied (the export wins; see GET /quality)',
    },
  });
  const rows = `GS-1,${GUID_A},97.1\nGS-2,${GUID_B},96\n`;

  const result = await createIngestService({ dataEngine: engine })
    .ingestFiles([csvFile('genomics.csv', `GENOMIC_SAMPLE_GUID,MATERIAL_GUID,QC_CALL_RATE_PCT\n${rows}`)]);
  const [item] = result.ingestion;

  assert.deepEqual([item.rows, item.rows_added, item.duplicates_ignored, item.conflicts], [2, 0, 1, 1]);
  assert.match(item.message, /the export wins/);
  assert.deepEqual(result.warnings.map((entry) => entry.code), ['UPLOAD_CONFLICTS']);
  // The file still covers these candidates, even though nothing new was added.
  assert.deepEqual(result.touchedCandidateIds, ['SYN-MZ-00001', 'SYN-MZ-00002']);
});
