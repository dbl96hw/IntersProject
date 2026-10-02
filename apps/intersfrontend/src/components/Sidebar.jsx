import Logo from './Logo';
import PlantDecoration from './PlantDecoration';
import { APP_NAME, SIDEBAR_TEXT } from '../constants';
import './Sidebar.css';

function initialsFrom(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

function Sidebar({
  chats,
  chatsStatus,
  chatsMessage,
  activeChatId,
  onNewDashboard,
  onSelectChat,
  breederUser = '',
  onBreederUserChange = () => {},
}) {
  const isNewDashboardActive = activeChatId === null;

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

        {chatsStatus === 'ready' && chats.length === 0 && (
          <p className="sidebar__empty">{SIDEBAR_TEXT.NO_DASHBOARDS}</p>
        )}

        {chatsStatus === 'ready' && chats.length > 0 && (
          <ul className="sidebar__list">
            {chats.map((chat) => {
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
      </nav>

      <div className="sidebar__user" data-testid="sidebar-user">
        <span className="sidebar__avatar" aria-hidden="true">
          {initialsFrom(breederUser)}
        </span>
        <label className="sidebar__user-field">
          {SIDEBAR_TEXT.BREEDER}
          <input
            className="sidebar__user-input"
            type="text"
            value={breederUser}
            onChange={(event) => onBreederUserChange(event.target.value)}
            data-testid="breeder-user-input"
          />
        </label>
      </div>
    </aside>
  );
}

export default Sidebar;
