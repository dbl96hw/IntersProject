import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, API_ERROR_CODES, CANDIDATES_PAGE_SIZE, HEALTH_PATH, MAX_CANDIDATE_PAGES } from '../constants/api';
import { DASHBOARD_TEXT, HEALTH_TEXT } from '../constants/messages';
import { ApiError, listChatCandidates, requestJson } from './client';

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

function pageBody(candidates, total) {
  return {
    ok: true,
    json: async () => ({ candidates, page: 1, page_size: CANDIDATES_PAGE_SIZE, total }),
  };
}

describe('listChatCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests page_size 100 until the collected rows equal total', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageBody([{ candidate_id: 'SYN-1', colour: 'RED', reason: 'one' }], 2))
      .mockResolvedValueOnce(pageBody([{ candidate_id: 'SYN-2', colour: 'GREEN', reason: 'two' }], 2));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listChatCandidates('chat-1');

    expect(result.total).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toContain(`page_size=${CANDIDATES_PAGE_SIZE}`);
    expect(fetchMock.mock.calls[0][0]).toContain('chat_id=chat-1');
    expect(fetchMock.mock.calls[0][0]).toContain('page=1');
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');
  });

  it('rejects an empty page before total so a partial list is not returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(pageBody([{ candidate_id: 'SYN-1', reason: 'one' }], 2))
        .mockResolvedValueOnce(pageBody([], 2)),
    );

    const error = await listChatCandidates('chat-1').catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(DASHBOARD_TEXT.LIST_INCOMPLETE);
  });

  it('rejects when the page cap is reached before total', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => pageBody(
      Array.from({ length: CANDIDATES_PAGE_SIZE }, (_, index) => ({ candidate_id: `id-${index}` })),
      MAX_CANDIDATE_PAGES * CANDIDATES_PAGE_SIZE + 1,
    ));
    vi.stubGlobal('fetch', fetchMock);

    const error = await listChatCandidates('chat-1').catch((caught) => caught);

    expect(error.message).toBe(DASHBOARD_TEXT.LIST_INCOMPLETE);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CANDIDATE_PAGES);
  });
});
