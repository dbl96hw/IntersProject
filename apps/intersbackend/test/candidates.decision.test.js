import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createMemoryDb } from '../src/db/memory.js';
import { DataEngineError } from '../src/services/dataEngineClient.js';
import { createMemoryFileStorage } from '../src/services/fileStorage.js';

const LIVE_ENV = {
  ANALYSIS_MODE: 'live',
  DATA_ENGINE_URL: 'http://engine.test',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

const PATCH_BODY = {
  new_colour: 'AMBER',
  reason_code: 'FIELD_OBSERVATION',
  comment: 'good vigour in plot 12',
  user: 'breeder@syngenta',
};

function engineRow() {
  return {
    candidate_id: 'SYN-MZ-00001',
    colour: 'RED',
    engine_colour: 'RED',
    overridden: false,
    override: null,
    verdict: 'FAIL',
    reason: 'fails in 3 of 5 trials',
    n_trials: 5,
    n_fail: 3,
    rule_version: 'UC4_MATERIAL_V0',
  };
}

function fakeEngine({ onOverride } = {}) {
  const calls = { requests: [], overrides: [], gets: 0 };
  let current = engineRow();
  return {
    calls,
    async getCandidate(id) {
      calls.gets += 1;
      if (id !== current.candidate_id) {
        throw new DataEngineError(404, { code: 'NOT_FOUND', message: `${id} not found` });
      }
      return { ...current };
    },
    async createOverride(body) {
      calls.requests.push(body);
      if (onOverride) return onOverride(body);
      const entry = {
        id: `ov-${calls.overrides.length + 1}`,
        timestamp_utc: '2026-10-02T06:00:00Z',
        user: body.user,
        level: 'candidate',
        record: body.candidate_id,
        engine_colour: current.engine_colour,
        new_colour: body.new_colour,
        reason_code: body.reason_code,
        comment: body.comment,
        rule_version: current.rule_version,
      };
      calls.overrides.push(entry);
      current = { ...current, colour: body.new_colour, overridden: true, override: entry };
      return entry;
    },
  };
}

async function seedCandidate(db) {
  const chat = await db.chats.createChat({ title: 'Maize' });
  const message = await db.messages.saveMessage({
    chat_id: chat.id, role: 'assistant', kind: 'analysis', analysis: { summary: 'ok' },
  });
  const [saved] = await db.candidates.saveCandidates([{
    ...engineRow(),
    chat_id: chat.id,
    message_id: message.id,
    justification: 'Fails in 3 of 5 trials.',
    justification_source: 'claude',
    verified: true,
    confidence: 'high',
  }]);
  return saved;
}

async function withApp(db, engine, run) {
  const app = createApp({
    config: parseEnv(LIVE_ENV),
    db,
    fileStorage: createMemoryFileStorage(),
    dataEngineClient: engine,
    claude: null,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
  }
}

async function send(baseUrl, path, json, method = 'PATCH') {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('a live colour change is the engine override and the review stores its id', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);

    assert.equal(status, 200);
    assert.equal(engine.calls.requests.length, 1);
    assert.equal(engine.calls.requests[0].candidate_id, 'SYN-MZ-00001');
    assert.equal(engine.calls.requests[0].new_colour, 'AMBER');
    assert.equal(body.candidate.colour, 'AMBER');
    assert.equal(body.candidate.engine_colour, 'RED');
    assert.equal(body.candidate.overridden, true);
    assert.equal(body.override.id, 'ov-1');
    assert.deepEqual(body.candidate.override, body.override);
    const reviews = await db.candidates.listReviews(saved.id);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].user_name, 'breeder@syngenta');
    assert.equal(reviews[0].engine_override_id, 'ov-1');
  });
});

test('OTHER with a blank comment is rejected before the engine is called', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}`, {
      ...PATCH_BODY, reason_code: 'OTHER', comment: '',
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.field, 'comment');
    assert.equal(engine.calls.overrides.length, 0);
    assert.equal((await db.candidates.listReviews(saved.id)).length, 0);
  });
});

test('an unknown reason on a colour change is the engine 400 and writes no review', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine({
    onOverride() {
      throw new DataEngineError(400, {
        code: 'VALIDATION_ERROR',
        message: 'reason_code must be one of the override reasons',
        field: 'reason_code',
      });
    },
  });

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}`, {
      ...PATCH_BODY, reason_code: 'NOT_A_REASON',
    });

    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.message, 'reason_code must be one of the override reasons');
    assert.equal(body.error.field, 'reason_code');
    assert.equal((await db.candidates.listReviews(saved.id)).length, 0);
  });
});

test('an unreachable engine does not store a review', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine({
    onOverride() {
      throw new DataEngineError(502, { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' });
    },
  });

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);

    assert.equal(status, 502);
    assert.equal(body.error.code, 'DATA_ENGINE_UNAVAILABLE');
    assert.equal((await db.candidates.listReviews(saved.id)).length, 0);
  });
});

test('a failed review insert leaves the engine override in place', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();
  db.candidates.addReview = async () => {
    throw new Error('Supabase: insert failed');
  };

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);

    assert.equal(status, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(engine.calls.overrides.length, 1);
    assert.equal(engine.calls.overrides[0].id, 'ov-1');
  });
});

test('a successful override is stored on the candidate row', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);
    const row = await db.candidates.getCandidate(saved.id);

    assert.equal(row.colour, 'AMBER');
    assert.equal(row.engine_colour, 'RED');
    assert.equal(row.overridden, true);
    assert.equal(row.override.id, 'ov-1');
    assert.equal(row.override.new_colour, 'AMBER');
    assert.equal(row.override.engine_colour, 'RED');
  });
});

test('a later GET returns the stored effective colour beside the engine colour', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);
    const res = await fetch(`${baseUrl}/api/candidates/${saved.id}`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.candidate.colour, 'AMBER');
    assert.equal(body.candidate.engine_colour, 'RED');
    assert.notEqual(body.candidate.colour, body.candidate.engine_colour);
    assert.equal(body.candidate.override.id, 'ov-1');
  });
});

test('a pass or no pass decision does not call the engine', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    const { status, body } = await send(baseUrl, `/api/candidates/${saved.id}/decision`, {
      decision: 'no_pass',
      reason_code: 'MARKET_FIT',
      comment: 'maturity too late for this market',
      user: 'breeder@syngenta',
    }, 'POST');

    assert.equal(status, 200);
    assert.equal(body.candidate.decision, 'no_pass');
    assert.equal(body.candidate.colour, 'RED');
    assert.equal(body.candidate.engine_colour, 'RED');
    assert.equal(engine.calls.overrides.length, 0);
  });
});

test('a second override keeps both reviews and the later colour', async () => {
  const db = createMemoryDb();
  const saved = await seedCandidate(db);
  const engine = fakeEngine();

  await withApp(db, engine, async (baseUrl) => {
    await send(baseUrl, `/api/candidates/${saved.id}`, PATCH_BODY);
    const second = await send(baseUrl, `/api/candidates/${saved.id}`, { ...PATCH_BODY, new_colour: 'GREEN' });
    const reviews = await db.candidates.listReviews(saved.id);

    assert.equal(second.status, 200);
    assert.equal(second.body.candidate.colour, 'GREEN');
    assert.equal(second.body.candidate.engine_colour, 'RED');
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews.map((review) => review.engine_override_id), ['ov-1', 'ov-2']);
  });
});
