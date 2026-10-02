import { useState } from 'react';
import BackendStatus from '../components/BackendStatus';
import ChatWidget from '../components/ChatWidget';
import DashboardView from '../components/DashboardView';
import LeafDecoration from '../components/LeafDecoration';
import Sidebar from '../components/Sidebar';
import WelcomeView from '../components/WelcomeView';
import { MOCK_USER, RECENT_DASHBOARDS } from '../mocks/dashboards';
import './Workspace.css';

function Workspace() {
  const [dashboards, setDashboards] = useState(RECENT_DASHBOARDS);
  // null means "New dashboard" is selected, which shows the welcome screen.
  const [activeDashboardId, setActiveDashboardId] = useState(null);

  const activeDashboard = dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? null;

  function handleNewDashboard() {
    setActiveDashboardId(null);
  }

  function handleSelectDashboard(dashboardId) {
    setActiveDashboardId(dashboardId);
  }

  function handleUpdateCandidate(candidateId, changes) {
    setDashboards((currentDashboards) =>
      currentDashboards.map((dashboard) => {
        if (dashboard.id !== activeDashboardId) {
          return dashboard;
        }

        return {
          ...dashboard,
          candidates: dashboard.candidates.map((candidate) =>
            candidate.candidate_id === candidateId
              ? { ...candidate, ...changes, overridden: changes.colour !== candidate.engine_colour }
              : candidate,
          ),
        };
      }),
    );
  }

  return (
    <div className="workspace">
      <Sidebar
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        user={MOCK_USER}
        onNewDashboard={handleNewDashboard}
        onSelectDashboard={handleSelectDashboard}
      />

      <main className="workspace__main">
        <BackendStatus />
        <LeafDecoration position="top-right" />
        <LeafDecoration position="bottom-left" />

        <div className="workspace__scroll" data-testid="workspace-scroll">
          {activeDashboard ? (
            <DashboardView
              key={activeDashboard.id}
              dashboard={activeDashboard}
              onUpdateCandidate={handleUpdateCandidate}
            />
          ) : (
            <WelcomeView />
          )}
        </div>
      </main>

      {activeDashboard && <ChatWidget key={activeDashboard.id} candidates={activeDashboard.candidates} />}
    </div>
  );
}

export default Workspace;
