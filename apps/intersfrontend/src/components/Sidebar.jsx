import Logo from './Logo';
import PlantDecoration from './PlantDecoration';
import { APP_NAME, RECENT_DASHBOARD_LIMIT, SIDEBAR_TEXT } from '../constants';
import { MOCK_USER } from '../mocks/dashboards';
import './Sidebar.css';

function Sidebar({ chats, chatsStatus, chatsMessage, activeChatId, onNewDashboard, onSelectChat }) {
  const isNewDashboardActive = activeChatId === null;
  const visibleChats = chats.slice(0, RECENT_DASHBOARD_LIMIT);
  const hiddenCount = Math.max(chats.length - visibleChats.length, 0);

  return (
    <aside className="sidebar" data-testid="sidebar">
      <PlantDecoration />

      <div className="sidebar__brand">
        <Logo size={36} />
        <span className="sidebar__brand-name">{APP_NAME}</span>
      </div>

      <button
        type="button"
        className={`sidebar__new-button${isNewDashboardActive ? ' sidebar__new-button--active' : ''}`}
        onClick={onNewDashboard}
        aria-pressed={isNewDashboardActive}
        data-testid="new-dashboard-button"
      >
        <span className="sidebar__new-icon" aria-hidden="true">
          +
        </span>
        {SIDEBAR_TEXT.NEW_DASHBOARD}
      </button>

      <nav className="sidebar__recent" aria-labelledby="sidebar-recent-title">
        <h2 id="sidebar-recent-title" className="sidebar__section-title">
          {SIDEBAR_TEXT.RECENT_DASHBOARDS}
        </h2>

        {chatsStatus === 'loading' && (
          <p className="sidebar__empty" role="status" data-testid="chats-loading">
            {SIDEBAR_TEXT.LOADING}
          </p>
        )}

        {chatsStatus === 'error' && (
          <p className="sidebar__empty" role="alert" data-testid="chats-error">
            {chatsMessage}
          </p>
        )}

        {chatsStatus === 'ready' && visibleChats.length === 0 && (
          <p className="sidebar__empty">{SIDEBAR_TEXT.NO_DASHBOARDS}</p>
        )}

        {chatsStatus === 'ready' && visibleChats.length > 0 && (
          <ul className="sidebar__list">
            {visibleChats.map((chat) => {
              const isActive = chat.id === activeChatId;

              return (
                <li key={chat.id}>
                  <button
                    type="button"
                    className={`sidebar__dashboard${isActive ? ' sidebar__dashboard--active' : ''}`}
                    onClick={() => onSelectChat(chat.id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={chat.title}
                    data-testid={`recent-dashboard-${chat.id}`}
                  >
                    {chat.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {chatsStatus === 'ready' && hiddenCount > 0 && (
          <p className="sidebar__empty" role="status" data-testid="hidden-dashboards-count">
            {hiddenCount} {SIDEBAR_TEXT.HIDDEN_DASHBOARDS}
          </p>
        )}
      </nav>

      <div className="sidebar__user" data-testid="sidebar-user">
        <span className="sidebar__avatar" aria-hidden="true">
          {MOCK_USER.initials}
        </span>
        <span className="sidebar__user-name">{MOCK_USER.name}</span>
      </div>
    </aside>
  );
}

export default Sidebar;
