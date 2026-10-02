import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createMemoryDb } from '../src/db/memory.js';
import { emptyUsage } from '../src/llm/claude.client.js';
import { engineFallback } from '../src/llm/evidence.check.js';
import { getPromptVersions } from '../src/prompts/index.js';
import { createAnalysisService, dedupeWarnings, evidenceHash } from '../src/services/analysis.service.js';
import { DataEngineError } from '../src/services/dataEngineClient.js';
import { createMemoryFileStorage } from '../src/services/fileStorage.js';

const MODEL = 'claude-haiku-4-5-20251001';
const RULE_VERSION = 'UC4_MATERIAL_V0';
const LIVE_ENV = {
  ANALYSIS_MODE: 'live',
  DATA_ENGINE_URL: 'http://engine.test',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_MODEL: MODEL,
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

const COLOUR_CYCLE = ['GREEN', 'AMBER', 'RED'];

function candidateRow(id, colour) {
  return {
    candidate_id: id,
    colour,
    engine_colour: colour,
    verdict: colour === 'RED' ? 'FAIL' : colour === 'AMBER' ? 'HOLD' : 'PASS',
    reason: `${id} reason`,
    rule_version: RULE_VERSION,
    n_trials: 1,
    evidence: [],
    data_gaps: [],
  };
}

function payloadFor(row) {
  return {
    candidate_id: row.candidate_id,
    colour: row.colour,
    verdict: row.verdict,
    reason: row.reason,
    rule_version: row.rule_version,
    evidence: ['disease 7.7'],
    trials: [],
    atypical: false,
    similar: [],
    data_gaps: [],
    instructions: 'Cite only these values.',
  };
}

function rowsOf(count) {
  return Array.from({ length: count }, (_, index) => {
    const id = `SYN-MZ-${String(index + 1).padStart(5, '0')}`;
    return candidateRow(id, COLOUR_CYCLE[index % COLOUR_CYCLE.length]);
  });
}

function fakeDataEngine(rows, { failGet } = {}) {
  const byId = new Map(rows.map((row) => [row.candidate_id, row]));
  return {
    async getCandidate(id) {
      if (failGet) throw failGet;
      const row = byId.get(id);
      if (!row) throw new DataEngineError(404, { code: 'NOT_FOUND', message: `${id} not found` });
      return row;
    },
    async getLlmContext(id) {
      if (failGet) throw failGet;
      return { payload: payloadFor(byId.get(id)), tokens: { payload: 12, raw_rows: 40 } };
    },
  };
}

function claudeOk(contexts) {
  return {
    results: contexts.map((payload) => ({
      candidate_id: payload.candidate_id,
      justification: `because ${payload.candidate_id}`,
      justification_source: 'claude',
      verified: true,
      confidence: 'high',
    })),
    summary: 'Claude counted 100 green',
    warnings: [],
    rejected: [{ candidate_id: 'must-not-leak' }],
    usage: {
      input_tokens: 10, output_tokens: 4, cache_read_tokens: 1, cache_write_tokens: 2, cost_usd: 0.001,
    },
  };
}

function analysisService({ rows, explainAll, db, ingest }) {
  const calls = [];
  return {
    calls,
    service: createAnalysisService({
      config: { analysisMode: 'live', anthropicModel: MODEL },
      ingest: ingest ?? {
        async ingestFiles() {
          return {
            ingestion: [{
              file: 'lines.csv', kind: 'table', accepted: true, source: 'germplasm', rows: rows.length, message: null,
            }],
            touchedCandidateIds: rows.map((row) => row.candidate_id).sort(),
            warnings: [],
          };
        },
      },
      claude: {
        async explainAll(contexts, text) {
          calls.push({ ids: contexts.map((payload) => payload.candidate_id), text });
          return (explainAll ?? claudeOk)(contexts, text);
        },
      },
      dataEngine: fakeDataEngine(rows),
      db: db ?? createMemoryDb(),
    }),
  };
}

test('evidence hash ignores instructions and tokens and does not depend on key order', () => {
  const row = candidateRow('SYN-MZ-00001', 'RED');
  const payload = payloadFor(row);
  const shuffled = {
    tokens: { payload: 99 },
    instructions: 'different words',
    data_gaps: payload.data_gaps,
    candidate_id: payload.candidate_id,
    reason: payload.reason,
    colour: payload.colour,
    evidence: payload.evidence,
    similar: payload.similar,
    atypical: payload.atypical,
    trials: payload.trials,
    verdict: payload.verdict,
    rule_version: payload.rule_version,
  };
  assert.equal(evidenceHash(payload), evidenceHash(shuffled));
  assert.notEqual(evidenceHash(payload), evidenceHash({ ...payload, reason: 'other' }));
});

test('more than 30 candidates explains RED then AMBER then GREEN and defers the rest', async () => {
  const rows = rowsOf(31);
  const { service, calls } = analysisService({ rows });

  const result = await service.handleMessage({ text: 'why red', files: [{ name: 'lines.csv' }] });
  const explained = calls[0].ids;
  const deferred = result.candidates.find((candidate) => !explained.includes(candidate.candidate_id));
  const warning = result.message.analysis.warnings.find((item) => item.code === 'EXPLANATION_DEFERRED');

  assert.equal(explained.length, 30);
  const colourOf = (id) => rows.find((row) => row.candidate_id === id).colour;
  assert.deepEqual(explained.map(colourOf), [
    ...Array(10).fill('RED'),
    ...Array(10).fill('AMBER'),
    ...Array(10).fill('GREEN'),
  ]);
  const reds = explained.filter((id) => colourOf(id) === 'RED');
  const ambers = explained.filter((id) => colourOf(id) === 'AMBER');
  const greens = explained.filter((id) => colourOf(id) === 'GREEN');
  assert.deepEqual(reds, [...reds].sort());
  assert.deepEqual(ambers, [...ambers].sort());
  assert.deepEqual(greens, [...greens].sort());
  assert.equal(deferred.candidate_id, 'SYN-MZ-00031');
  assert.equal(deferred.justification_source, 'engine');
  assert.equal(deferred.verified, false);
  assert.equal(deferred.confidence, null);
  assert.equal(deferred.justification, engineFallback(payloadFor(deferred)).justification);
  assert.equal(deferred.colour, 'GREEN');
  assert.equal(warning.file, null);
  assert.equal(calls[0].text, 'why red');
});

test('a reused justification does not consume one of the 30 Claude slots', async () => {
  const rows = rowsOf(31);
  const reused = rows.find((row) => row.candidate_id === 'SYN-MZ-00003');
  const db = createMemoryDb();
  const chat = await db.chats.createChat({});
  const message = await db.messages.saveMessage({ chat_id: chat.id, role: 'user', kind: 'text', text: 'earlier upload' });
  await db.candidates.saveCandidates([{
    chat_id: chat.id,
    message_id: message.id,
    ...reused,
    evidence_hash: evidenceHash(payloadFor(reused)),
    justification: 'stored text',
    justification_source: 'claude',
    verified: true,
    confidence: 'high',
  }]);
  const { service, calls } = analysisService({ rows, db });

  const result = await service.handleMessage({ files: [{ name: 'lines.csv' }] });
  const saved = result.candidates.find((candidate) => candidate.candidate_id === 'SYN-MZ-00003');

  assert.equal(calls[0].ids.includes('SYN-MZ-00003'), false);
  assert.equal(calls[0].ids.includes('SYN-MZ-00031'), true);
  assert.equal(calls[0].ids.length, 30);
  assert.equal(saved.justification, 'stored text');
  assert.equal(saved.justification_source, 'claude');
  assert.equal(saved.verified, true);
  assert.equal(result.message.analysis.warnings.some((item) => item.code === 'EXPLANATION_DEFERRED'), false);
});

test('a Claude batch fallback keeps the engine reason and the EXPLANATION_FAILED warning', async () => {
  const rows = [candidateRow('SYN-MZ-00001', 'RED')];
  const { service } = analysisService({
    rows,
    explainAll(contexts) {
      return {
        results: contexts.map((payload) => engineFallback(payload)),
        summary: 'do not copy',
        warnings: [{
          code: 'EXPLANATION_FAILED',
          message: 'Justifications for 1 candidate(s) could not be generated; the engine\'s reason is shown instead.',
          file: null,
        }],
        usage: emptyUsage(),
      };
    },
  });

  const result = await service.handleMessage({ files: [{ name: 'lines.csv' }] });

  assert.equal(result.candidates[0].justification_source, 'engine');
  assert.equal(result.candidates[0].justification, engineFallback(payloadFor(rows[0])).justification);
  assert.equal(result.candidates[0].verified, false);
  assert.ok(result.message.analysis.warnings.some((item) => item.code === 'EXPLANATION_FAILED'));
});

test('usage and versions are saved and the summary counts engine colours', async () => {
  const rows = [candidateRow('SYN-MZ-00002', 'AMBER'), candidateRow('SYN-MZ-00001', 'RED')];
  const { service } = analysisService({ rows });

  const result = await service.handleMessage({ files: [{ name: 'lines.csv' }] });

  assert.equal(result.message.analysis.summary, '2 candidates analysed: 0 green, 1 amber, 1 red.');
  assert.equal(result.message.analysis.summary.includes('Claude counted'), false);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(result.message.usage, {
    input_tokens: 10, output_tokens: 4, cache_read_tokens: 1, cache_write_tokens: 2, cost_usd: 0.001,
  });
  assert.deepEqual(result.message.versions, getPromptVersions({ ruleVersion: RULE_VERSION, model: MODEL }));
  const colours = Object.fromEntries(result.candidates.map((candidate) => [candidate.candidate_id, candidate.colour]));
  assert.deepEqual(colours, { 'SYN-MZ-00001': 'RED', 'SYN-MZ-00002': 'AMBER' });
});

test('a live question with no files asks the chat agent and does not explain files', async () => {
  const service = createAnalysisService({
    config: { analysisMode: 'live', anthropicModel: MODEL, anthropicApiKey: 'test-key' },
    ingest: { async ingestFiles() { throw new Error('files should not be ingested'); } },
    claude: {
      async explainAll() { throw new Error('explainAll is the file path'); },
      async completeChat() {
        return {
          content: [{ type: 'text', text: 'SYN-MZ-00001 is red.' }],
          usage: { input_tokens: 3, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 },
        };
      },
    },
    dataEngine: {
      async getTools() {
        return { tools: [{ name: 'query_candidates', input_schema: { type: 'object', properties: {} } }], system_prompt: 'from-engine' };
      },
    },
    db: createMemoryDb(),
  });

  const result = await service.handleMessage({ text: 'which lines are red?', files: [], history: [] });

  assert.equal(result.message.status, 'ok');
  assert.equal(result.message.kind, 'answer');
  assert.equal(result.message.text, 'SYN-MZ-00001 is red.');
  assert.equal(result.message.versions.chat_prompt, 'engine');
  assert.equal(result.message.versions.explanation_prompt, null);
  assert.deepEqual(result.candidates, []);
});

function httpEngine(rows, { ingestError } = {}) {
  const calls = { ingest: 0, upload: 0, explain: 0 };
  const byId = new Map(rows.map((row) => [row.candidate_id, row]));
  const dataEngine = {
    calls,
    async ingestRecords() {
      calls.ingest += 1;
      if (ingestError) throw ingestError;
      return { accepted: true, detection: { source: 'germplasm' }, rows: 1 };
    },
    async sql(query) {
      // The ingest service checks touched ids against the engine's candidates.
      if (query.includes('FROM materials WHERE candidate_id IN')) {
        const ids = [...query.matchAll(/'([^']+)'/g)].map((match) => match[1]);
        return { columns: ['candidate_id'], rows: ids.filter((id) => byId.has(id)).map((id) => ({ candidate_id: id })) };
      }
      return { columns: ['TRIAL_GUID', 'MATERIAL_GUID'], rows: [] };
    },
    async uploadDocument(filename) {
      calls.upload += 1;
      return { path: filename };
    },
    async getCandidate(id) {
      return byId.get(id);
    },
    async getLlmContext(id) {
      return { payload: payloadFor(byId.get(id)), tokens: { payload: 8 } };
    },
  };
  const claude = {
    async explainAll(contexts) {
      calls.explain += 1;
      return claudeOk(contexts);
    },
  };
  return { dataEngine, claude, calls };
}

let server;
let baseUrl;
let engine;

before(async () => {
  const rows = [candidateRow('SYN-MZ-00001', 'RED')];
  engine = httpEngine(rows);
  const app = createApp({
    config: parseEnv(LIVE_ENV),
    db: createMemoryDb(),
    fileStorage: createMemoryFileStorage(),
    dataEngineClient: engine.dataEngine,
    claude: engine.claude,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
});

async function request(path, { method = 'GET', json, form } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function formWith(files, text) {
  const form = new FormData();
  if (text) form.append('text', text);
  files.forEach(({ name, content, type = 'text/csv' }) => form.append('files', new Blob([content], { type }), name));
  return form;
}

async function createChat() {
  const { body } = await request('/api/chats', { method: 'POST', json: {} });
  return body.chat;
}

test('a live CSV keeps the engine colour and marks the file accepted', async () => {
  const chat = await createChat();
  const { status, body } = await request(`/api/chats/${chat.id}/messages`, {
    method: 'POST',
    form: formWith([{
      name: 'germplasm.csv',
      content: 'MATERIAL_ID,PEDIGREE,GENERATION_CODE\nSYN-MZ-00001,A/B,F4\n',
    }]),
  });
  const assistant = body.assistant_message;

  assert.equal(status, 201);
  assert.equal(assistant.status, 'ok');
  assert.equal(assistant.analysis.ingestion[0].accepted, true);
  assert.equal(assistant.analysis.candidates[0].colour, 'RED');
  assert.equal(assistant.analysis.candidates[0].candidate_id, 'SYN-MZ-00001');
  assert.equal(engine.calls.upload, 0);
});

test('a header-only file is ok with zero candidates and a warning', async () => {
  const chat = await createChat();
  const { status, body } = await request(`/api/chats/${chat.id}/messages`, {
    method: 'POST',
    form: formWith([{ name: 'empty.csv', content: 'MATERIAL_ID,PEDIGREE,GENERATION_CODE\n' }]),
  });

  assert.equal(status, 201);
  assert.equal(body.assistant_message.status, 'ok');
  assert.deepEqual(body.assistant_message.analysis.candidates, []);
  assert.ok(body.assistant_message.analysis.warnings.some((item) => item.code === 'EMPTY_TABLE'));
});

test('a damaged spreadsheet does not drop the valid CSV', async () => {
  const chat = await createChat();
  const corrupt = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 7)]);
  const { status, body } = await request(`/api/chats/${chat.id}/messages`, {
    method: 'POST',
    form: formWith([
      { name: 'broken.xlsx', content: corrupt, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { name: 'germplasm.csv', content: 'MATERIAL_ID,PEDIGREE,GENERATION_CODE\nSYN-MZ-00001,A/B,F4\n' },
    ]),
  });
  const analysis = body.assistant_message.analysis;
  const broken = analysis.ingestion.find((item) => item.file === 'broken.xlsx');
  const warning = analysis.warnings.find((item) => item.file === 'broken.xlsx');

  assert.equal(status, 201);
  assert.equal(body.assistant_message.status, 'ok');
  assert.equal(broken.accepted, false);
  assert.equal(warning.code, 'EXTRACTION_FAILED');
  assert.equal(analysis.candidates[0].candidate_id, 'SYN-MZ-00001');
});

test('an unreachable engine saves an error and does not start explaining', async () => {
  const down = httpEngine([], {
    ingestError: new DataEngineError(502, { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' }),
  });
  const app = createApp({
    config: parseEnv(LIVE_ENV),
    db: createMemoryDb(),
    fileStorage: createMemoryFileStorage(),
    dataEngineClient: down.dataEngine,
    claude: down.claude,
  });
  const downServer = app.listen(0);
  await new Promise((resolve) => downServer.once('listening', resolve));
  const downUrl = `http://localhost:${downServer.address().port}`;
  try {
    const created = await fetch(`${downUrl}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const chat = (await created.json()).chat;
    const form = new FormData();
    form.append('files', new Blob(['MATERIAL_ID,PEDIGREE,GENERATION_CODE\nSYN-MZ-00001,A/B,F4\n'], { type: 'text/csv' }), 'germplasm.csv');
    const res = await fetch(`${downUrl}/api/chats/${chat.id}/messages`, { method: 'POST', body: form });
    const body = await res.json();
    const listed = await fetch(`${downUrl}/api/candidates?chat_id=${chat.id}`);
    const candidates = await listed.json();

    assert.equal(res.status, 201);
    assert.equal(body.assistant_message.status, 'error');
    assert.equal(body.assistant_message.error.code, 'DATA_ENGINE_UNAVAILABLE');
    assert.equal(body.assistant_message.analysis, null);
    assert.equal(down.calls.explain, 0);
    assert.equal(candidates.total, 0);
  } finally {
    downServer.close();
  }
});

test('evidence hash ignores trial_counts, which the engine derives from the hashed trials', () => {
  const payload = { candidate_id: 'SYN-MZ-00001', colour: 'RED', trials: ['SYN-TR-0001 LOC-01 2024: FAIL'] };
  const withCounts = { ...payload, trial_counts: { total: 1, PASS: 0, HOLD: 0, FAIL: 1, ambiguous: 0 } };

  assert.equal(evidenceHash(withCounts), evidenceHash(payload));
});

test('near-duplicate Claude notes from different batches are shown once', () => {
  const note = (message) => ({ code: 'CLAUDE_NOTE', message, file: null });
  const warnings = [
    note('Pedigree data cannot be reconstructed as FEMALE_PARENT_MATERIAL_GUID is empty in every record across all candidates'),
    note('Lab traits are identified only by TRAIT_GUID; names and units require the trait dictionary from the SME'),
    note('20 trials across the dataset have no PLANTING operation recorded'),
    note('Pedigree information cannot be reconstructed: FEMALE_PARENT_MATERIAL_GUID is empty in every record'),
    note('Lab traits are identified only by TRAIT_GUID (7 traits): names and units require the trait dictionary from the SME'),
    note('20 trials have no PLANTING operation recorded'),
    note('12 trials have no PLANTING operation recorded'),
    { code: 'EXPLANATION_DEFERRED', message: '62 candidates were not explained in this response.', file: null },
  ];

  const kept = dedupeWarnings(warnings);

  assert.equal(kept.length, 5);
  assert.deepEqual(kept.map((item) => item.message.slice(0, 12)), [
    'Pedigree dat', 'Lab traits a', '20 trials ac', '12 trials ha', '62 candidate',
  ]);
});
