import { FILTER_TEXT, STATUS_FILTER_ALL, TRIAGE_STATUS, TRIAGE_STATUS_ORDER } from '../constants';
import './DashboardFilters.css';

const STATUS_CHIPS = [
  { key: STATUS_FILTER_ALL, label: FILTER_TEXT.STATUS_ALL, modifier: 'all' },
  ...TRIAGE_STATUS_ORDER.map((statusKey) => TRIAGE_STATUS[statusKey]),
];

function DashboardFilters({ searchText, onSearchChange, statusFilter, onStatusFilterChange, statusCounts }) {
  return (
    <div className="dashboard-filters" data-testid="dashboard-filters">
      <input
        type="search"
        className="dashboard-filters__search"
        value={searchText}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={FILTER_TEXT.SEARCH_PLACEHOLDER}
        aria-label={FILTER_TEXT.SEARCH_LABEL}
        data-testid="filter-search-input"
      />

      <div className="dashboard-filters__chips" role="group" aria-label={FILTER_TEXT.STATUS_GROUP_LABEL}>
        {STATUS_CHIPS.map((chip) => {
          const isActive = statusFilter === chip.key;

          return (
            <button
              key={chip.key}
              type="button"
              className={`dashboard-filters__chip dashboard-filters__chip--${chip.modifier}${
                isActive ? ' dashboard-filters__chip--active' : ''
              }`}
              onClick={() => onStatusFilterChange(chip.key)}
              aria-pressed={isActive}
              data-testid={`filter-status-${chip.modifier}`}
            >
              {chip.label}
              <span className="dashboard-filters__chip-count">{statusCounts[chip.key]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DashboardFilters;
