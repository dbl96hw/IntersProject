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

  it('shows that file upload is coming soon and does not start an analysis', async () => {
    mockApi({ health: { healthy: true, mode: 'live', engine: 'up' } });
    const user = userEvent.setup();

    render(<Workspace />);

    expect(screen.getByTestId('upload-coming-soon')).toHaveTextContent(WELCOME_TEXT.UPLOAD_COMING_SOON);
    const file = new File(['id'], 'trials.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('upload-input'), file);

    expect(screen.getByTestId('upload-submit')).toBeDisabled();
    expect(screen.queryByTestId('analysis-loading')).not.toBeInTheDocument();
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
