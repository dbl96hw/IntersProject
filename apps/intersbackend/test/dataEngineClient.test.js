import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA_ENGINE_MAX_RETRY_DELAY_MS, DATA_ENGINE_RETRY_DELAY_MS } from '../src/constants/index.js';
import { createDataEngineClient, DataEngineError } from '../src/services/dataEngineClient.js';

const { Response } = globalThis;
const jsonResponse = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
});
const textResponse = (status, text, headers = {}) => new Response(text, { status, headers });

function setup(t, responses, { clock } = {}) {
  const queue = [...responses];
  const calls = [];
  const waits = [];
  const logs = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return next();
  });
  const client = createDataEngineClient({
    baseUrl: 'http://engine.test',
    timeoutMs: 100,
    ingestTimeoutMs: 100,
    wait: async (ms) => { waits.push(ms); },
    logger: { error: (line) => logs.push(line) },
    ...(clock ? { clock } : {}),
  });
  return { client, calls, waits, logs };
}

test('a 429 that is not from the engine is retried once, then reported as DATA_ENGINE_BUSY', async (t) => {
  const tooMany = () => textResponse(429, 'Too Many Requests');
  const { client, calls, waits, logs } = setup(t, [tooMany, tooMany]);

  const err = await client.listOverrideReasons().catch((caught) => caught);

  assert.ok(err instanceof DataEngineError);
  assert.equal(err.status, 429);
  assert.equal(err.code, 'DATA_ENGINE_BUSY');
  assert.doesNotMatch(err.message, /responded 429/);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [DATA_ENGINE_RETRY_DELAY_MS]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /GET http:\/\/engine\.test\/overrides\/reasons -> 429/);
});

test('a read that succeeds on the retry returns the engine payload', async (t) => {
  const { client, calls } = setup(t, [
    () => textResponse(503, 'busy'),
    () => jsonResponse(200, { tools: [], system_prompt: 'p' }),
  ]);

  const listed = await client.getTools();

  assert.deepEqual(listed, { tools: [], system_prompt: 'p' });
  assert.equal(calls.length, 2);
});

test('Retry-After is honoured up to the cap', async (t) => {
  const { client, waits } = setup(t, [
    () => textResponse(429, '', { 'Retry-After': '1' }),
    () => jsonResponse(200, {}),
    () => textResponse(429, '', { 'Retry-After': '60' }),
    () => jsonResponse(200, {}),
  ]);

  await client.getCandidate('SYN-MZ-00001');
  await client.getCandidate('SYN-MZ-00002');

  assert.deepEqual(waits, [1000, DATA_ENGINE_MAX_RETRY_DELAY_MS]);
});

test('writes are never retried', async (t) => {
  const { client, calls } = setup(t, [() => textResponse(429, 'slow down')]);

  const err = await client.createOverride({ candidate_id: 'SYN-MZ-00001', new_colour: 'RED' }).catch((caught) => caught);

  assert.equal(err.code, 'DATA_ENGINE_BUSY');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});

test("the engine's own error body is kept and not retried", async (t) => {
  const { client, calls, logs } = setup(t, [
    () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'unknown id: X' } }),
  ]);

  const err = await client.getCandidate('X').catch((caught) => caught);

  assert.equal(err.status, 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'unknown id: X');
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 0);
});

test('tools and override reasons are cached until the TTL expires', async (t) => {
  let now = 0;
  const reasons = { DATA_ERROR: 'Data error' };
  const { client, calls } = setup(t, [
    () => jsonResponse(200, reasons),
    () => jsonResponse(200, reasons),
  ], { clock: () => now });

  await client.listOverrideReasons();
  now += 60 * 1000;
  await client.listOverrideReasons();
  assert.equal(calls.length, 1);

  now += 10 * 60 * 1000;
  assert.deepEqual(await client.listOverrideReasons(), reasons);
  assert.equal(calls.length, 2);
});

test('a failed read is not cached', async (t) => {
  const { client, calls } = setup(t, [
    () => jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' } }),
    () => jsonResponse(200, { tools: [] }),
  ]);

  await assert.rejects(client.getTools(), { code: 'INTERNAL_ERROR' });
  assert.deepEqual(await client.getTools(), { tools: [] });
  assert.equal(calls.length, 2);
});
