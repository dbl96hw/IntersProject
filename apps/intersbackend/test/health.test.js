import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

const LIVE_ENV = {
  ANALYSIS_MODE: 'live',
  DATA_ENGINE_URL: 'http://engine.test',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_MODEL: 'test-model',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

async function getJson(app, path) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://localhost:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('GET /health in mock mode skips the engine', async () => {
  const app = createApp({ config: parseEnv({ ANALYSIS_MODE: 'mock' }) });

  const { status, body } = await getJson(app, '/health');

  assert.equal(status, 200);
  assert.deepEqual(body, { healthy: true, mode: 'mock', engine: 'skipped' });
});

test('GET /health in live mode reports engine up when health() resolves', async () => {
  const dataEngineClient = { health: async () => ({ status: 'ok' }) };
  const app = createApp({ config: parseEnv(LIVE_ENV), dataEngineClient });

  const { status, body } = await getJson(app, '/health');

  assert.equal(status, 200);
  assert.deepEqual(body, { healthy: true, mode: 'live', engine: 'up' });
});

test('GET /health in live mode reports engine down when health() rejects', async () => {
  const dataEngineClient = { health: async () => { throw new Error('connection refused'); } };
  const app = createApp({ config: parseEnv(LIVE_ENV), dataEngineClient });

  const { status, body } = await getJson(app, '/health');

  assert.equal(status, 200);
  assert.deepEqual(body, { healthy: true, mode: 'live', engine: 'down' });
});

test('GET / still returns the service status', async () => {
  const app = createApp({ config: parseEnv({ ANALYSIS_MODE: 'mock' }) });

  const { status, body } = await getJson(app, '/');

  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'intersbackend');
});
