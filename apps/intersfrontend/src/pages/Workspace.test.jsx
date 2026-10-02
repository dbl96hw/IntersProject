import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_TEXT, HEALTH_REFRESH_MS, HEALTH_TEXT, SIDEBAR_TEXT, WELCOME_TEXT } from '../constants';
import Workspace from './Workspace';

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function mockApi({ health, chats = [], route } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const parsed = new URL(url);
      if (route) {
        const routed = route(parsed);
        if (routed) {
          return routed;
        }
      }
      if (parsed.pathname === '/health') {
        return Promise.resolve(jsonResponse(health));
      }
      if (parsed.pathname === '/api/chats') {
        return Promise.resolve(jsonResponse({ chats }));
      }
      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false));
    }),
  );
}

// Fake API for the upload flow. The analysis POST stays pending until `finish()` is called.
function uploadApi({ analysis = null, candidates = [], error = null }) {
  const chat = { id: 'chat-new', title: 'New chat' };
  const state = { created: 0, posted: [], listed: [], finish: () => {} };
  const assistant = error
    ? { id: 'a-1', role: 'assistant', kind: 'analysis', status: 'error', error, analysis: null, answer: null }
    : { id: 'a-1', role: 'assistant', kind: 'analysis', status: 'ok', error: null, analysis, answer: null };
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options = {}) => {
      const { pathname } = new URL(url);
      const method = options.method ?? 'GET';
      if (pathname === '/health') {
        return Promise.resolve(jsonResponse({ healthy: true, mode: 'live', engine: 'up' }));
      }
      if (pathname === '/api/chats' && method === 'POST') {
        state.created += 1;
        return Promise.resolve(jsonResponse({ chat }));
      }
      if (pathname === '/api/chats') {
        return Promise.resolve(jsonResponse({ chats: state.listed }));
      }
      if (pathname === '/api/chats/chat-new/messages') {
        state.posted.push(options.body);
        return new Promise((resolve) => {
          state.finish = () => {
            state.listed = [{ ...chat, title: 'trials.csv' }];
            resolve(jsonResponse({ user_message: { id: 'u-1', role: 'user' }, assistant_message: assistant }));
          };
        });
      }
      if (pathname === '/api/chats/chat-new') {
        return Promise.resolve(jsonResponse({ chat, messages: [assistant] }));
      }
      if (pathname.startsWith('/api/candidates')) {
        return Promise.resolve(jsonResponse({ candidates, total: candidates.length, page: 1, page_size: 100 }));
      }
      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false));
    }),
  );
  return state;
}

describe('Workspace backend status and welcome', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows a loading status before health answers', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(<Workspace />);

    expect(screen.getByTestId('backend-status-loading')).toHaveTextContent(HEALTH_TEXT.LOADING);
  });

  it('shows the mode and engine returned by health', async () => {
    mockApi({ health: { healthy: true, mode: 'live', engine: 'down' } });

    render(<Workspace />);

    const status = await screen.findByTestId('backend-status');
    expect(status).toHaveTextContent('live');
    expect(status).toHaveTextContent('down');
  });

  it('shows an error message when health cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<Workspace />);

    expect(await screen.findByTestId('backend-status-error')).toHaveTextContent(HEALTH_TEXT.UNREACHABLE);
    expect(screen.queryByTestId('backend-status')).not.toBeInTheDocument();
  });

  it('asks for health again after the refresh interval', async () => {
    vi.useFakeTimers();
    let healthCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const parsed = new URL(url);
        if (parsed.pathname === '/health') {
          healthCalls += 1;
          const engine = healthCalls === 1 ? 'down' : 'up';
          return Promise.resolve(jsonResponse({ healthy: true, mode: 'live', engine }));
        }
        if (parsed.pathname === '/api/chats') {
          return Promise.resolve(jsonResponse({ chats: [] }));
        }
        return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false));
      }),
    );

    render(<Workspace />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('backend-status')).toHaveTextContent('down');
    expect(healthCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS);
    });

    expect(screen.getByTestId('backend-status')).toHaveTextContent('up');
    expect(healthCalls).toBe(2);
  });

  it('shows a mock-mode notice when health mode is mock', async () => {
    mockApi({ health: { healthy: true, mode: 'mock', engine: 'skipped' } });

    render(<Workspace />);

    expect(await screen.findByTestId('backend-mock-notice')).toHaveTextContent(HEALTH_TEXT.MOCK_NOTICE);
  });

  it('creates a chat, sends the files as multipart and opens the new dashboard', async () => {
    const user = userEvent.setup();
    const api = uploadApi({
      analysis: {
        summary: '1 candidates analysed: 0 green, 0 amber, 1 red.',
        warnings: [{ code: 'IRRELEVANT_FILE', message: '"invoice.pdf" does not look like breeding or trial data; it was skipped', file: 'invoice.pdf' }],
        ingestion: [
          { file: 'trials.csv', kind: 'table', accepted: true, source: 'trial_recommendations', rows: 72, message: null },
          { file: 'invoice.pdf', kind: 'document', accepted: false, source: null, rows: null, message: 'Not about breeding or trial data' },
        ],
      },
      candidates: [{ candidate_id: 'SYN-MZ-00001', colour: 'RED', reason: 'fails in 3 of 5 trials' }],
    });

    render(<Workspace />);
    expect(screen.queryByTestId('upload-coming-soon')).not.toBeInTheDocument();
    await user.upload(screen.getByTestId('upload-input'), [
      new File(['TRIAL_GUID'], 'trials.csv', { type: 'text/csv' }),
      new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }),
    ]);
    await user.click(screen.getByTestId('upload-submit'));

    // While the analysis runs: a status instead of the button, so no second submit.
    expect(await screen.findByTestId('analysis-loading')).toHaveTextContent(WELCOME_TEXT.ANALYZING);
    expect(screen.queryByTestId('upload-submit')).not.toBeInTheDocument();
    expect(api.created).toBe(1);
    const form = api.posted[0];
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('files').map((file) => file.name)).toEqual(['trials.csv', 'invoice.pdf']);

    await act(async () => {
      api.finish();
    });

    expect(await screen.findByTestId('candidate-row-SYN-MZ-00001')).toBeInTheDocument();
    expect(screen.getByTestId('ingestion-item-0')).toHaveTextContent('trials.csv: used (trial_recommendations, 72 rows)');
    expect(screen.getByTestId('ingestion-item-1')).toHaveTextContent('invoice.pdf: not used - Not about breeding or trial data');
    expect(screen.getByTestId('analysis-warning-IRRELEVANT_FILE')).toBeInTheDocument();
    expect(api.created).toBe(1);
  });

  it('explains every file when an upload gives no candidates', async () => {
    const user = userEvent.setup();
    const api = uploadApi({
      analysis: {
        summary: '0 candidates analysed: 0 green, 0 amber, 0 red.',
        warnings: [],
        ingestion: [{ file: 'invoice.pdf', kind: 'document', accepted: false, source: null, rows: null, message: 'Not about breeding or trial data' }],
      },
      candidates: [],
    });

    render(<Workspace />);
    await user.upload(screen.getByTestId('upload-input'), new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByTestId('upload-submit'));
    await act(async () => {
      api.finish();
    });

    expect(await screen.findByTestId('dashboard-empty')).toHaveTextContent(DASHBOARD_TEXT.EMPTY);
    expect(screen.getByTestId('ingestion-item-0')).toHaveTextContent('invoice.pdf: not used');
  });

  it('stays on the upload screen with the error when the analysis fails', async () => {
    const user = userEvent.setup();
    const api = uploadApi({ error: { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' } });

    render(<Workspace />);
    await user.upload(screen.getByTestId('upload-input'), new File(['x'], 'trials.csv', { type: 'text/csv' }));
    await user.click(screen.getByTestId('upload-submit'));
    await act(async () => {
      api.finish();
    });

    expect(await screen.findByTestId('upload-error')).toHaveTextContent('Data engine is unreachable');
    expect(screen.getByTestId('upload-submit')).toBeEnabled();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });

  it('lists only the latest eight chats and shows how many are hidden', async () => {
    const chats = Array.from({ length: 9 }, (_, index) => ({
      id: `chat-${index}`,
      title: `Chat ${index}`,
    }));
    mockApi({ health: { healthy: true, mode: 'live', engine: 'up' }, chats });

    render(<Workspace />);

    expect(await screen.findByTestId('recent-dashboard-chat-0')).toBeInTheDocument();
    expect(screen.getByTestId('recent-dashboard-chat-7')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-dashboard-chat-8')).not.toBeInTheDocument();
    expect(screen.getByTestId('hidden-dashboards-count')).toHaveTextContent(`1 ${SIDEBAR_TEXT.HIDDEN_DASHBOARDS}`);
  });

  it('shows a loading status while candidates are in flight and no colour before they arrive', async () => {
    const user = userEvent.setup();
    mockApi({
      health: { healthy: true, mode: 'live', engine: 'up' },
      chats: [{ id: 'chat-1', title: 'Maize' }],
      route: (parsed) => {
        if (parsed.pathname.startsWith('/api/candidates') || parsed.pathname === '/api/chats/chat-1') {
          return new Promise(() => {});
        }
        return null;
      },
    });

    render(<Workspace />);
    await user.click(await screen.findByTestId('recent-dashboard-chat-1'));

    expect(await screen.findByTestId('dashboard-loading')).toHaveTextContent(DASHBOARD_TEXT.LOADING);
    expect(screen.queryByTestId(/^triage-section-/)).not.toBeInTheDocument();
  });

  it('shows an error and no candidate colour when the list fails', async () => {
    const user = userEvent.setup();
    mockApi({
      health: { healthy: true, mode: 'live', engine: 'up' },
      chats: [{ id: 'chat-1', title: 'Maize' }],
      route: (parsed) => {
        if (parsed.pathname.startsWith('/api/candidates')) {
          return Promise.resolve(jsonResponse(
            { error: { code: 'DATA_ENGINE_UNAVAILABLE', message: 'The engine is down', field: null } },
            false,
          ));
        }
        if (parsed.pathname === '/api/chats/chat-1') {
          return Promise.resolve(jsonResponse({ chat: { id: 'chat-1', title: 'Maize' }, messages: [] }));
        }
        return null;
      },
    });

    render(<Workspace />);
    await user.click(await screen.findByTestId('recent-dashboard-chat-1'));

    expect(await screen.findByTestId('dashboard-error')).toHaveTextContent('The engine is down');
    expect(screen.queryByTestId(/^candidate-row-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^triage-section-/)).not.toBeInTheDocument();
  });

  it('shows an empty status when the selected chat has no candidates', async () => {
    const user = userEvent.setup();
    mockApi({
      health: { healthy: true, mode: 'live', engine: 'up' },
      chats: [{ id: 'chat-1', title: 'Maize' }],
      route: (parsed) => {
        if (parsed.pathname.startsWith('/api/candidates')) {
          return Promise.resolve(jsonResponse({ candidates: [], total: 0, page: 1, page_size: 100 }));
        }
        if (parsed.pathname === '/api/chats/chat-1') {
          return Promise.resolve(jsonResponse({ chat: { id: 'chat-1', title: 'Maize' }, messages: [] }));
        }
        return null;
      },
    });

    render(<Workspace />);
    await user.click(await screen.findByTestId('recent-dashboard-chat-1'));

    expect(await screen.findByTestId('dashboard-empty')).toHaveTextContent(DASHBOARD_TEXT.EMPTY);
    expect(screen.queryByTestId(/^triage-section-/)).not.toBeInTheDocument();
  });

  it('shows an error and no rows when a page is empty before the total', async () => {
    const user = userEvent.setup();
    mockApi({
      health: { healthy: true, mode: 'live', engine: 'up' },
      chats: [{ id: 'chat-1', title: 'Maize' }],
      route: (parsed) => {
        if (parsed.pathname.startsWith('/api/candidates')) {
          const page = parsed.searchParams.get('page');
          if (page === '1') {
            return Promise.resolve(jsonResponse({
              candidates: [{ candidate_id: 'SYN-PARTIAL', colour: 'RED', reason: 'fails' }],
              total: 2,
              page: 1,
              page_size: 100,
            }));
          }
          return Promise.resolve(jsonResponse({ candidates: [], total: 2, page: 2, page_size: 100 }));
        }
        if (parsed.pathname === '/api/chats/chat-1') {
          return Promise.resolve(jsonResponse({ chat: { id: 'chat-1', title: 'Maize' }, messages: [] }));
        }
        return null;
      },
    });

    render(<Workspace />);
    await user.click(await screen.findByTestId('recent-dashboard-chat-1'));

    expect(await screen.findByTestId('dashboard-error')).toHaveTextContent(DASHBOARD_TEXT.LIST_INCOMPLETE);
    expect(screen.queryByTestId('candidate-row-SYN-PARTIAL')).not.toBeInTheDocument();
  });

  it('shows only the later chat when the first list returns after a switch', async () => {
    const user = userEvent.setup();
    let resolveFirst;
    mockApi({
      health: { healthy: true, mode: 'live', engine: 'up' },
      chats: [
        { id: 'chat-a', title: 'First' },
        { id: 'chat-b', title: 'Second' },
      ],
      route: (parsed) => {
        if (parsed.pathname === '/api/chats/chat-a') {
          return Promise.resolve(jsonResponse({ chat: { id: 'chat-a', title: 'First' }, messages: [] }));
        }
        if (parsed.pathname === '/api/chats/chat-b') {
          return Promise.resolve(jsonResponse({ chat: { id: 'chat-b', title: 'Second' }, messages: [] }));
        }
        if (!parsed.pathname.startsWith('/api/candidates')) {
          return null;
        }
        if (parsed.searchParams.get('chat_id') === 'chat-a') {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(jsonResponse({
          candidates: [{ candidate_id: 'SYN-B', colour: 'RED', reason: 'second chat' }],
          total: 1,
          page: 1,
          page_size: 100,
        }));
      },
    });

    render(<Workspace />);
    await user.click(await screen.findByTestId('recent-dashboard-chat-a'));
    await user.click(await screen.findByTestId('recent-dashboard-chat-b'));

    expect(await screen.findByTestId('candidate-row-SYN-B')).toBeInTheDocument();

    await act(async () => {
      resolveFirst(jsonResponse({
        candidates: [{ candidate_id: 'SYN-A', colour: 'GREEN', reason: 'first chat' }],
        total: 1,
        page: 1,
        page_size: 100,
      }));
    });

    expect(screen.queryByTestId('candidate-row-SYN-A')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-row-SYN-B')).toBeInTheDocument();
  });
});
