import { useCallback, useState } from 'react';
import DashboardFilters from './DashboardFilters';
import EditCandidateModal from './EditCandidateModal';
import IngestionList from './IngestionList';
import RowContextMenu from './RowContextMenu';
import TriageSection from './TriageSection';
import {
  DASHBOARD_TEXT,
  FILTER_TEXT,
  STATUS_FILTER_ALL,
  TRIAGE_STATUS,
  TRIAGE_STATUS_ORDER,
  missingReasonText,
} from '../constants';
import './DashboardView.css';

function hasReason(candidate) {
  return typeof candidate.reason === 'string' && candidate.reason.trim() !== '';
}

function matchesSearch(candidate, searchText) {
  const query = searchText.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return [candidate.candidate_id, candidate.reason, candidate.justification]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function DashboardView({
  title,
  candidates,
  warnings = [],
  ingestion = [],
  breederUser = '',
  onCandidateUpdated = () => {},
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_ALL);

  const missingReasonCount = candidates.filter((candidate) => !hasReason(candidate)).length;
  const searchedWithReason = candidates.filter(
    (candidate) => hasReason(candidate) && matchesSearch(candidate, searchText),
  );
  // Chip counts follow the search and only rows that have a reason, so they match the tables.
  const statusCounts = {
    [STATUS_FILTER_ALL]: searchedWithReason.length,
    ...Object.fromEntries(
      TRIAGE_STATUS_ORDER.map((statusKey) => [
        statusKey,
        searchedWithReason.filter((candidate) => candidate.colour === statusKey).length,
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

        <div className="dashboard__summary" data-testid="dashboard-summary">
          <span className="dashboard__summary-title">{title}</span>
          <span className="dashboard__summary-detail">
            {candidates.length} {DASHBOARD_TEXT.CANDIDATES_EVALUATED}
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

      <IngestionList ingestion={ingestion} />

      {warnings.length > 0 && (
        <ul className="dashboard__warnings" data-testid="analysis-warnings">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} data-testid={`analysis-warning-${warning.code}`}>
              {warning.code}: {warning.message}
            </li>
          ))}
        </ul>
      )}

      {missingReasonCount > 0 && (
        <p className="dashboard__empty" role="status" data-testid="candidates-without-reason">
          {missingReasonText(missingReasonCount)}
        </p>
      )}

      {visibleCount === 0 && (searchText.trim() || statusFilter !== STATUS_FILTER_ALL) ? (
        <p className="dashboard__empty" role="status" data-testid="filter-empty">
          {FILTER_TEXT.NO_RESULTS}
        </p>
      ) : visibleCount > 0 ? (
        <div className="dashboard__sections">
          {visibleStatusKeys.map((statusKey) => (
            <TriageSection
              key={statusKey}
              status={TRIAGE_STATUS[statusKey]}
              candidates={searchedWithReason.filter((candidate) => candidate.colour === statusKey)}
              expandedIds={expandedIds}
              onToggleRow={handleToggleRow}
              onRowContextMenu={handleRowContextMenu}
            />
          ))}
        </div>
      ) : null}

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
          breederUser={breederUser}
          onUpdated={onCandidateUpdated}
          onClose={handleCloseModal}
        />
      )}
    </section>
  );
}

export default DashboardView;
