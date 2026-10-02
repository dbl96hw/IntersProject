import {
  DASHBOARD_TEXT,
  TABLE_COLUMNS,
} from '../constants';
import './TriageSection.css';

function formatCandidateCount(count) {
  const noun = count === 1 ? DASHBOARD_TEXT.CANDIDATE_ONE : DASHBOARD_TEXT.CANDIDATE_OTHER;
  return `${count} ${noun}`;
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
                    {candidate.overridden && (
                      <span
                        className="triage-table__badge"
                        title={candidate.override?.reason_code || DASHBOARD_TEXT.OVERRIDDEN_BADGE}
                        data-testid={`overridden-badge-${candidate.candidate_id}`}
                      >
                        {DASHBOARD_TEXT.OVERRIDDEN_BADGE}
                      </span>
                    )}
                    {candidate.overridden && (
                      <span
                        className="triage-table__badge"
                        data-testid={`engine-colour-${candidate.candidate_id}`}
                      >
                        {candidate.engine_colour}
                      </span>
                    )}
                    {candidate.justification_source && (
                      <span
                        className="triage-table__badge"
                        data-testid={`justification-source-${candidate.candidate_id}`}
                      >
                        {DASHBOARD_TEXT.SOURCE_LABEL} {candidate.justification_source}
                      </span>
                    )}
                    {candidate.verified === false && (
                      <span
                        className="triage-table__badge"
                        data-testid={`unverified-badge-${candidate.candidate_id}`}
                      >
                        {DASHBOARD_TEXT.UNVERIFIED_BADGE}
                      </span>
                    )}
                    {Array.isArray(candidate.ambiguous_trials) && candidate.ambiguous_trials.length > 0 && (
                      <span
                        className="triage-table__badge"
                        data-testid={`ambiguous-trials-${candidate.candidate_id}`}
                      >
                        {DASHBOARD_TEXT.AMBIGUOUS_TRIALS}
                      </span>
                    )}
                    {candidate.atypical === true && (
                      <span className="triage-table__badge" data-testid={`atypical-flag-${candidate.candidate_id}`}>
                        {DASHBOARD_TEXT.ATYPICAL}
                      </span>
                    )}
                    {candidate.overridden && (
                      <span
                        className="triage-table__badge"
                        data-testid={`engine-reason-label-${candidate.candidate_id}`}
                      >
                        {DASHBOARD_TEXT.ENGINE_REASON}
                      </span>
                    )}
                    <span data-testid={`candidate-reason-${candidate.candidate_id}`}>{candidate.reason}</span>
                    {candidate.overridden && candidate.override && (
                      <span data-testid={`breeder-override-${candidate.candidate_id}`}>
                        <span
                          className="triage-table__badge"
                          data-testid={`breeder-override-label-${candidate.candidate_id}`}
                        >
                          {DASHBOARD_TEXT.BREEDER_OVERRIDE}
                        </span>
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
                    {typeof candidate.decision === 'string' && (
                      <span data-testid={`candidate-decision-${candidate.candidate_id}`}>
                        <span className="triage-table__badge">{DASHBOARD_TEXT.DECISION_LABEL}</span>
                        {candidate.decision}
                      </span>
                    )}
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
