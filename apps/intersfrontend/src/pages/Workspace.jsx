import { useEffect, useState } from 'react';
import { getChat, listChatCandidates, listChats } from '../api/client';
import { replaceCandidate } from '../replaceCandidate';
import BackendStatus from '../components/BackendStatus';
import ChatWidget from '../components/ChatWidget';
import DashboardView from '../components/DashboardView';
import LeafDecoration from '../components/LeafDecoration';
import Sidebar from '../components/Sidebar';
import WelcomeView from '../components/WelcomeView';
import { BREEDER_USER, DASHBOARD_TEXT, HEALTH_TEXT } from '../constants';
import './Workspace.css';

function latestAnalysisWarnings(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind === 'analysis' && message.analysis) {
      return Array.isArray(message.analysis.warnings) ? message.analysis.warnings : [];
    }
  }
  return [];
}

function Workspace() {
  const [chatsState, setChatsState] = useState({ state: 'loading', chats: [], message: '' });
  const [activeChatId, setActiveChatId] = useState(null);
  const [dashboardState, setDashboardState] = useState({ state: 'idle' });
  const [breederUser, setBreederUser] = useState(BREEDER_USER);

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
          setDashboardState({
            state: 'ready',
            candidates: list.candidates,
            total: list.total,
            warnings: latestAnalysisWarnings(chat.messages),
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
          {!activeChat && <WelcomeView />}

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
            <p className="workspace__status" role="status" data-testid="dashboard-empty">
              {DASHBOARD_TEXT.EMPTY}
            </p>
          )}

          {dashboardReady && (
            <DashboardView
              key={activeChat.id}
              title={activeChat.title}
              candidates={dashboardState.candidates}
              warnings={dashboardState.warnings}
              breederUser={breederUser}
              onCandidateUpdated={handleCandidateUpdated}
            />
          )}
        </div>
      </main>

      {dashboardReady && <ChatWidget key={activeChat.id} candidates={dashboardState.candidates} />}
    </div>
  );
}

export default Workspace;
