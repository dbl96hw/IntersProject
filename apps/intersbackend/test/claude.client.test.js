import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUsage, createClaudeClient, describeApiError, emptyUsage, usageFrom } from '../src/llm/claude.client.js';

const MODEL = 'claude-sonnet-5-5';
const API_USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 };
// 1000 * 2 + 200 * 10 + 100 * 2.5 + 500 * 0.2 = 4350 per million tokens.
const CALL_USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_tokens: 500, cache_write_tokens: 100, cost_usd: 0.00435 };
const silentLogger = { log() {}, error() {} };

const VALID_JUSTIFICATIONS = {
  items: [{ candidate_id: 'SYN-MZ-00001', justification: 'Fails in 3 of 5 trials.', cited_values: [], confidence: 'high' }],
  summary: 'One candidate.',
  warnings: [],
};

const toolResponse = (input, { name = 'submit_justifications', stopReason = 'tool_use', usage = API_USAGE } = {}) => ({
  content: [{ type: 'tool_use', id: 'toolu_1', name, input }],
  stop_reason: stopReason,
  usage,
});

const apiError = (status) => Object.assign(new Error(`status ${status}`), { status });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fake Anthropic SDK: `respond` returns a response or throws, per call. Records requests and concurrency.
function fakeAnthropic(respond) {
  const fake = { requests: [], maxActive: 0 };
  let active = 0;
  fake.messages = {
    async create(body) {
      const index = fake.requests.length;
      fake.requests.push(structuredClone(body));
      active += 1;
      fake.maxActive = Math.max(fake.maxActive, active);
      try {
        return await respond(body, index);
      } finally {
        active -= 1;
      }
    },
  };
  return fake;
}

function scripted(steps) {
  return fakeAnthropic((body, index) => {
    const step = steps[index];
    if (step instanceof Error) throw step;
    return step;
  });
}

const clientFor = (anthropic, options = {}) => createClaudeClient({
  anthropic, model: MODEL, retryDelayMs: 0, logger: silentLogger, ...options,
});

const callJustifications = (client) => client.callTool({
  prompt: 'SYSTEM PROMPT',
  toolName: 'submit_justifications',
  content: [{ type: 'text', text: 'hello' }],
});

const payloadFor = (id) => ({
  candidate_id: id,
  colour: 'RED',
  engine_colour: 'RED',
  verdict: 'FAIL',
  reason: 'fails in 3 of 5 trials',
  rule_version: 'UC4_MATERIAL_V0',
  evidence: ['disease risk elevated (DISEASE_SCORE = 7.7 score (1-9), threshold <= 5)', 'yield below target (YIELD_T_HA = 9.0 t/ha)'],
  trials: ['SYN-TR-0001 LOC-01 2024: FAIL'],
  atypical: false,
  similar: [],
  data_gaps: [],
});

const idsInRequest = (body) => [...body.messages[0].content[0].text.matchAll(/"candidate_id":"([^"]+)"/g)].map((match) => match[1]);

const justificationsFor = (ids, justification = 'Fails in 3 of 5 trials.') => ({
  items: ids.map((id) => ({ candidate_id: id, justification, cited_values: [], confidence: 'medium' })),
  summary: `${ids.length} candidates.`,
  warnings: [],
});

test('a valid call sends a cached system prompt and a forced tool, and returns the parsed input with usage', async () => {
  const anthropic = scripted([toolResponse(VALID_JUSTIFICATIONS)]);
  const { input, usage } = await callJustifications(clientFor(anthropic));

  const [request] = anthropic.requests;
  assert.equal(anthropic.requests.length, 1);
  assert.equal(request.model, MODEL);
  assert.equal(request.max_tokens, 8192);
  assert.deepEqual(request.system, [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(request.tool_choice, { type: 'tool', name: 'submit_justifications' });
  assert.equal(request.tools[0].name, 'submit_justifications');
  assert.deepEqual(input, VALID_JUSTIFICATIONS);
  assert.deepEqual(usage, CALL_USAGE);
});

test('invalid output is sent back as an error tool_result once, and the corrected output is used', async () => {
  const anthropic = scripted([toolResponse({ items: [{ candidate_id: 'SYN-MZ-00001' }] }), toolResponse(VALID_JUSTIFICATIONS)]);
  const { input, usage } = await callJustifications(clientFor(anthropic));

  assert.equal(anthropic.requests.length, 2);
  const [, assistantTurn, correction] = anthropic.requests[1].messages;
  assert.equal(assistantTurn.role, 'assistant');
  assert.equal(correction.role, 'user');
  assert.equal(correction.content[0].type, 'tool_result');
  assert.equal(correction.content[0].tool_use_id, 'toolu_1');
  assert.equal(correction.content[0].is_error, true);
  assert.match(correction.content[0].content, /items\.0\.justification/);
  assert.deepEqual(input, VALID_JUSTIFICATIONS);
  assert.deepEqual(usage, addUsage(CALL_USAGE, CALL_USAGE));
});

test('invalid output twice throws CLAUDE_OUTPUT_INVALID and keeps the usage', async () => {
  const anthropic = scripted([toolResponse({ items: 'nope' }), toolResponse({ items: 'still nope' })]);
  await assert.rejects(callJustifications(clientFor(anthropic)), (err) => {
    assert.equal(err.code, 'CLAUDE_OUTPUT_INVALID');
    assert.deepEqual(err.usage, addUsage(CALL_USAGE, CALL_USAGE));
    return true;
  });
  assert.equal(anthropic.requests.length, 2);
});

test('stop_reason max_tokens goes to the corrective retry', async () => {
  const anthropic = scripted([toolResponse(VALID_JUSTIFICATIONS, { stopReason: 'max_tokens' }), toolResponse(VALID_JUSTIFICATIONS)]);
  const { input } = await callJustifications(clientFor(anthropic));

  assert.equal(anthropic.requests.length, 2);
  const correction = anthropic.requests[1].messages[2].content[0];
  assert.equal(correction.is_error, true);
  assert.match(correction.content, /max_tokens/);
  assert.deepEqual(input, VALID_JUSTIFICATIONS);
});

test('max_tokens twice throws CLAUDE_OUTPUT_INVALID; without a tool_use the correction is plain text', async () => {
  const truncated = { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens', usage: API_USAGE };
  const anthropic = scripted([truncated, truncated]);
  await assert.rejects(callJustifications(clientFor(anthropic)), { code: 'CLAUDE_OUTPUT_INVALID' });
  assert.equal(anthropic.requests[1].messages[2].content[0].type, 'text');
});

test('a 529 is retried once after a wait, then succeeds', async () => {
  const anthropic = scripted([apiError(529), toolResponse(VALID_JUSTIFICATIONS)]);
  const { input } = await callJustifications(clientFor(anthropic));
  assert.equal(anthropic.requests.length, 2);
  assert.deepEqual(input, VALID_JUSTIFICATIONS);
});

test('429 and 5xx are retried only once', async () => {
  const anthropic = scripted([apiError(429), apiError(503)]);
  await assert.rejects(callJustifications(clientFor(anthropic)), { code: 'LLM_UNAVAILABLE', upstreamStatus: 503 });
  assert.equal(anthropic.requests.length, 2);
});

test('400 and 401 are never retried', async () => {
  for (const status of [400, 401]) {
    const anthropic = scripted([apiError(status), toolResponse(VALID_JUSTIFICATIONS)]);
    await assert.rejects(callJustifications(clientFor(anthropic)), { code: 'LLM_UNAVAILABLE', upstreamStatus: status });
    assert.equal(anthropic.requests.length, 1);
  }
});

test('a 400 logs and keeps the API error type and message, never the key or the request', async () => {
  const apiMessage = 'max_tokens: 8192 > 4096, which is the maximum allowed for this model';
  const error = Object.assign(new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"${apiMessage}"}}`), {
    status: 400,
    headers: { 'x-api-key': 'sk-ant-secret' },
    error: { type: 'error', error: { type: 'invalid_request_error', message: apiMessage } },
  });
  const lines = [];
  const logger = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const client = clientFor(scripted([error]), { logger, apiKey: 'sk-ant-secret' });

  await assert.rejects(callJustifications(client), (err) => {
    assert.equal(err.code, 'LLM_UNAVAILABLE');
    assert.equal(err.upstreamStatus, 400);
    assert.ok(err.message.includes(`invalid_request_error: ${apiMessage}`));
    return true;
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /status=400/);
  assert.ok(lines[0].includes(`error=invalid_request_error: ${apiMessage}`));
  assert.equal(lines.some((line) => line.includes('sk-ant-secret') || line.includes('SYSTEM PROMPT') || line.includes('hello')), false);
});

test('API error details are truncated to about 300 characters and redact the key', () => {
  const long = describeApiError({ status: 500, error: { type: 'error', error: { type: 'api_error', message: 'x'.repeat(1000) } } });
  assert.ok(long.length <= 303);
  assert.ok(long.startsWith('api_error: xxx'));
  assert.equal(describeApiError(new Error('bad key sk-ant-secret'), 'sk-ant-secret'), 'Error: bad key [redacted]');
});

test('an unknown model gets cost_usd null, and null stays null when usage is added up', () => {
  const unknown = usageFrom(API_USAGE, 'claude-unknown-1');
  assert.equal(unknown.cost_usd, null);
  assert.equal(unknown.input_tokens, 1000);
  assert.equal(addUsage(emptyUsage(), unknown).cost_usd, null);
});

test('explainBatch sends each payload unchanged in <candidate_context> and checks every justification', async () => {
  const payloads = ['SYN-MZ-00001', 'SYN-MZ-00002', 'SYN-MZ-00003', 'SYN-MZ-00004'].map(payloadFor);
  const anthropic = scripted([toolResponse({
    items: [
      { candidate_id: 'SYN-MZ-00001', justification: 'Fails in 3 of 5 trials; DISEASE_SCORE = 7,7.', cited_values: [], confidence: 'high' },
      { candidate_id: 'SYN-MZ-00002', justification: 'Yield of 11.2 t/ha is too low.', cited_values: [], confidence: 'high' },
      { candidate_id: 'SYN-MZ-00003', justification: 'This line is GREEN overall.', cited_values: [], confidence: 'low' },
    ],
    summary: 'Batch.',
    warnings: ['one table was blurry'],
  })]);
  const { results, warnings, rejected } = await clientFor(anthropic).explainBatch(payloads, 'Explica en español');

  const text = anthropic.requests[0].messages[0].content[0].text;
  assert.ok(text.includes(`<candidate_context>${JSON.stringify(payloads[0])}</candidate_context>`));
  assert.ok(anthropic.requests[0].messages[0].content[1].text.includes('Explica en español'));
  assert.deepEqual(results.map((result) => [result.candidate_id, result.justification_source, result.verified]), [
    ['SYN-MZ-00001', 'claude', true],
    ['SYN-MZ-00002', 'engine', false],
    ['SYN-MZ-00003', 'engine', false],
    ['SYN-MZ-00004', 'engine', false],
  ]);
  assert.match(results[1].justification, /^fails in 3 of 5 trials\. disease risk elevated/);
  assert.deepEqual(warnings.map((item) => item.code), ['CLAUDE_NOTE', 'JUSTIFICATION_UNVERIFIED', 'JUSTIFICATION_UNVERIFIED', 'EXPLANATION_FAILED']);
  assert.deepEqual(rejected.map((item) => [item.candidate_id, item.type, item.token, item.justification]), [
    ['SYN-MZ-00002', 'number', '11.2', 'Yield of 11.2 t/ha is too low.'],
    ['SYN-MZ-00003', 'colour', 'GREEN', 'This line is GREEN overall.'],
  ]);
  assert.equal(results.some((result) => 'rejection' in result || 'token' in result), false);
});

test('explainAll runs batches of 15 with at most MAX_PARALLEL_BATCHES at once and adds up usage', async () => {
  const payloads = Array.from({ length: 31 }, (_, index) => payloadFor(`SYN-MZ-${String(index + 1).padStart(5, '0')}`));
  const anthropic = fakeAnthropic(async (body) => {
    await wait(10);
    return toolResponse(justificationsFor(idsInRequest(body)));
  });
  const { results, warnings, usage } = await clientFor(anthropic, { batchSize: 15, maxParallelBatches: 2 }).explainAll(payloads);

  assert.deepEqual(anthropic.requests.map((body) => idsInRequest(body).length), [15, 15, 1]);
  assert.equal(anthropic.maxActive, 2);
  assert.deepEqual(results.map((result) => result.candidate_id), payloads.map((payload) => payload.candidate_id));
  assert.ok(results.every((result) => result.justification_source === 'claude' && result.verified));
  assert.deepEqual(warnings, []);
  assert.deepEqual(usage, addUsage(addUsage(CALL_USAGE, CALL_USAGE), CALL_USAGE));
});

test('one of three failing batches falls back to the engine reason with a warning', async () => {
  const payloads = Array.from({ length: 45 }, (_, index) => payloadFor(`SYN-MZ-${String(index + 1).padStart(5, '0')}`));
  const anthropic = fakeAnthropic(async (body) => {
    const ids = idsInRequest(body);
    await wait(10);
    if (ids.includes('SYN-MZ-00016')) throw apiError(400);
    return toolResponse(justificationsFor(ids));
  });
  const { results, warnings, usage } = await clientFor(anthropic, { batchSize: 15, maxParallelBatches: 3 }).explainAll(payloads);

  assert.equal(anthropic.maxActive, 3);
  assert.equal(results.length, 45);
  const sources = results.map((result) => result.justification_source);
  assert.deepEqual(sources.slice(0, 15), Array(15).fill('claude'));
  assert.deepEqual(sources.slice(15, 30), Array(15).fill('engine'));
  assert.deepEqual(sources.slice(30), Array(15).fill('claude'));
  assert.ok(results.slice(15, 30).every((result) => result.verified === false && result.confidence === null));
  assert.deepEqual(warnings.map((item) => item.code), ['EXPLANATION_FAILED']);
  assert.deepEqual(usage, addUsage(CALL_USAGE, CALL_USAGE));
});

test('extractRecords sends PDFs as document blocks, images as image blocks and docx as text', async () => {
  const records = { tables: [{ source: 'genomics', records: [{ MATERIAL_GUID: 'A-1', QC_CALL_RATE_PCT: null }] }], warnings: [] };
  const anthropic = fakeAnthropic(() => toolResponse(records, { name: 'submit_records' }));
  const client = clientFor(anthropic);

  const pdf = await client.extractRecords({ filename: 'lab.pdf', media: { media_type: 'application/pdf', data: 'JVBERi0=' } });
  await client.extractRecords({ filename: 'scan.png', media: { media_type: 'image/png', data: 'iVBORw0=' }, breederText: 'only 2025' });
  await client.extractRecords({ filename: 'notes.docx', text: 'MATERIAL_GUID A-1' });

  const blocks = anthropic.requests.map((body) => body.messages[0].content);
  assert.equal(blocks[0][1].type, 'document');
  assert.deepEqual(blocks[0][1].source, { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' });
  assert.equal(blocks[1][1].type, 'image');
  assert.match(blocks[1][2].text, /only 2025/);
  assert.equal(blocks[2][1].type, 'text');
  assert.match(blocks[2][1].text, /<document filename="notes.docx">\nMATERIAL_GUID A-1\n<\/document>/);
  assert.equal(anthropic.requests[0].tool_choice.name, 'submit_records');
  assert.ok(anthropic.requests[0].system[0].text.includes('genomics'));
  assert.deepEqual(pdf.tables, records.tables);

  await assert.rejects(client.extractRecords({ filename: 'empty.pdf' }), { code: 'VALIDATION_ERROR' });
});
