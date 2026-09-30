import Logo from './Logo';
import PlantDecoration from './PlantDecoration';
import { APP_NAME, SIDEBAR_TEXT } from '../constants';
import './Sidebar.css';

function Sidebar({ dashboards, activeDashboardId, user, onNewDashboard, onSelectDashboard }) {
  const isNewDashboardActive = activeDashboardId === null;

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

        {dashboards.length === 0 ? (
          <p className="sidebar__empty">{SIDEBAR_TEXT.NO_DASHBOARDS}</p>
        ) : (
          <ul className="sidebar__list">
            {dashboards.map((dashboard) => {
              const isActive = dashboard.id === activeDashboardId;

              return (
                <li key={dashboard.id}>
                  <button
                    type="button"
                    className={`sidebar__dashboard${isActive ? ' sidebar__dashboard--active' : ''}`}
                    onClick={() => onSelectDashboard(dashboard.id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={dashboard.title}
                    data-testid={`recent-dashboard-${dashboard.id}`}
                  >
                    {dashboard.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="sidebar__user" data-testid="sidebar-user">
        <span className="sidebar__avatar" aria-hidden="true">
          {user.initials}
        </span>
        <span className="sidebar__user-name">{user.name}</span>
      </div>
    </aside>
  );
}

export default Sidebar;
