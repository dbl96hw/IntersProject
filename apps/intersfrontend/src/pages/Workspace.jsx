import { useEffect, useState } from 'react';
import {
  ApiError,
  createChat,
  getChat,
  listChatCandidates,
  listChats,
  postChatFiles,
} from '../api/client';
import { replaceCandidate } from '../replaceCandidate';
import BackendStatus from '../components/BackendStatus';
import ChatWidget from '../components/ChatWidget';
import DashboardView from '../components/DashboardView';
import LeafDecoration from '../components/LeafDecoration';
import Sidebar from '../components/Sidebar';
import WelcomeView from '../components/WelcomeView';
import { API_ERROR_CODES, BREEDER_USER, DASHBOARD_TEXT, HEALTH_TEXT, UPLOAD_TEXT } from '../constants';
import './Workspace.css';

const IDLE_UPLOAD_STATE = { isAnalyzing: false, errorMessage: '', rejectedFiles: [] };

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

function uploadErrorMessage(error) {
  if (!(error instanceof ApiError)) {
    return HEALTH_TEXT.UNEXPECTED;
  }
  return error.code === API_ERROR_CODES.NETWORK ? UPLOAD_TEXT.NETWORK : error.message;
}

function Workspace() {
  const [chatsState, setChatsState] = useState({ state: 'loading', chats: [], message: '' });
  const [activeChatId, setActiveChatId] = useState(null);
  const [dashboardState, setDashboardState] = useState({ state: 'idle' });
  const [breederUser, setBreederUser] = useState(BREEDER_USER);
  const [uploadState, setUploadState] = useState(IDLE_UPLOAD_STATE);

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
    setUploadState(IDLE_UPLOAD_STATE);
  }

  function handleFilesChange() {
    setUploadState((current) => (current.isAnalyzing ? current : IDLE_UPLOAD_STATE));
  }

  async function handleSubmitFiles(files) {
    setUploadState({ ...IDLE_UPLOAD_STATE, isAnalyzing: true });

    try {
      const chat = await createChat();
      const body = await postChatFiles(chat.id, files);

      // The backend renames the chat after the files. If the refresh fails, the new chat is still
      // added locally so the dashboard can open.
      const refreshedChats = await listChats().catch(() => null);
      setChatsState((current) => ({
        state: 'ready',
        chats: refreshedChats ?? [chat, ...current.chats],
        message: '',
      }));

      const assistantMessage = body.assistant_message;
      if (assistantMessage?.status === 'error') {
        const reason = assistantMessage.error?.message ?? HEALTH_TEXT.UNEXPECTED;
        setUploadState({ ...IDLE_UPLOAD_STATE, errorMessage: `${reason} ${UPLOAD_TEXT.TRY_AGAIN}` });
        return;
      }

      const analysis = assistantMessage?.analysis;
      if (assistantMessage?.status !== 'ok' || !Array.isArray(analysis?.candidates)) {
        setUploadState({ ...IDLE_UPLOAD_STATE, errorMessage: HEALTH_TEXT.UNEXPECTED });
        return;
      }

      if (analysis.candidates.length === 0) {
        const rejectedFiles = (analysis.ingestion ?? [])
          .filter((item) => item.accepted === false)
          .map((item) => ({ name: item.file ?? '', message: item.message ?? '' }));
        setUploadState({ ...IDLE_UPLOAD_STATE, errorMessage: UPLOAD_TEXT.NO_CANDIDATES, rejectedFiles });
        return;
      }

      handleSelectChat(chat.id);
    } catch (error) {
      setUploadState({ ...IDLE_UPLOAD_STATE, errorMessage: uploadErrorMessage(error) });
    } finally {
      setUploadState((current) => ({ ...current, isAnalyzing: false }));
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
              isAnalyzing={uploadState.isAnalyzing}
              errorMessage={uploadState.errorMessage}
              rejectedFiles={uploadState.rejectedFiles}
              onSubmitFiles={handleSubmitFiles}
              onFilesChange={handleFilesChange}
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

      <ChatWidget
        key={activeChatId ?? 'welcome'}
        chatId={activeChatId}
        storedMessages={dashboardState.messages}
      />
    </div>
  );
}

export default Workspace;
