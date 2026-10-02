import { useEffect, useRef, useState } from 'react';
import { postChatMessage } from '../api/client';
import { ANSWER_WARNING_CODES, API_ERROR_CODES, CHAT_TEXT } from '../constants';
import Logo from './Logo';
import './ChatWidget.css';

const SENDER = { BOT: 'bot', USER: 'user' };
const EMPTY_MESSAGES = [];

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function hasUnverifiedNumbers(warnings) {
  return Array.isArray(warnings)
    && warnings.some((warning) => warning?.code === ANSWER_WARNING_CODES.UNVERIFIED_NUMBERS);
}

function bubbleFromStored(message) {
  if (message?.role === 'user' && message.text) {
    return { id: message.id, sender: SENDER.USER, text: message.text };
  }
  if (message?.kind !== 'answer') {
    return null;
  }
  if (message.status === 'error') {
    return {
      id: message.id,
      sender: SENDER.BOT,
      errorCode: message.error?.code || 'UNKNOWN',
      errorMessage: message.error?.message || CHAT_TEXT.ERROR_FALLBACK,
    };
  }
  if (message.status === 'ok' && message.answer?.text) {
    return {
      id: message.id,
      sender: SENDER.BOT,
      text: message.answer.text,
      warnings: message.answer.warnings ?? [],
    };
  }
  return null;
}

function bubblesFromStored(storedMessages) {
  if (!Array.isArray(storedMessages)) {
    return [];
  }
  return storedMessages.map(bubbleFromStored).filter(Boolean);
}

function failureBubble(id, error) {
  if (!error?.code || error.code === API_ERROR_CODES.NETWORK) {
    return {
      id,
      sender: SENDER.BOT,
      errorCode: 'network',
      errorMessage: CHAT_TEXT.NETWORK,
    };
  }
  return {
    id,
    sender: SENDER.BOT,
    errorCode: error.code,
    errorMessage: error.message || CHAT_TEXT.ERROR_FALLBACK,
  };
}

function ChatWidget({ chatId = null, storedMessages = EMPTY_MESSAGES }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(true);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState(() => bubblesFromStored(storedMessages));

  const nextMessageId = useRef(1);
  const generation = useRef(0);
  const hasLocalTurn = useRef(false);
  const messageListRef = useRef(null);

  useEffect(() => {
    generation.current += 1;
    hasLocalTurn.current = false;
    setIsSending(false);
  }, [chatId]);

  useEffect(() => {
    if (hasLocalTurn.current) {
      return;
    }
    setMessages(bubblesFromStored(storedMessages));
  }, [storedMessages, chatId]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, isSending, isOpen, isMinimized]);

  function takeId() {
    const id = `local-${nextMessageId.current}`;
    nextMessageId.current += 1;
    return id;
  }

  async function handleSend(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending || !chatId) {
      return;
    }

    const generationAtSend = generation.current;
    const chatAtSend = chatId;
    hasLocalTurn.current = true;
    setMessages((current) => [
      ...current,
      { id: takeId(), sender: SENDER.USER, text, time: formatTime(new Date()) },
    ]);
    setDraft('');
    setIsSending(true);

    try {
      const body = await postChatMessage(chatAtSend, text);
      if (generation.current !== generationAtSend) {
        return;
      }
      const assistant = body?.assistant_message;
      if (assistant?.status === 'error') {
        setMessages((current) => [...current, {
          id: assistant.id || takeId(),
          sender: SENDER.BOT,
          errorCode: assistant.error?.code || 'UNKNOWN',
          errorMessage: assistant.error?.message || CHAT_TEXT.ERROR_FALLBACK,
          time: formatTime(new Date()),
        }]);
      } else {
        setMessages((current) => [...current, {
          id: assistant?.id || takeId(),
          sender: SENDER.BOT,
          text: assistant?.answer?.text ?? '',
          warnings: assistant?.answer?.warnings ?? [],
          time: formatTime(new Date()),
        }]);
      }
    } catch (error) {
      if (generation.current !== generationAtSend) {
        return;
      }
      setMessages((current) => [...current, {
        ...failureBubble(takeId(), error),
        time: formatTime(new Date()),
      }]);
    } finally {
      if (generation.current === generationAtSend) {
        setIsSending(false);
      }
    }
  }

  function handleToggleMinimize() {
    setIsMinimized((currentValue) => !currentValue);
  }

  function handleClose() {
    setIsOpen(false);
  }

  function handleOpen() {
    setIsOpen(true);
    setIsMinimized(false);
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="chat-toggle"
        onClick={handleOpen}
        aria-label={CHAT_TEXT.OPEN}
        data-testid="chat-toggle-button"
      >
        <Logo size={32} className="chat-toggle__logo" />
      </button>
    );
  }

  return (
    <aside
      className="chat-widget"
      aria-label={CHAT_TEXT.TITLE}
      data-testid="chat-widget"
    >
      <header className="chat-widget__header">
        <h2 className="chat-widget__title">{CHAT_TEXT.TITLE}</h2>
        <button
          type="button"
          className="chat-widget__header-button"
          onClick={handleToggleMinimize}
          aria-label={CHAT_TEXT.MINIMIZE}
          aria-expanded={!isMinimized}
          data-testid="chat-minimize-button"
        >
          &minus;
        </button>
        <button
          type="button"
          className="chat-widget__header-button"
          onClick={handleClose}
          aria-label={CHAT_TEXT.CLOSE}
          data-testid="chat-close-button"
        >
          &times;
        </button>
      </header>

      {!isMinimized && (
        <>
          <p className="chat-widget__notice" data-testid="chat-readonly-notice">{CHAT_TEXT.READONLY}</p>
          <ul className="chat-widget__messages" ref={messageListRef} data-testid="chat-messages">
            {!chatId && (
              <li className="chat-message chat-message--bot" data-testid="chat-no-chat">
                <p className="chat-message__text">{CHAT_TEXT.NO_CHAT}</p>
              </li>
            )}
            {messages.map((message) => (
              <li
                key={message.id}
                className={`chat-message chat-message--${message.sender}`}
                data-testid={`chat-message-${message.sender}`}
              >
                {message.errorCode ? (
                  <p className="chat-message__text" data-testid={`chat-error-${message.errorCode}`}>
                    {message.errorMessage}
                  </p>
                ) : (
                  <p className="chat-message__text" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</p>
                )}
                {hasUnverifiedNumbers(message.warnings) && (
                  <p className="chat-message__warning" data-testid="chat-number-warning">
                    {CHAT_TEXT.NUMBER_WARNING}
                  </p>
                )}
                {message.time && <span className="chat-message__time">{message.time}</span>}
              </li>
            ))}
            {isSending && (
              <li className="chat-message chat-message--bot" role="status" data-testid="chat-typing">
                <p className="chat-message__text">{CHAT_TEXT.TYPING}</p>
              </li>
            )}
          </ul>

          <form className="chat-widget__form" onSubmit={handleSend}>
            <input
              type="text"
              className="chat-widget__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={CHAT_TEXT.INPUT_PLACEHOLDER}
              aria-label={CHAT_TEXT.INPUT_PLACEHOLDER}
              disabled={!chatId || isSending}
              data-testid="chat-input"
            />
            <button
              type="submit"
              className="chat-widget__send-button"
              disabled={!chatId || !draft.trim() || isSending}
              aria-label={CHAT_TEXT.SEND}
              data-testid="chat-send-button"
            >
              &rarr;
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

export default ChatWidget;
