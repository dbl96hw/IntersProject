import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERROR_CODES, HTTP_STATUS } from '../src/constants/index.js';
import { createMemoryDb } from '../src/db/memory.js';
import { createCandidatesService } from '../src/services/candidates.service.js';
import { DataEngineError } from '../src/services/dataEngineClient.js';

const UPDATE = {
  new_colour: 'AMBER',
  reason_code: 'FIELD_OBSERVATION',
  comment: 'good vigour in plot 12',
  user: 'breeder@syngenta',
};

async function seedCandidate(db) {
  const chat = await db.chats.createChat({ title: 'live path' });
  const message = await db.messages.saveMessage({
    chat_id: chat.id,
    role: 'assistant',
    kind: 'analysis',
  });
  const [candidate] = await db.candidates.saveCandidates([{
    chat_id: chat.id,
    message_id: message.id,
    candidate_id: 'SYN-MZ-00001',
    colour: 'RED',
    engine_colour: 'RED',
    verdict: 'FAIL',
    reason: 'fails in 3 of 5 trials',
    rule_version: 'UC4_MATERIAL_V0',
  }]);
  return candidate;
}

function engineAfterOverride() {
  return {
    candidate_id: 'SYN-MZ-00001',
    colour: 'AMBER',
    engine_colour: 'RED',
    overridden: true,
    override: { id: 'ov-1' },
    verdict: 'FAIL',
    reason: 'fails in 3 of 5 trials',
    rule_version: 'UC4_MATERIAL_V0',
  };
}

test('updateCandidate forwards the colour change to the injected engine', async () => {
  const db = createMemoryDb();
  const candidate = await seedCandidate(db);
  const calls = [];
  const service = createCandidatesService({
    db,
    dataEngineClient: {
      listOverrideReasons: async () => ({ FIELD_OBSERVATION: 'field' }),
      createOverride: async (body) => {
        calls.push(body);
        return { id: 'ov-1', new_colour: body.new_colour, engine_colour: 'RED' };
      },
      getCandidate: async () => engineAfterOverride(),
    },
  });

  const result = await service.updateCandidate(candidate.id, UPDATE);

  assert.deepEqual(calls, [{
    candidate_id: 'SYN-MZ-00001',
    new_colour: 'AMBER',
    reason_code: 'FIELD_OBSERVATION',
    comment: 'good vigour in plot 12',
    user: 'breeder@syngenta',
  }]);
  assert.equal(result.candidate.colour, 'AMBER');
  assert.equal(result.candidate.engine_colour, 'RED');
  assert.equal(result.override.id, 'ov-1');
});

test('an engine error on override is returned unchanged and nothing is saved', async () => {
  const cases = [
    new DataEngineError(HTTP_STATUS.BAD_GATEWAY, {
      code: ERROR_CODES.DATA_ENGINE_UNAVAILABLE,
      message: 'Data engine is unreachable',
    }),
    new DataEngineError(HTTP_STATUS.BAD_REQUEST, {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'reason_code must be one of FIELD_OBSERVATION',
      field: 'reason_code',
    }),
  ];

  for (const engineError of cases) {
    const db = createMemoryDb();
    const candidate = await seedCandidate(db);
    const service = createCandidatesService({
      db,
      dataEngineClient: {
        listOverrideReasons: async () => ({ FIELD_OBSERVATION: 'field' }),
        createOverride: async () => { throw engineError; },
        getCandidate: async () => { throw new Error('getCandidate should not run'); },
      },
    });

    await assert.rejects(
      () => service.updateCandidate(candidate.id, UPDATE),
      (err) => err === engineError,
    );
    const stored = await db.candidates.getCandidate(candidate.id);
    assert.equal(stored.colour, 'RED');
    assert.equal(stored.decision, 'pending');
    assert.equal((await db.candidates.listReviews(candidate.id)).length, 0);
  }
});
