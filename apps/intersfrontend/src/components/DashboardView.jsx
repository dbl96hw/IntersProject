import { useCallback, useState } from 'react';
import DashboardFilters from './DashboardFilters';
import EditCandidateModal from './EditCandidateModal';
import RowContextMenu from './RowContextMenu';
import TriageSection from './TriageSection';
import {
  DASHBOARD_TEXT,
  FILTER_TEXT,
  STATUS_FILTER_ALL,
  TRIAGE_STATUS,
  TRIAGE_STATUS_ORDER,
} from '../constants';
import './DashboardView.css';

function matchesSearch(candidate, searchText) {
  const query = searchText.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return [candidate.candidate_id, candidate.crop, candidate.reason].join(' ').toLowerCase().includes(query);
}

function DashboardView({ dashboard, onUpdateCandidate }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_ALL);

  const candidateCount = dashboard.candidates.length;
  const searchedCandidates = dashboard.candidates.filter((candidate) => matchesSearch(candidate, searchText));
  // Chip counts follow the search, so they always match what clicking the chip would show.
  const statusCounts = {
    [STATUS_FILTER_ALL]: searchedCandidates.length,
    ...Object.fromEntries(
      TRIAGE_STATUS_ORDER.map((statusKey) => [
        statusKey,
        searchedCandidates.filter((candidate) => candidate.colour === statusKey).length,
      ]),
    ),
  };
  const visibleStatusKeys =
    statusFilter === STATUS_FILTER_ALL ? TRIAGE_STATUS_ORDER : [statusFilter];
  const visibleCount = visibleStatusKeys.reduce((total, statusKey) => total + statusCounts[statusKey], 0);

  function handleToggleRow(candidateId) {
    setExpandedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(candidateId)) {
        nextIds.delete(candidateId);
      } else {
        nextIds.add(candidateId);
      }
      return nextIds;
    });
  }

  function handleRowContextMenu(candidate, x, y) {
    setContextMenu({ candidate, x, y });
  }

  // The menu and modal attach document listeners that depend on these, so they must keep one identity.
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  function handleEditRow() {
    setEditingCandidate(contextMenu.candidate);
    setContextMenu(null);
  }

  const handleCloseModal = useCallback(() => {
    setEditingCandidate(null);
  }, []);

  function handleSaveCandidate(changes) {
    onUpdateCandidate(editingCandidate.candidate_id, changes);
    setEditingCandidate(null);
  }

  return (
    <section className="dashboard" data-testid="dashboard-view" aria-labelledby="dashboard-title">
      <header className="dashboard__header">
        <div>
          <h1 id="dashboard-title" className="dashboard__title">
            {DASHBOARD_TEXT.TITLE}
          </h1>
          <p className="dashboard__subtitle">{DASHBOARD_TEXT.SUBTITLE}</p>
          <p className="dashboard__hint">{DASHBOARD_TEXT.ROW_HINT}</p>
        </div>

        <div
          className="dashboard__summary"
          title={dashboard.fileNames.join(', ')}
          data-testid="dashboard-summary"
        >
          <span className="dashboard__summary-title">{DASHBOARD_TEXT.FILES_ANALYZED}</span>
          <span className="dashboard__summary-detail">
            {candidateCount} {DASHBOARD_TEXT.CANDIDATES_EVALUATED}
          </span>
        </div>
      </header>

      <DashboardFilters
        searchText={searchText}
        onSearchChange={setSearchText}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        statusCounts={statusCounts}
      />

      {visibleCount === 0 ? (
        <p className="dashboard__empty" role="status" data-testid="filter-empty">
          {FILTER_TEXT.NO_RESULTS}
        </p>
      ) : (
        <div className="dashboard__sections">
          {visibleStatusKeys.map((statusKey) => (
            <TriageSection
              key={statusKey}
              status={TRIAGE_STATUS[statusKey]}
              candidates={searchedCandidates.filter((candidate) => candidate.colour === statusKey)}
              expandedIds={expandedIds}
              onToggleRow={handleToggleRow}
              onRowContextMenu={handleRowContextMenu}
            />
          ))}
        </div>
      )}

      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={handleEditRow}
          onClose={handleCloseContextMenu}
        />
      )}

      {editingCandidate && (
        <EditCandidateModal
          candidate={editingCandidate}
          onSave={handleSaveCandidate}
          onClose={handleCloseModal}
        />
      )}
    </section>
  );
}

export default DashboardView;
