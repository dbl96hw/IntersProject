import assert from 'node:assert/strict';
import { test } from 'node:test';
import multer from 'multer';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { createDataEngineClient, DataEngineError } from '../src/services/dataEngineClient.js';

function runHandler(err) {
  const req = { method: 'GET', originalUrl: '/test' };
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  errorHandler(err, req, res, () => {});
  return res;
}

test('DataEngineError keeps the engine status and code', (t) => {
  t.mock.method(console, 'error', () => {});
  const err = new DataEngineError(404, { code: 'CANDIDATE_NOT_FOUND', message: 'Unknown candidate', field: 'id' });

  const res = runHandler(err);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: { code: 'CANDIDATE_NOT_FOUND', message: 'Unknown candidate', field: 'id' } });
});

test('a network failure reaching the engine maps to 502 DATA_ENGINE_UNAVAILABLE', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  const client = createDataEngineClient({ baseUrl: 'http://engine.test', timeoutMs: 100 });

  const err = await client.health().catch((caught) => caught);
  const res = runHandler(err);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'DATA_ENGINE_UNAVAILABLE');
});

test('a raw fetch failure also maps to 502 DATA_ENGINE_UNAVAILABLE', (t) => {
  t.mock.method(console, 'error', () => {});

  const res = runHandler(new TypeError('fetch failed'));

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'DATA_ENGINE_UNAVAILABLE');
});

test('multer LIMIT_FILE_SIZE maps to 413 FILE_TOO_LARGE, other multer errors to 400', (t) => {
  t.mock.method(console, 'error', () => {});

  const tooLarge = runHandler(new multer.MulterError('LIMIT_FILE_SIZE', 'files'));
  const tooMany = runHandler(new multer.MulterError('LIMIT_FILE_COUNT', 'files'));

  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.error.code, 'FILE_TOO_LARGE');
  assert.equal(tooLarge.body.error.field, 'files');
  assert.equal(tooMany.statusCode, 400);
  assert.equal(tooMany.body.error.code, 'VALIDATION_ERROR');
  assert.equal(tooMany.body.error.field, 'files');
});

test('unknown errors map to 500 INTERNAL_ERROR without a stack trace', (t) => {
  t.mock.method(console, 'error', () => {});

  const res = runHandler(new Error('boom'));

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error', field: null } });
});
