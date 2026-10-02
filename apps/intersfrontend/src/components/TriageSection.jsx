import {
  CANDIDATE_DECISIONS,
  DASHBOARD_TEXT,
  EDIT_TEXT,
  TABLE_COLUMNS,
} from '../constants';
import './TriageSection.css';

function formatCandidateCount(count) {
  const noun = count === 1 ? DASHBOARD_TEXT.CANDIDATE_ONE : DASHBOARD_TEXT.CANDIDATE_OTHER;
  return `${count} ${noun}`;
}

function formatDecision(decision) {
  if (decision === CANDIDATE_DECISIONS.PASS) {
    return EDIT_TEXT.PASS;
  }
  if (decision === CANDIDATE_DECISIONS.NO_PASS) {
    return EDIT_TEXT.NO_PASS;
  }
  return DASHBOARD_TEXT.DECISION_PENDING;
}

function TriageSection({ status, candidates, expandedIds, onToggleRow, onRowContextMenu }) {
  const sectionTitleId = `triage-title-${status.modifier}`;

  function handleRowKeyDown(event, candidateId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleRow(candidateId);
    }
  }

  function handleRowContextMenu(event, candidate) {
    event.preventDefault();
    onRowContextMenu(candidate, event.clientX, event.clientY);
  }

  return (
    <section
      className={`triage-section triage-section--${status.modifier}`}
      aria-labelledby={sectionTitleId}
      data-testid={`triage-section-${status.modifier}`}
    >
      <header className="triage-section__header">
        <span className="triage-section__dot" aria-hidden="true" />
        <h2 id={sectionTitleId} className="triage-section__title">
          {status.label}
        </h2>
        <span className="triage-section__description">{status.description}</span>
        <span className="triage-section__count" data-testid={`triage-count-${status.modifier}`}>
          {formatCandidateCount(candidates.length)}
        </span>
      </header>

      {candidates.length === 0 ? (
        <p className="triage-section__empty">{DASHBOARD_TEXT.EMPTY_SECTION}</p>
      ) : (
        <table className="triage-table">
          <colgroup>
            {TABLE_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) => (
                <th key={column.key} scope="col" title={column.label}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const isExpanded = expandedIds.has(candidate.candidate_id);

              return (
                <tr
                  key={candidate.candidate_id}
                  className={`triage-table__row${isExpanded ? ' triage-table__row--expanded' : ''}`}
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => onToggleRow(candidate.candidate_id)}
                  onKeyDown={(event) => handleRowKeyDown(event, candidate.candidate_id)}
                  onContextMenu={(event) => handleRowContextMenu(event, candidate)}
                  data-testid={`candidate-row-${candidate.candidate_id}`}
                >
                  <td title={isExpanded ? undefined : candidate.candidate_id}>{candidate.candidate_id}</td>
                  <td>
                    {candidate.n_fail}/{candidate.n_trials}
                  </td>
                  <td>
                    <span
                      className="triage-table__justification"
                      data-testid={`candidate-reason-${candidate.candidate_id}`}
                    >
                      {candidate.reason}
                    </span>
                    {candidate.overridden && candidate.override && (
                      <span
                        className="triage-table__detail"
                        data-testid={`breeder-override-${candidate.candidate_id}`}
                      >
                        {candidate.override.reason_code}
                        {candidate.override.comment ? (
                          <span
                            className="triage-table__override-comment"
                            data-testid={`breeder-override-comment-${candidate.candidate_id}`}
                          >
                            {candidate.override.comment}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td
                    className={`triage-table__decision triage-table__decision--${candidate.decision === CANDIDATE_DECISIONS.PASS || candidate.decision === CANDIDATE_DECISIONS.NO_PASS ? candidate.decision : 'pending'}`}
                    data-testid={`candidate-decision-${candidate.candidate_id}`}
                  >
                    {formatDecision(candidate.decision)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default TriageSection;
