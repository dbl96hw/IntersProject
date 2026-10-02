import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_TEXT,
  UPLOAD_FIELD,
  UPLOAD_TEXT,
  WELCOME_TEXT,
  emptyFileText,
  unsupportedFileText,
} from '../constants';
import Workspace from './Workspace';

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function mockApi({ health, chats = [], route } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options) => {
      const parsed = new URL(url);
      if (route) {
        const routed = route(parsed, options);
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

describe('Workspace welcome and dashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a chat, sends the files as multipart and opens the new dashboard', async () => {
    const user = userEvent.setup();
    const analysed = [{ candidate_id: 'SYN-MZ-00001', colour: 'RED', reason: 'fails in 3 of 5 trials' }];
    const api = uploadApi({
      analysis: {
        summary: '1 candidates analysed: 0 green, 0 amber, 1 red.',
        candidates: analysed,
        warnings: [{ code: 'IRRELEVANT_FILE', message: '"invoice.pdf" does not look like breeding or trial data; it was skipped', file: 'invoice.pdf' }],
        ingestion: [
          { file: 'trials.csv', kind: 'table', accepted: true, source: 'trial_recommendations', rows: 72, message: null },
          { file: 'invoice.pdf', kind: 'document', accepted: false, source: null, rows: null, message: 'Not about breeding or trial data' },
        ],
      },
      candidates: analysed,
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
    expect(screen.queryByTestId('upload-add-button')).not.toBeInTheDocument();
    expect(api.created).toBe(1);
    const form = api.posted[0];
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('files').map((file) => file.name)).toEqual(['trials.csv', 'invoice.pdf']);

    await act(async () => {
      api.finish();
    });

    expect(await screen.findByTestId('candidate-row-SYN-MZ-00001')).toBeInTheDocument();
    expect(screen.queryByTestId('ingestion-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-warning-IRRELEVANT_FILE')).not.toBeInTheDocument();
    expect(api.created).toBe(1);
  });

  it('explains every file when an upload gives no candidates', async () => {
    const user = userEvent.setup();
    const api = uploadApi({
      analysis: {
        summary: '0 candidates analysed: 0 green, 0 amber, 0 red.',
        candidates: [],
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
    expect(screen.queryByTestId('ingestion-item-0')).not.toBeInTheDocument();
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

  it('lists every chat in the sidebar', async () => {
    const chats = Array.from({ length: 9 }, (_, index) => ({
      id: `chat-${index}`,
      title: `Chat ${index}`,
    }));
    mockApi({ health: { healthy: true, mode: 'live', engine: 'up' }, chats });

    render(<Workspace />);

    expect(await screen.findByTestId('recent-dashboard-chat-0')).toBeInTheDocument();
    expect(screen.getByTestId('recent-dashboard-chat-8')).toBeInTheDocument();
    expect(screen.queryByTestId('hidden-dashboards-count')).not.toBeInTheDocument();
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

const NEW_CHAT = { id: 'chat-new', title: 'New chat' };
const LIVE_HEALTH = { healthy: true, mode: 'live', engine: 'up' };

function analysisReply({ status = 'ok', candidates = [], ingestion = [], error = null } = {}) {
  return {
    user_message: { id: 'user-1', role: 'user' },
    assistant_message: {
      id: 'assistant-1',
      role: 'assistant',
      kind: 'analysis',
      status,
      error,
      analysis: status === 'ok' ? { summary: '', candidates, warnings: [], ingestion } : null,
    },
  };
}

// Routes the upload requests. `messagesReply` is what POST /api/chats/:id/messages returns.
function mockUploadApi({
  messagesReply,
  dashboardCandidates = [],
  onMessagesRequest = () => {},
  chatMessages = [],
}) {
  let hasCreatedChat = false;
  mockApi({
    health: LIVE_HEALTH,
    route: (parsed, options) => {
      if (parsed.pathname === '/api/chats' && options?.method === 'POST') {
        hasCreatedChat = true;
        return Promise.resolve(jsonResponse({ chat: NEW_CHAT }));
      }
      if (parsed.pathname === '/api/chats') {
        return Promise.resolve(jsonResponse({ chats: hasCreatedChat ? [NEW_CHAT] : [] }));
      }
      if (parsed.pathname === `/api/chats/${NEW_CHAT.id}/messages`) {
        onMessagesRequest(options);
        return messagesReply();
      }
      if (parsed.pathname === `/api/chats/${NEW_CHAT.id}`) {
        return Promise.resolve(jsonResponse({ chat: NEW_CHAT, messages: chatMessages }));
      }
      if (parsed.pathname.startsWith('/api/candidates')) {
        return Promise.resolve(jsonResponse({
          candidates: dashboardCandidates,
          total: dashboardCandidates.length,
          page: 1,
          page_size: 100,
        }));
      }
      return null;
    },
  });
}

async function submitFile(user, name = 'trials.csv') {
  await user.upload(screen.getByTestId('upload-input'), new File(['id'], name, { type: 'text/csv' }));
  await user.click(screen.getByTestId('upload-submit'));
}

describe('Workspace file upload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the files, creates a chat and opens the dashboard with green first', async () => {
    const user = userEvent.setup();
    let postedBody = null;
    const analysed = [
      { candidate_id: 'SYN-RED', colour: 'RED', reason: 'fails' },
      { candidate_id: 'SYN-GREEN', colour: 'GREEN', reason: 'passes' },
      { candidate_id: 'SYN-AMBER', colour: 'AMBER', reason: 'borderline' },
    ];
    mockUploadApi({
      messagesReply: () => Promise.resolve(jsonResponse(analysisReply({ candidates: analysed }))),
      dashboardCandidates: analysed,
      onMessagesRequest: (options) => {
        postedBody = options.body;
      },
    });

    render(<Workspace />);
    await submitFile(user);

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(postedBody.getAll(UPLOAD_FIELD).map((file) => file.name)).toEqual(['trials.csv']);
    expect(screen.getAllByTestId(/^triage-section-/).map((section) => section.getAttribute('data-testid'))).toEqual([
      'triage-section-green',
      'triage-section-amber',
      'triage-section-red',
    ]);
    expect(screen.queryByTestId('welcome-view')).not.toBeInTheDocument();
  });

  it('shows the analysis error, keeps the files and lets the user try again', async () => {
    const user = userEvent.setup();
    mockUploadApi({
      messagesReply: () => Promise.resolve(jsonResponse(analysisReply({
        status: 'error',
        error: { code: 'DATA_ENGINE_UNAVAILABLE', message: 'Data engine is unreachable' },
      }))),
    });

    render(<Workspace />);
    await submitFile(user);

    expect(await screen.findByTestId('upload-error')).toHaveTextContent(
      `Data engine is unreachable ${UPLOAD_TEXT.TRY_AGAIN}`,
    );
    expect(screen.getByTestId('selected-files')).toHaveTextContent('trials.csv');
    expect(screen.getByTestId('upload-submit')).toBeEnabled();
    expect(screen.queryByTestId('analysis-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });

  it('shows the server message when a file is too large', async () => {
    const user = userEvent.setup();
    mockUploadApi({
      messagesReply: () => Promise.resolve(jsonResponse(
        { error: { code: 'FILE_TOO_LARGE', message: '"trials.csv" is over 10 MB', field: 'files' } },
        false,
      )),
    });

    render(<Workspace />);
    await submitFile(user);

    expect(await screen.findByTestId('upload-error')).toHaveTextContent('"trials.csv" is over 10 MB');
    expect(screen.getByTestId('upload-submit')).toBeEnabled();
  });

  it('shows the network message when the server does not answer', async () => {
    const user = userEvent.setup();
    mockUploadApi({ messagesReply: () => Promise.reject(new TypeError('Failed to fetch')) });

    render(<Workspace />);
    await submitFile(user);

    expect(await screen.findByTestId('upload-error')).toHaveTextContent(UPLOAD_TEXT.NETWORK);
    expect(screen.getByTestId('selected-files')).toHaveTextContent('trials.csv');
    expect(screen.getByTestId('upload-submit')).toBeEnabled();
  });

  it('opens the empty dashboard and shows why each file was not used when no candidate was read', async () => {
    const user = userEvent.setup();
    const reply = analysisReply({
      ingestion: [
        { file: 'trials.csv', accepted: false, message: 'Could not read "trials.csv": the file is damaged' },
      ],
    });
    mockUploadApi({
      messagesReply: () => Promise.resolve(jsonResponse(reply)),
      chatMessages: [reply.assistant_message],
    });

    render(<Workspace />);
    await submitFile(user);

    expect(await screen.findByTestId('dashboard-empty')).toHaveTextContent(DASHBOARD_TEXT.EMPTY);
    expect(screen.queryByTestId('ingestion-item-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('welcome-view')).not.toBeInTheDocument();
  });

  it('rejects an unsupported or empty file in the browser without calling the server', async () => {
    mockApi({ health: LIVE_HEALTH });

    render(<Workspace />);
    fireEvent.drop(screen.getByTestId('upload-dropzone'), {
      dataTransfer: {
        files: [new File(['notes'], 'notes.txt', { type: 'text/plain' }), new File([], 'empty.csv', { type: 'text/csv' })],
      },
    });

    const problems = screen.getByTestId('upload-file-errors');
    expect(problems).toHaveTextContent(unsupportedFileText('notes.txt'));
    expect(problems).toHaveTextContent(emptyFileText('empty.csv'));
    expect(screen.queryByTestId('selected-files')).not.toBeInTheDocument();
    expect(screen.getByTestId('upload-submit')).toBeDisabled();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/messages'), expect.anything());
  });
});
