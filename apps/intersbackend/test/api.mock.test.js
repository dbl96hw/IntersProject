import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createMemoryFileStorage, toStoragePath } from '../src/services/fileStorage.js';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const SMALL_CSV = 'CANDIDATE_ID,DISEASE_SCORE\nSYN-MZ-00001,7.7\n';
const VALID_UPDATE = { new_colour: 'AMBER', reason_code: 'FIELD_OBSERVATION', comment: 'good vigour in plot 12', user: 'breeder@syngenta' };
const VALID_DECISION = { decision: 'no_pass', reason_code: 'MARKET_FIT', comment: 'maturity too late', user: 'breeder@syngenta' };

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    config: parseEnv({ ANALYSIS_MODE: 'mock', MAX_FILE_MB: '1', CORS_ORIGIN: FRONTEND_ORIGIN }),
    db: createMemoryDb(),
    fileStorage: createMemoryFileStorage(),
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
});

async function request(path, { method = 'GET', json, form, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: json ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: json ? JSON.stringify(json) : form,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function createChat(title) {
  const { body } = await request('/api/chats', { method: 'POST', json: title ? { title } : {} });
  return body.chat;
}

function formWith({ text, files = [] }) {
  const form = new FormData();
  if (text) form.append('text', text);
  files.forEach(({ name, content, type = 'text/csv' }) => form.append('files', new Blob([content], { type }), name));
  return form;
}

async function postMessage(chatId, message) {
  return request(`/api/chats/${chatId}/messages`, { method: 'POST', form: formWith(message) });
}

async function seedAnalysis() {
  const chat = await createChat();
  const { body } = await postMessage(chat.id, { files: [{ name: 'trials.csv', content: SMALL_CSV }] });
  return { chat, assistant: body.assistant_message };
}

test('POST /api/chats creates a chat with the default title', async () => {
  const { status, body } = await request('/api/chats', { method: 'POST', json: {} });

  assert.equal(status, 201);
  assert.equal(body.chat.title, 'New chat');
  assert.match(body.chat.id, /^[0-9a-f-]{36}$/);
});

test('an .exe upload is rejected with 400 UNSUPPORTED_FILE_TYPE', async () => {
  const chat = await createChat();

  const { status, body } = await postMessage(chat.id, { files: [{ name: 'virus.exe', content: 'MZ', type: 'application/octet-stream' }] });

  assert.equal(status, 400);
  assert.equal(body.error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal(body.error.field, 'files');
});

test('a file over MAX_FILE_MB is rejected with 413 FILE_TOO_LARGE', async () => {
  const chat = await createChat();
  const tooBig = 'x'.repeat(1024 * 1024 + 1);

  const { status, body } = await postMessage(chat.id, { files: [{ name: 'big.csv', content: tooBig }] });

  assert.equal(status, 413);
  assert.equal(body.error.code, 'FILE_TOO_LARGE');
  assert.match(body.error.message, /over 1 MB/);
});

test('a message with a small CSV returns 4 sample candidates and renames the chat', async () => {
  const chat = await createChat();

  const { status, body } = await postMessage(chat.id, { text: 'Analyse these trials', files: [{ name: 'trials-2024.csv', content: SMALL_CSV }] });
  const { analysis } = body.assistant_message;
  const { body: detail } = await request(`/api/chats/${chat.id}`);

  assert.equal(status, 201);
  assert.equal(body.user_message.files[0].kind, 'table');
  assert.equal(body.assistant_message.kind, 'analysis');
  assert.equal(body.assistant_message.status, 'ok');
  assert.equal(analysis.sample, true);
  assert.equal(analysis.candidates.length, 4);
  assert.deepEqual(analysis.candidates.map((candidate) => candidate.colour), ['GREEN', 'AMBER', 'RED', 'AMBER']);
  assert.ok(analysis.candidates.every((candidate) => candidate.justification_source === 'claude' && candidate.verified === true));
  assert.ok(analysis.candidates.every((candidate) => candidate.decision === 'pending'));
  assert.equal(analysis.candidates[3].data_gaps.length, 1);
  assert.equal(analysis.ingestion[0].file, 'trials-2024.csv');
  assert.equal(analysis.versions.model, 'mock');
  assert.equal(detail.chat.title, 'trials-2024.csv');
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[1].analysis.candidates.length, 4);
});

test('a question-only message returns an answer', async () => {
  const chat = await createChat('Questions');

  const { status, body } = await postMessage(chat.id, { text: 'Which lines are red?' });

  assert.equal(status, 201);
  assert.deepEqual(body.user_message.files, []);
  assert.equal(body.assistant_message.kind, 'answer');
  assert.equal(body.assistant_message.analysis, null);
  assert.match(body.assistant_message.answer.text, /SYN-MZ-90003/);
  assert.equal(body.assistant_message.answer.tool_calls[0].name, 'query_candidates');
});

test('a message with no text and no file is rejected with 400', async () => {
  const chat = await createChat();

  const { status, body } = await postMessage(chat.id, {});

  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.field, 'text');
});

test('an accented file name is kept as UTF-8 in the files row and the chat title', async () => {
  const chat = await createChat();

  const { status, body } = await postMessage(chat.id, { files: [{ name: 'análisis.csv', content: SMALL_CSV }] });
  const { body: detail } = await request(`/api/chats/${chat.id}`);

  assert.equal(status, 201);
  assert.equal(body.user_message.files[0].name, 'análisis.csv');
  assert.equal(detail.messages[0].files[0].name, 'análisis.csv');
  assert.equal(detail.chat.title, 'análisis.csv');
});

test('toStoragePath keeps only safe characters in the file name', () => {
  const storagePath = toStoragePath('chat-1', 'message-1', 0, 'análisis ../x.csv');
  const fileSegment = storagePath.split('/').at(-1);

  assert.equal(storagePath.split('/').length, 3);
  assert.match(fileSegment, /^[A-Za-z0-9._-]+$/);
  assert.equal(fileSegment, '0-an_lisis_.._x.csv');
});

test('unknown and malformed ids return 404 NOT_FOUND', async () => {
  const unknownChat = await request(`/api/chats/${randomUUID()}`);
  const malformedChat = await request('/api/chats/abc');
  const malformedCandidate = await request('/api/candidates/abc');
  const unknownCandidate = await request(`/api/candidates/${randomUUID()}`);

  for (const { status, body } of [unknownChat, malformedChat, malformedCandidate, unknownCandidate]) {
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  }
});

test('GET /api/candidates filters by colour and rejects an unknown colour', async () => {
  const { chat } = await seedAnalysis();

  const reds = await request(`/api/candidates?colour=RED&chat_id=${chat.id}`);
  const ambers = await request(`/api/candidates?colour=AMBER&chat_id=${chat.id}&page_size=1`);
  const invalid = await request('/api/candidates?colour=rojo');

  assert.equal(reds.status, 200);
  assert.equal(reds.body.total, 1);
  assert.ok(reds.body.candidates.every((candidate) => candidate.colour === 'RED'));
  assert.equal(ambers.body.total, 2);
  assert.equal(ambers.body.candidates.length, 1);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.equal(invalid.body.error.field, 'colour');
});

test('GET /api/candidates/:id returns the engine detail from the sample', async () => {
  const { assistant } = await seedAnalysis();
  const red = assistant.analysis.candidates.find((candidate) => candidate.colour === 'RED');

  const { status, body } = await request(`/api/candidates/${red.id}`);

  assert.equal(status, 200);
  assert.equal(body.candidate.candidate_id, 'SYN-MZ-90003');
  assert.equal(body.engine_detail.candidate_id, 'SYN-MZ-90003');
  assert.equal(body.candidate.colour, body.engine_detail.colour);
  assert.ok(body.engine_detail.evidence.length > 0);
});

test('PATCH /api/candidates/:id validates, then answers 501 NOT_IMPLEMENTED', async () => {
  const { assistant } = await seedAnalysis();
  const path = `/api/candidates/${assistant.analysis.candidates[0].id}`;

  const valid = await request(path, { method: 'PATCH', json: VALID_UPDATE });
  const noChange = await request(path, { method: 'PATCH', json: { ...VALID_UPDATE, new_colour: undefined } });
  const badColour = await request(path, { method: 'PATCH', json: { ...VALID_UPDATE, new_colour: 'rojo' } });
  const otherWithoutComment = await request(path, { method: 'PATCH', json: { ...VALID_UPDATE, reason_code: 'OTHER', comment: '' } });

  assert.equal(valid.status, 501);
  assert.equal(valid.body.error.code, 'NOT_IMPLEMENTED');
  assert.equal(noChange.status, 400);
  assert.equal(noChange.body.error.field, 'new_colour');
  assert.equal(badColour.status, 400);
  assert.equal(badColour.body.error.field, 'new_colour');
  assert.equal(otherWithoutComment.status, 400);
  assert.equal(otherWithoutComment.body.error.field, 'comment');
});

test('POST /api/candidates/:id/decision validates, then answers 501 NOT_IMPLEMENTED', async () => {
  const { assistant } = await seedAnalysis();
  const path = `/api/candidates/${assistant.analysis.candidates[0].id}/decision`;

  const valid = await request(path, { method: 'POST', json: VALID_DECISION });
  const badDecision = await request(path, { method: 'POST', json: { ...VALID_DECISION, decision: 'maybe' } });
  const noUser = await request(path, { method: 'POST', json: { decision: 'pass' } });

  assert.equal(valid.status, 501);
  assert.equal(valid.body.error.code, 'NOT_IMPLEMENTED');
  assert.equal(badDecision.status, 400);
  assert.equal(badDecision.body.error.field, 'decision');
  assert.equal(noUser.status, 400);
  assert.equal(noUser.body.error.field, 'user');
});

test('retrying a message that is not in error returns 400', async () => {
  const { chat, assistant } = await seedAnalysis();

  const { status, body } = await request(`/api/chats/${chat.id}/messages/${assistant.id}/retry`, { method: 'POST' });

  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/engine/* returns sample JSON in mock mode', async () => {
  const reasons = await request('/api/engine/override-reasons');
  const baseline = await request('/api/engine/baseline');
  const quality = await request('/api/engine/quality');

  assert.equal(reasons.status, 200);
  assert.ok('OTHER' in reasons.body);
  // The samples are real engine output on the UC4 mocks (weighted-severity rule, 72/72 parity).
  assert.equal(baseline.body.sample, true);
  assert.equal(baseline.body.parity.agree, 72);
  assert.equal(baseline.body.mode, 'weighted_severity');
  assert.ok(Array.isArray(quality.body.issues) && quality.body.issues.length > 0);
  assert.ok(quality.body.issues.every((issue) => issue.id && issue.fix_status));
});

test('CORS lets the frontend dev origin preflight a multipart POST', async () => {
  const { status, headers } = await request(`/api/chats/${randomUUID()}/messages`, {
    method: 'OPTIONS',
    headers: { Origin: FRONTEND_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });

  assert.equal(status, 204);
  assert.equal(headers.get('access-control-allow-origin'), FRONTEND_ORIGIN);
  assert.match(headers.get('access-control-allow-methods'), /POST/);
});
