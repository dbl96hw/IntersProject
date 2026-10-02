import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { missingReasonText } from '../constants';
import DashboardView from './DashboardView';

function candidate(overrides) {
  return {
    candidate_id: 'SYN-1',
    colour: 'RED',
    engine_colour: 'RED',
    overridden: false,
    reason: 'fails in 1 of 1 trials',
    justification: 'Fails in 1 of 1 trials.',
    justification_source: 'claude',
    verified: true,
    n_fail: 1,
    n_trials: 1,
    ambiguous_trials: [],
    atypical: false,
    ...overrides,
  };
}

function many(colour, count) {
  return Array.from({ length: count }, (_, index) => candidate({
    candidate_id: `${colour}-${index}`,
    colour,
    engine_colour: colour,
    reason: `${colour} reason ${index}`,
  }));
}

describe('DashboardView live rows', () => {
  it('shows green then amber then red, 25, 71 and 54, each with its reason', () => {
    render(
      <DashboardView
        title="Germplasm"
        candidates={[...many('RED', 54), ...many('AMBER', 71), ...many('GREEN', 25)]}
      />,
    );

    const sections = screen.getAllByTestId(/^triage-section-/);
    expect(sections.map((section) => section.getAttribute('data-testid'))).toEqual([
      'triage-section-green',
      'triage-section-amber',
      'triage-section-red',
    ]);
    expect(screen.getByTestId('triage-count-green')).toHaveTextContent('25');
    expect(screen.getByTestId('triage-count-amber')).toHaveTextContent('71');
    expect(screen.getByTestId('triage-count-red')).toHaveTextContent('54');
    expect(screen.getByTestId('dashboard-summary')).toHaveTextContent('150 candidates evaluated');
    expect(screen.getByTestId('dashboard-summary')).not.toHaveTextContent('Germplasm');
    expect(screen.getByTestId('candidate-reason-RED-0')).toHaveTextContent('RED reason 0');
    expect(screen.getByTestId('candidate-decision-RED-0')).toHaveTextContent('Pending');
    expect(screen.getAllByRole('columnheader', { name: 'Decision' })).toHaveLength(3);
    expect(screen.queryByRole('columnheader', { name: 'Crop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Mean yield (t/ha)' })).not.toBeInTheDocument();
  });

  it('shows how many candidates have no reason and does not paint their colour', () => {
    render(
      <DashboardView
        title="Germplasm"
        candidates={[
          candidate({ candidate_id: 'SYN-SHOWN', colour: 'RED', reason: 'fails in 1 of 1 trials' }),
          candidate({ candidate_id: 'SYN-HIDDEN', colour: 'GREEN', reason: '   ' }),
        ]}
      />,
    );

    expect(screen.getByTestId('candidates-without-reason')).toHaveTextContent(missingReasonText(1));
    expect(screen.getByTestId('triage-count-red')).toHaveTextContent('1');
    expect(screen.getByTestId('triage-count-green')).toHaveTextContent('0');
    expect(screen.queryByTestId('candidate-row-SYN-HIDDEN')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-summary')).toHaveTextContent('2');
  });

  it('shows the engine reason and a breeder override without status badges', () => {
    render(
      <DashboardView
        title="Germplasm"
        warnings={[{ code: 'EXPLANATION_DEFERRED', message: 'The rest keep the engine reason.' }]}
        candidates={[
          candidate({
            candidate_id: 'SYN-FLAGGED',
            overridden: true,
            colour: 'AMBER',
            engine_colour: 'RED',
            justification_source: 'engine',
            verified: false,
            ambiguous_trials: ['SYN-TR-0025'],
            atypical: true,
            reason: 'fails in 3 of 5 trials',
            override: {
              reason_code: 'FIELD_OBSERVATION',
              comment: 'vigour in plot 12',
            },
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('engine-colour-SYN-FLAGGED')).not.toBeInTheDocument();
    expect(screen.queryByTestId('justification-source-SYN-FLAGGED')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unverified-badge-SYN-FLAGGED')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ambiguous-trials-SYN-FLAGGED')).not.toBeInTheDocument();
    expect(screen.queryByTestId('atypical-flag-SYN-FLAGGED')).not.toBeInTheDocument();
    expect(screen.getByTestId('breeder-override-SYN-FLAGGED')).toHaveTextContent('FIELD_OBSERVATION');
    expect(screen.getByTestId('breeder-override-SYN-FLAGGED')).toHaveTextContent('vigour in plot 12');
    expect(screen.getByTestId('candidate-reason-SYN-FLAGGED')).toHaveTextContent('fails in 3 of 5 trials');
    expect(screen.getByTestId('candidate-decision-SYN-FLAGGED')).toHaveTextContent('Pending');
    expect(screen.queryByTestId('ingestion-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-warning-EXPLANATION_DEFERRED')).not.toBeInTheDocument();
    expect(screen.queryByText('Click a row to expand it.')).not.toBeInTheDocument();
  });
});
