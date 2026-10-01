import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from '../src/config/env.js';

const LIVE_ENV = {
  ANALYSIS_MODE: 'live',
  DATA_ENGINE_URL: 'http://engine.test',
  ANTHROPIC_API_KEY: 'secret-anthropic-value',
  ANTHROPIC_MODEL: 'test-model',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-supabase-value',
};

function withoutVariable(name) {
  const env = { ...LIVE_ENV };
  delete env[name];
  return env;
}

function captureError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected parseEnv to throw');
}

test('live mode fails and names a missing ANTHROPIC_API_KEY without printing values', () => {
  const err = captureError(() => parseEnv(withoutVariable('ANTHROPIC_API_KEY')));

  assert.match(err.message, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(err.message, /secret-supabase-value/);
  assert.doesNotMatch(err.message, /test-model/);
});

test('live mode requires DATA_ENGINE_URL to be set explicitly', () => {
  const err = captureError(() => parseEnv(withoutVariable('DATA_ENGINE_URL')));

  assert.match(err.message, /DATA_ENGINE_URL/);
});

test('an empty value counts as missing in live mode', () => {
  const err = captureError(() => parseEnv({ ...LIVE_ENV, SUPABASE_SERVICE_ROLE_KEY: '' }));

  assert.match(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('mock mode applies defaults and returns a frozen config', () => {
  const config = parseEnv({});

  assert.equal(config.analysisMode, 'mock');
  assert.equal(config.port, 3000);
  assert.equal(config.dataEngineUrl, 'http://localhost:8001');
  assert.equal(config.supabaseBucket, 'uploads');
  assert.ok(Object.isFrozen(config));
});

test('DATA_ENGINE_INGEST_TIMEOUT_MS defaults to 120000 and must be at least 60000', () => {
  assert.equal(parseEnv({}).dataEngineIngestTimeoutMs, 120000);
  assert.equal(parseEnv({ DATA_ENGINE_INGEST_TIMEOUT_MS: '90000' }).dataEngineIngestTimeoutMs, 90000);

  const err = captureError(() => parseEnv({ DATA_ENGINE_INGEST_TIMEOUT_MS: '30000' }));

  assert.match(err.message, /DATA_ENGINE_INGEST_TIMEOUT_MS/);
});
