import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchFilter } from '../src/db/candidates.repo.js';
import { createMemoryDb } from '../src/db/memory.js';

const ENGINE_ROW = {
  candidate_id: 'SYN-MZ-00001',
  colour: 'RED',
  engine_colour: 'RED',
  overridden: false,
  override: null,
  verdict: 'FAIL',
  reason: 'fails in 3 of 5 trials',
  n_trials: 5,
  n_fail: 3,
  ambiguous_trials: ['SYN-TR-0025'],
  atypical: false,
  rule_version: 'UC4_MATERIAL_V0',
};

async function seedAnalysis(db) {
  const chat = await db.chats.createChat({ title: 'Maize 2024' });
  const message = await db.messages.saveMessage({ chat_id: chat.id, role: 'assistant', kind: 'analysis', analysis: { summary: 'ok' } });
  return { chat, message };
}

function candidateInput(chat, message, overrides = {}) {
  return {
    ...ENGINE_ROW,
    chat_id: chat.id,
    message_id: message.id,
    evidence: [{ rule: 'disease', field: 'DISEASE_SCORE', value: 7.7, statement: 'disease risk elevated' }],
    data_gaps: ['genomics source missing'],
    evidence_hash: 'hash-1',
    justification: 'Fails in 3 of 5 trials.',
    justification_source: 'claude',
    verified: true,
    confidence: 'high',
    ...overrides,
  };
}

test('createChat stores a chat and listChats returns newest first', async () => {
  const db = createMemoryDb();

  const first = await db.chats.createChat({ title: 'First' });
  const second = await db.chats.createChat();

  assert.equal(second.title, 'New chat');
  assert.deepEqual(await db.chats.getChat(first.id), first);
  assert.deepEqual((await db.chats.listChats()).map((chat) => chat.id), [second.id, first.id]);
});

test('updateChatTitle renames the chat and bumps updated_at', async () => {
  const db = createMemoryDb();
  const chat = await db.chats.createChat();

  const renamed = await db.chats.updateChatTitle(chat.id, 'trials-2024.csv');

  assert.equal(renamed.title, 'trials-2024.csv');
  assert.ok(renamed.updated_at > chat.updated_at);
  assert.equal(await db.chats.updateChatTitle('missing', 'x'), null);
});

test('saveMessage stores the message in order and bumps the chat', async () => {
  const db = createMemoryDb();
  const chat = await db.chats.createChat({ title: 'Chat' });

  const question = await db.messages.saveMessage({ chat_id: chat.id, role: 'user', kind: 'text', text: 'Which lines are red?' });
  const answer = await db.messages.saveMessage({
    chat_id: chat.id, role: 'assistant', kind: 'answer', text: '4 lines are red.', tool_calls: [{ name: 'query_candidates', input: { colour: 'RED' } }],
  });

  assert.equal(answer.status, 'ok');
  assert.deepEqual((await db.messages.listMessages(chat.id)).map((message) => message.id), [question.id, answer.id]);
  assert.ok((await db.chats.getChat(chat.id)).updated_at > chat.updated_at);
  await assert.rejects(db.messages.saveMessage({ chat_id: chat.id, role: 'system', kind: 'text' }), /invalid role/);
});

test('saveCandidates keeps engine fields verbatim and starts as pending', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);

  const [saved] = await db.candidates.saveCandidates([candidateInput(chat, message)]);
  const listed = await db.candidates.listCandidates({ chat_id: chat.id });

  assert.equal(saved.candidate_id, 'SYN-MZ-00001');
  assert.equal(saved.engine_colour, 'RED');
  assert.deepEqual(saved.ambiguous_trials, ['SYN-TR-0025']);
  assert.equal(listed.total, 1);
  assert.equal(listed.candidates[0].decision, 'pending');
  await assert.rejects(db.candidates.saveCandidates([candidateInput(chat, message, { engine_colour: 'red' })]), /invalid engine_colour/);
});

test('saveCandidates keeps colour, overridden and override verbatim', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);
  const override = {
    id: 'ov-1', timestamp_utc: '2026-10-01T13:44:00Z', user: 'breeder@syngenta', level: 'candidate', record: 'SYN-MZ-00001',
    engine_colour: 'RED', new_colour: 'AMBER', reason_code: 'FIELD_OBSERVATION', comment: 'good vigour', rule_version: 'UC4_MATERIAL_V0',
  };

  const [saved] = await db.candidates.saveCandidates([candidateInput(chat, message, { colour: 'AMBER', overridden: true, override })]);
  const read = await db.candidates.getCandidate(saved.id);

  assert.equal(read.colour, 'AMBER');
  assert.equal(read.engine_colour, 'RED');
  assert.equal(read.overridden, true);
  assert.deepEqual(read.override, override);
});

test('listCandidates paginates and filters', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);
  await db.candidates.saveCandidates([
    candidateInput(chat, message, { candidate_id: 'SYN-MZ-00001' }),
    candidateInput(chat, message, { candidate_id: 'SYN-MZ-00002', colour: 'GREEN', engine_colour: 'GREEN', reason: 'passes all trials' }),
    candidateInput(chat, message, { candidate_id: 'SYN-MZ-00003' }),
  ]);

  const firstPage = await db.candidates.listCandidates({ page: 1, page_size: 2 });
  const reds = await db.candidates.listCandidates({ colour: 'RED' });
  const search = await db.candidates.listCandidates({ q: 'passes' });

  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.candidates.length, 2);
  assert.equal(firstPage.page_size, 2);
  assert.equal(reds.total, 2);
  assert.deepEqual(search.candidates.map((candidate) => candidate.candidate_id), ['SYN-MZ-00002']);
});

test('the latest review wins and carries earlier fields forward', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);
  const [saved] = await db.candidates.saveCandidates([candidateInput(chat, message)]);

  await db.candidates.addReview({ candidate_row_id: saved.id, decision: 'pass', user_name: 'breeder@syngenta' });
  await db.candidates.addReview({
    candidate_row_id: saved.id, colour: 'AMBER', reason_code: 'FIELD_OBSERVATION', comment: 'good vigour', user_name: 'breeder@syngenta', engine_override_id: 'ov-1',
  });

  const read = await db.candidates.getCandidate(saved.id);
  const ambers = await db.candidates.listCandidates({ colour: 'AMBER' });

  assert.equal(read.review_colour, 'AMBER');
  assert.equal(read.decision, 'pass');
  assert.equal(read.edited, false);
  assert.equal((await db.candidates.listReviews(saved.id)).length, 2);
  assert.deepEqual(ambers.candidates.map((candidate) => candidate.id), [saved.id]);
});

test('findReusableJustification only returns a verified Claude row with the same triple', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);
  const [reusable] = await db.candidates.saveCandidates([
    candidateInput(chat, message),
    candidateInput(chat, message, { candidate_id: 'SYN-MZ-00002', verified: false }),
    candidateInput(chat, message, { candidate_id: 'SYN-MZ-00003', justification_source: 'engine' }),
  ]);

  const found = await db.candidates.findReusableJustification('SYN-MZ-00001', 'UC4_MATERIAL_V0', 'hash-1');

  assert.equal(found.id, reusable.id);
  assert.equal(await db.candidates.findReusableJustification('SYN-MZ-00001', 'UC4_MATERIAL_V0', 'hash-2'), null);
  assert.equal(await db.candidates.findReusableJustification('SYN-MZ-00001', 'OTHER_VERSION', 'hash-1'), null);
  assert.equal(await db.candidates.findReusableJustification('SYN-MZ-00009', 'UC4_MATERIAL_V0', 'hash-1'), null);
  assert.equal(await db.candidates.findReusableJustification('SYN-MZ-00002', 'UC4_MATERIAL_V0', 'hash-1'), null);
  assert.equal(await db.candidates.findReusableJustification('SYN-MZ-00003', 'UC4_MATERIAL_V0', 'hash-1'), null);
});

test('a search with commas and parentheses does not throw or change the filter structure', async () => {
  const db = createMemoryDb();
  const { chat, message } = await seedAnalysis(db);
  await db.candidates.saveCandidates([candidateInput(chat, message)]);

  const filter = buildSearchFilter('  SYN,(MZ)%,reason.eq.x  ');
  const result = await db.candidates.listCandidates({ q: 'SYN-MZ-00001),(' });

  assert.equal(filter, 'candidate_id.ilike.%SYNMZreason.eq.x%,reason.ilike.%SYNMZreason.eq.x%');
  assert.equal(filter.split(',').length, 2);
  assert.equal(buildSearchFilter(',()%'), null);
  assert.equal(buildSearchFilter('x'.repeat(150)).length, 'candidate_id.ilike.%%,reason.ilike.%%'.length + 200);
  assert.equal(result.total, 1);
});
