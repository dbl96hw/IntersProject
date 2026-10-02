import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, API_ERROR_CODES, HEALTH_PATH } from '../constants/api';
import { HEALTH_TEXT } from '../constants/messages';
import { ApiError, requestJson } from './client';

describe('requestJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the 200 body and requests the base URL plus the path', async () => {
    const body = { healthy: true, mode: 'live', engine: 'up' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestJson(HEALTH_PATH);

    expect(result).toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}${HEALTH_PATH}`, expect.any(Object));
  });

  it('rejects a non-ok response with the error code, message and field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'VALIDATION_ERROR', message: 'user is required', field: 'user' },
        }),
      }),
    );

    const error = await requestJson(HEALTH_PATH).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('user is required');
    expect(error.field).toBe('user');
  });

  it('rejects a failed request with a code, a message and a null field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await requestJson(HEALTH_PATH).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(API_ERROR_CODES.NETWORK);
    expect(error.message).toBe(HEALTH_TEXT.UNREACHABLE);
    expect(error.field).toBeNull();
  });
});
