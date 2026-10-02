import { useEffect, useState } from 'react';
import { createChat, getChat, listChatCandidates, listChats, postChatFiles } from '../api/client';
import { replaceCandidate } from '../replaceCandidate';
import BackendStatus from '../components/BackendStatus';
import ChatWidget from '../components/ChatWidget';
import DashboardView from '../components/DashboardView';
import IngestionList from '../components/IngestionList';
import LeafDecoration from '../components/LeafDecoration';
import Sidebar from '../components/Sidebar';
import WelcomeView from '../components/WelcomeView';
import { BREEDER_USER, DASHBOARD_TEXT, HEALTH_TEXT, WELCOME_TEXT } from '../constants';
import './Workspace.css';

function latestAnalysis(messages) {
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind === 'analysis' && message.analysis) {
      return message.analysis;
    }
  }
  return null;
}

const listOrEmpty = (value) => (Array.isArray(value) ? value : []);

function Workspace() {
  const [chatsState, setChatsState] = useState({ state: 'loading', chats: [], message: '' });
  const [activeChatId, setActiveChatId] = useState(null);
  const [dashboardState, setDashboardState] = useState({ state: 'idle' });
  const [breederUser, setBreederUser] = useState(BREEDER_USER);
  const [upload, setUpload] = useState({ state: 'idle', message: '' });

  const activeChat = chatsState.chats.find((chat) => chat.id === activeChatId) ?? null;

  useEffect(() => {
    let cancelled = false;

    listChats()
      .then((chats) => {
        if (!cancelled) {
          setChatsState({ state: 'ready', chats, message: '' });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setChatsState({ state: 'error', chats: [], message: error.message || HEALTH_TEXT.UNREACHABLE });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeChatId) {
      return undefined;
    }

    let cancelled = false;

    Promise.all([listChatCandidates(activeChatId), getChat(activeChatId)])
      .then(([list, chat]) => {
        if (!cancelled) {
          const analysis = latestAnalysis(chat.messages);
          setDashboardState({
            state: 'ready',
            candidates: list.candidates,
            total: list.total,
            warnings: listOrEmpty(analysis?.warnings),
            ingestion: listOrEmpty(analysis?.ingestion),
            messages: chat.messages ?? [],
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDashboardState({ state: 'error', message: error.message || DASHBOARD_TEXT.LIST_INCOMPLETE });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  function handleNewDashboard() {
    setActiveChatId(null);
    setUpload({ state: 'idle', message: '' });
  }

  // Create dashboard: a new chat, then the files as one analysis message. The request is never
  // aborted (150 candidates take about 90 s); the button is replaced by a status while it runs.
  async function handleSubmitFiles(files) {
    if (upload.state === 'analyzing') {
      return;
    }
    setUpload({ state: 'analyzing', message: '' });
    try {
      const chat = await createChat();
      const body = await postChatFiles(chat.id, files);
      // Reload the list so the sidebar shows the title the backend gave the chat (the file names).
      const chats = await listChats().catch(() => null);
      setChatsState((current) => ({
        state: 'ready',
        chats: chats ?? [chat, ...current.chats.filter((item) => item.id !== chat.id)],
        message: '',
      }));
      const assistant = body?.assistant_message;
      if (assistant?.status === 'error') {
        setUpload({ state: 'error', message: assistant.error?.message || WELCOME_TEXT.UPLOAD_FAILED });
        return;
      }
      setUpload({ state: 'idle', message: '' });
      handleSelectChat(chat.id);
    } catch (error) {
      setUpload({ state: 'error', message: error.message || WELCOME_TEXT.UPLOAD_FAILED });
    }
  }

  function handleCandidateUpdated(updated) {
    setDashboardState((current) => {
      if (current.state !== 'ready') {
        return current;
      }
      return { ...current, candidates: replaceCandidate(current.candidates, updated) };
    });
  }

  function handleSelectChat(chatId) {
    setActiveChatId(chatId);
    setDashboardState({ state: 'loading' });
  }

  const dashboardFailed = activeChat && dashboardState.state === 'error';
  const dashboardLoading = activeChat && dashboardState.state === 'loading';
  const dashboardEmpty = activeChat && dashboardState.state === 'ready' && dashboardState.total === 0;
  const dashboardReady = activeChat && dashboardState.state === 'ready' && dashboardState.total > 0;

  return (
    <div className="workspace">
      <Sidebar
        chats={chatsState.chats}
        chatsStatus={chatsState.state}
        chatsMessage={chatsState.message}
        activeChatId={activeChatId}
        onNewDashboard={handleNewDashboard}
        onSelectChat={handleSelectChat}
        breederUser={breederUser}
        onBreederUserChange={setBreederUser}
      />

      <main className="workspace__main">
        <BackendStatus />
        <LeafDecoration position="top-right" />
        <LeafDecoration position="bottom-left" />

        <div className="workspace__scroll" data-testid="workspace-scroll">
          {!activeChat && (
            <WelcomeView
              isAnalyzing={upload.state === 'analyzing'}
              errorMessage={upload.state === 'error' ? upload.message : ''}
              onSubmitFiles={handleSubmitFiles}
            />
          )}

          {dashboardLoading && (
            <p className="workspace__status" role="status" data-testid="dashboard-loading">
              {DASHBOARD_TEXT.LOADING}
            </p>
          )}

          {dashboardFailed && (
            <p className="workspace__status" role="alert" data-testid="dashboard-error">
              {dashboardState.message}
            </p>
          )}

          {dashboardEmpty && (
            <div className="workspace__empty-analysis">
              <p role="status" data-testid="dashboard-empty">
                {DASHBOARD_TEXT.EMPTY}
              </p>
              <IngestionList ingestion={dashboardState.ingestion} />
              {dashboardState.warnings?.length > 0 && (
                <ul data-testid="analysis-warnings">
                  {dashboardState.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`} data-testid={`analysis-warning-${warning.code}`}>
                      {warning.code}: {warning.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {dashboardReady && (
            <DashboardView
              key={activeChat.id}
              title={activeChat.title}
              candidates={dashboardState.candidates}
              warnings={dashboardState.warnings}
              ingestion={dashboardState.ingestion}
              breederUser={breederUser}
              onCandidateUpdated={handleCandidateUpdated}
            />
          )}
        </div>
      </main>

      <ChatWidget
        key={activeChatId ?? 'welcome'}
        chatId={activeChatId}
        storedMessages={dashboardState.messages}
      />
    </div>
  );
}

export default Workspace;
