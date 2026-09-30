import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import { CHAT_TEXT, MOCK_CHAT_DELAY_MS } from '../constants';
import { CHAT_WELCOME_MESSAGE, getMockChatReply } from '../mocks/chatReplies';
import './ChatWidget.css';

const SENDER = { BOT: 'bot', USER: 'user' };

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ChatWidget({ candidates }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [draft, setDraft] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [messages, setMessages] = useState(() => [
    { id: 0, sender: SENDER.BOT, text: CHAT_WELCOME_MESSAGE, time: formatTime(new Date()) },
  ]);

  const nextMessageId = useRef(1);
  const replyCount = useRef(0);
  const replyTimeout = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => () => window.clearTimeout(replyTimeout.current), []);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, isBotTyping, isOpen, isMinimized]);

  function addMessage(sender, text) {
    const message = { id: nextMessageId.current, sender, text, time: formatTime(new Date()) };
    nextMessageId.current += 1;
    setMessages((currentMessages) => [...currentMessages, message]);
  }

  function handleSend(event) {
    event.preventDefault();

    const text = draft.trim();
    if (!text || isBotTyping) {
      return;
    }

    // Built now so the reply quotes the rows as they were when the user asked.
    const replyText = getMockChatReply(text, candidates, replyCount.current);
    replyCount.current += 1;

    addMessage(SENDER.USER, text);
    setDraft('');
    setIsBotTyping(true);

    replyTimeout.current = window.setTimeout(() => {
      addMessage(SENDER.BOT, replyText);
      setIsBotTyping(false);
    }, MOCK_CHAT_DELAY_MS);
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
          <ul className="chat-widget__messages" ref={messageListRef} data-testid="chat-messages">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`chat-message chat-message--${message.sender}`}
                data-testid={`chat-message-${message.sender}`}
              >
                <p className="chat-message__text">{message.text}</p>
                <span className="chat-message__time">{message.time}</span>
              </li>
            ))}
            {isBotTyping && (
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
              data-testid="chat-input"
            />
            <button
              type="submit"
              className="chat-widget__send-button"
              disabled={!draft.trim() || isBotTyping}
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
