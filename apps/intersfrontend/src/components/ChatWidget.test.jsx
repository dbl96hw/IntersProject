import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_WARNING_CODES, CHAT_TEXT } from '../constants';
import ChatWidget from './ChatWidget';

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function answerMessage(text, warnings = []) {
  return {
    user_message: { id: 'user-1', role: 'user', text },
    assistant_message: {
      id: 'assistant-1',
      role: 'assistant',
      kind: 'answer',
      status: 'ok',
      error: null,
      answer: {
        text,
        tool_calls: [],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 },
        warnings,
        versions: { explanation_prompt: null, rule_version: null, model: 'mock', chat_prompt: 'engine' },
      },
    },
  };
}

function errorMessage(code, message) {
  return {
    user_message: { id: 'user-1', role: 'user', text: 'question' },
    assistant_message: {
      id: 'assistant-1',
      role: 'assistant',
      kind: 'answer',
      status: 'error',
      error: { code, message },
      answer: null,
    },
  };
}

function mockFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

async function openPanel(user) {
  await user.click(screen.getByTestId('chat-widget-header'));
}

async function sendQuestion(user, text) {
  await openPanel(user);
  await user.type(screen.getByTestId('chat-input'), text);
  await user.click(screen.getByTestId('chat-send-button'));
}

describe('ChatWidget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts minimized', () => {
    render(<ChatWidget chatId="chat-1" />);

    expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-messages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-minimize-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-widget-header')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands from the header and shows the minus button only while open', async () => {
    const user = userEvent.setup();
    render(<ChatWidget chatId="chat-1" />);

    await user.click(screen.getByRole('button', { name: CHAT_TEXT.EXPAND }));

    expect(screen.getByTestId('chat-messages')).toBeInTheDocument();
    expect(screen.getByTestId('chat-minimize-button')).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByTestId('chat-minimize-button'));

    expect(screen.queryByTestId('chat-messages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-minimize-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-widget-header')).toBeInTheDocument();
  });

  it('closes from the minimized bar without expanding', async () => {
    const user = userEvent.setup();
    render(<ChatWidget chatId="chat-1" />);

    await user.click(screen.getByTestId('chat-close-button'));

    expect(screen.queryByTestId('chat-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-messages')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-toggle-button')).toBeInTheDocument();
  });

  it('posts only the question text and shows the answer', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage('SYN-MZ-00001 is red.'))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'which lines are red?');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/api/chats/chat-1/messages');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ text: 'which lines are red?' });
    expect(screen.getByText('SYN-MZ-00001 is red.')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-number-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('keeps line breaks in the answer text', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage('line one\nline two'))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'why?');

    const answer = screen.getByText(/line one/);
    expect(answer.textContent).toBe('line one\nline two');
    expect(answer).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });

  it('renders **bold** and *bold* from the model as strong text, without the asterisks', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage('**RED**: 54\n- *GREEN*: 25\n- 2 * 3 stays'))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'How many lines are there per colour?');

    const red = screen.getByText('RED');
    expect(red.tagName).toBe('STRONG');
    expect(screen.getByText('GREEN').tagName).toBe('STRONG');
    const answer = red.closest('p');
    expect(answer.textContent).toBe('RED: 54\n- GREEN: 25\n- 2 * 3 stays');
    expect(answer.textContent).not.toContain('**');
  });

  it('shows HTML in an answer as text and never runs it', async () => {
    const user = userEvent.setup();
    const html = '<script>window.hacked = true</script><b>x</b>';
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage(html))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'why?');

    expect(screen.getByText(html)).toBeInTheDocument();
    expect(document.querySelector('.chat-message__text script')).toBeNull();
    expect(document.querySelector('.chat-message__text b')).toBeNull();
    expect(window.hacked).toBeUndefined();
  });

  it('leaves an answer without markdown unchanged', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage('SYN-MZ-00001 is RED: yield 6.07 t/ha.'))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'why?');

    const answer = screen.getByText('SYN-MZ-00001 is RED: yield 6.07 t/ha.');
    expect(answer.querySelector('strong')).toBeNull();
  });

  it('shows a calm notice when numbers could not be checked and never a verified mark', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(answerMessage('20 lines are red.', [
      { code: ANSWER_WARNING_CODES.UNVERIFIED_NUMBERS, message: 'from the server', file: null },
    ]))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'how many are red?');

    expect(screen.getByText('20 lines are red.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-number-warning')).toHaveTextContent(CHAT_TEXT.NUMBER_WARNING);
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('shows the read-only notice once the panel is open', async () => {
    const user = userEvent.setup();
    render(<ChatWidget chatId="chat-1" />);

    await openPanel(user);

    expect(screen.getByTestId('chat-readonly-notice')).toHaveTextContent(CHAT_TEXT.READONLY);
  });

  it('shows chat-no-chat and does not call the server when no chat is open', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.reject(new Error('should not be called')));
    render(<ChatWidget />);

    await openPanel(user);

    expect(screen.getByTestId('chat-no-chat')).toHaveTextContent(CHAT_TEXT.NO_CHAT);
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a saved answer warning from answer.warnings', async () => {
    const user = userEvent.setup();
    render(
      <ChatWidget
        chatId="chat-1"
        storedMessages={[{
          id: 'saved-1',
          role: 'assistant',
          kind: 'answer',
          status: 'ok',
          answer: {
            text: 'Saved answer',
            warnings: [{ code: ANSWER_WARNING_CODES.UNVERIFIED_NUMBERS, message: 'server', file: null }],
          },
        }]}
      />,
    );

    await openPanel(user);

    expect(screen.getByText('Saved answer')).toBeInTheDocument();
    expect(screen.getByTestId('chat-number-warning')).toBeInTheDocument();
  });

  it('disables send and shows typing until the answer arrives', async () => {
    const user = userEvent.setup();
    let resolveFetch;
    mockFetch(() => new Promise((resolve) => {
      resolveFetch = () => resolve(jsonResponse(answerMessage('done')));
    }));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'how many?');

    expect(screen.getByTestId('chat-typing')).toBeInTheDocument();
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch();

    expect(await screen.findByText('done')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-typing')).not.toBeInTheDocument();
  });

  it.each([
    'ANSWER_TIMEOUT',
    'ANSWER_ROUND_LIMIT',
    'LLM_UNAVAILABLE',
    'DATA_ENGINE_UNAVAILABLE',
  ])('shows %s with its message', async (code) => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(errorMessage(code, `${code} happened`))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'question');

    expect(await screen.findByTestId(`chat-error-${code}`)).toHaveTextContent(`${code} happened`);
  });

  it('shows an unlisted error code with a fallback when the server sends no message', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.resolve(jsonResponse(errorMessage('MADE_UP', undefined))));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'question');

    expect(await screen.findByTestId('chat-error-MADE_UP')).toHaveTextContent(CHAT_TEXT.ERROR_FALLBACK);
  });

  it('shows a network failure without breaking the widget', async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.reject(new Error('offline')));
    render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'question');

    expect(await screen.findByTestId('chat-error-network')).toHaveTextContent(CHAT_TEXT.NETWORK);
    expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
  });

  it('does not paint an in-flight answer on the chat that was opened later', async () => {
    const user = userEvent.setup();
    let resolveFetch;
    mockFetch(() => new Promise((resolve) => {
      resolveFetch = () => resolve(jsonResponse(answerMessage('late answer for the first chat')));
    }));
    const { rerender } = render(<ChatWidget chatId="chat-1" />);

    await sendQuestion(user, 'question for the first chat');
    expect(screen.getByText('question for the first chat')).toBeInTheDocument();

    rerender(<ChatWidget chatId="chat-2" storedMessages={[]} />);

    await act(async () => {
      resolveFetch();
    });

    expect(screen.queryByText('late answer for the first chat')).not.toBeInTheDocument();
    expect(screen.queryByText('question for the first chat')).not.toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toContain('/api/chats/chat-1/messages');
  });
});
