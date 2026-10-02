import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDIT_TEXT } from '../constants';
import { replaceCandidate } from '../replaceCandidate';
import DashboardView from './DashboardView';

const REASONS = {
  FIELD_OBSERVATION: 'From the engine: field observation',
  OTHER: 'From the engine: other',
};

function row(overrides) {
  return {
    id: 'row-1',
    candidate_id: 'SYN-1',
    colour: 'RED',
    engine_colour: 'RED',
    overridden: false,
    override: null,
    decision: 'pending',
    reason: 'fails in 1 of 1 trials',
    justification: 'Fails in 1 of 1 trials.',
    n_fail: 1,
    n_trials: 1,
    ambiguous_trials: [],
    atypical: false,
    ...overrides,
  };
}

function Board({ rows, breederUser = 'Ada Breeder' }) {
  const [candidates, setCandidates] = useState(rows);
  return (
    <DashboardView
      title="Germplasm"
      candidates={candidates}
      breederUser={breederUser}
      onCandidateUpdated={(updated) => {
        setCandidates((current) => replaceCandidate(current, updated));
      }}
    />
  );
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function installFetch(handler) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/api/engine/override-reasons')) {
      return jsonResponse(REASONS);
    }
    return handler(url, options);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsFor(fetchMock, method) {
  return fetchMock.mock.calls.filter(([, options]) => options?.method === method);
}

async function openEditor(candidateId) {
  fireEvent.contextMenu(screen.getByTestId(`candidate-row-${candidateId}`));
  fireEvent.click(screen.getByTestId('row-context-menu-edit'));
  await waitFor(() => {
    expect(screen.queryByTestId('override-reasons-loading')).not.toBeInTheDocument();
  });
}

async function chooseAmber(reasonCode, comment) {
  fireEvent.change(screen.getByTestId('edit-status-select'), { target: { value: 'AMBER' } });
  const reasonSelect = await screen.findByTestId('edit-override-reason-select');
  fireEvent.change(reasonSelect, { target: { value: reasonCode } });
  if (comment !== undefined) {
    fireEvent.change(screen.getByTestId('edit-comment-input'), { target: { value: comment } });
  }
}

describe('colour override and decision', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves an override from the engine reasons and moves only that row', async () => {
    const moved = row({
      id: 'row-move',
      candidate_id: 'SYN-MOVE',
      colour: 'AMBER',
      engine_colour: 'RED',
      overridden: true,
      reason: 'fails in 1 of 1 trials',
      override: {
        id: 'ov-new',
        reason_code: 'FIELD_OBSERVATION',
        comment: 'good vigour in plot 12',
        engine_colour: 'RED',
        new_colour: 'AMBER',
      },
    });
    const fetchMock = installFetch((url, options) => {
      if (options.method === 'PATCH' && String(url).endsWith('/api/candidates/row-move')) {
        return jsonResponse({ candidate: moved, override: moved.override });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false);
    });

    render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' }), row({ id: 'row-stay', candidate_id: 'SYN-STAY' })]} />);

    expect(screen.getByTestId('filter-status-red')).toHaveTextContent('2');
    expect(screen.getByTestId('filter-status-amber')).toHaveTextContent('0');

    await openEditor('SYN-MOVE');
    expect(screen.queryByTestId('edit-crop-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-yield-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-save-coming-soon')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('edit-status-select'), { target: { value: 'AMBER' } });
    expect(await screen.findByRole('option', { name: 'From the engine: field observation' })).toBeInTheDocument();
    await chooseAmber('FIELD_OBSERVATION', 'good vigour in plot 12');
    fireEvent.click(screen.getByTestId('edit-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('triage-section-amber')).toContainElement(screen.getByTestId('candidate-row-SYN-MOVE'));
    });

    const patchCalls = callsFor(fetchMock, 'PATCH');
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(patchCalls[0][1].body)).toEqual({
      new_colour: 'AMBER',
      reason_code: 'FIELD_OBSERVATION',
      comment: 'good vigour in plot 12',
      user: 'Ada Breeder',
    });
    expect(screen.getByTestId('triage-section-red')).toContainElement(screen.getByTestId('candidate-row-SYN-STAY'));
    expect(screen.getByTestId('candidate-reason-SYN-STAY')).toHaveTextContent('fails in 1 of 1 trials');
    expect(screen.queryByTestId('breeder-override-SYN-STAY')).not.toBeInTheDocument();
    expect(screen.getByTestId('engine-colour-SYN-MOVE')).toHaveTextContent('RED');
    expect(screen.getByTestId('engine-reason-label-SYN-MOVE')).toHaveTextContent('Engine reason');
    expect(screen.getByTestId('candidate-reason-SYN-MOVE')).toHaveTextContent('fails in 1 of 1 trials');
    expect(screen.getByTestId('breeder-override-label-SYN-MOVE')).toHaveTextContent('Breeder override');
    expect(screen.getByTestId('breeder-override-SYN-MOVE')).toHaveTextContent('FIELD_OBSERVATION');
    expect(screen.getByTestId('breeder-override-SYN-MOVE')).toHaveTextContent('good vigour in plot 12');
    expect(screen.getByTestId('filter-status-all')).toHaveTextContent('2');
    expect(screen.getByTestId('filter-status-red')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-status-amber')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-status-green')).toHaveTextContent('0');
    expect(screen.getByTestId('triage-count-red')).toHaveTextContent('1');
    expect(screen.getByTestId('triage-count-amber')).toHaveTextContent('1');
  });

  it('does not show a breeder override when the server says the row is not overridden', async () => {
    const moved = row({
      id: 'row-move',
      candidate_id: 'SYN-MOVE',
      colour: 'AMBER',
      engine_colour: 'RED',
      overridden: false,
      override: null,
      reason: 'fails in 1 of 1 trials',
    });
    installFetch((url, options) => {
      if (options.method === 'PATCH') {
        return jsonResponse({ candidate: moved });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false);
    });

    render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' })]} />);
    await openEditor('SYN-MOVE');
    await chooseAmber('FIELD_OBSERVATION', 'note');
    fireEvent.click(screen.getByTestId('edit-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('triage-section-amber')).toContainElement(screen.getByTestId('candidate-row-SYN-MOVE'));
    });
    expect(screen.queryByTestId('engine-colour-SYN-MOVE')).not.toBeInTheDocument();
    expect(screen.queryByTestId('breeder-override-SYN-MOVE')).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-reason-SYN-MOVE')).toHaveTextContent('fails in 1 of 1 trials');
  });

  it('blocks Other without a comment and an empty breeder name before any write', async () => {
    const fetchMock = installFetch(() => jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false));

    const { unmount } = render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' })]} breederUser="" />);
    await openEditor('SYN-MOVE');
    await chooseAmber('FIELD_OBSERVATION', 'note');
    fireEvent.click(screen.getByTestId('edit-save-button'));
    fireEvent.click(screen.getByTestId('decision-no-pass-button'));

    expect(screen.getByTestId('edit-user-required')).toHaveTextContent(EDIT_TEXT.USER_REQUIRED);
    expect(callsFor(fetchMock, 'PATCH')).toHaveLength(0);
    expect(callsFor(fetchMock, 'POST')).toHaveLength(0);
    expect(screen.getByTestId('triage-section-red')).toContainElement(screen.getByTestId('candidate-row-SYN-MOVE'));

    unmount();
    render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' })]} />);
    await openEditor('SYN-MOVE');
    await chooseAmber('OTHER', '');
    fireEvent.click(screen.getByTestId('edit-save-button'));

    expect(screen.getByTestId('edit-comment-error')).toHaveTextContent(EDIT_TEXT.COMMENT_REQUIRED_ERROR);
    expect(callsFor(fetchMock, 'PATCH')).toHaveLength(0);
  });

  it('leaves the row unchanged on 400, 501 and 502', async () => {
    const failures = [
      {
        status: { error: { code: 'VALIDATION_ERROR', message: 'reason_code is required', field: 'reason_code' } },
        text: 'reason_code is required',
        field: 'reason_code',
      },
      {
        status: { error: { code: 'NOT_IMPLEMENTED', message: 'Not available in mock mode', field: null } },
        text: 'Not available in mock mode',
      },
      {
        status: { error: { code: 'DATA_ENGINE_UNAVAILABLE', message: 'data engine unavailable', field: null } },
        text: EDIT_TEXT.ENGINE_DOWN,
      },
    ];

    for (const failure of failures) {
      const fetchMock = installFetch((url, options) => {
        if (options.method === 'PATCH') {
          return jsonResponse(failure.status, false);
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false);
      });
      const { unmount } = render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' })]} />);
      await openEditor('SYN-MOVE');
      await chooseAmber('FIELD_OBSERVATION', 'note');
      fireEvent.click(screen.getByTestId('edit-save-button'));

      expect(await screen.findByTestId('edit-save-error')).toHaveTextContent(failure.text);
      if (failure.field) {
        expect(screen.getByTestId('edit-save-field')).toHaveTextContent(failure.field);
      }
      expect(screen.getByTestId('triage-section-red')).toContainElement(screen.getByTestId('candidate-row-SYN-MOVE'));
      expect(screen.getByTestId('filter-status-amber')).toHaveTextContent('0');
      expect(callsFor(fetchMock, 'PATCH')).toHaveLength(1);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('records no pass without moving colour or engine colour', async () => {
    const before = row({
      id: 'row-decide',
      candidate_id: 'SYN-DECIDE',
      colour: 'RED',
      engine_colour: 'RED',
      overridden: true,
      override: { reason_code: 'DATA_ERROR', comment: 'kept' },
      decision: 'pending',
    });
    const after = {
      ...before,
      decision: 'no_pass',
      colour: 'RED',
      engine_colour: 'RED',
    };
    const fetchMock = installFetch((url, options) => {
      if (options.method === 'POST' && String(url).endsWith('/api/candidates/row-decide/decision')) {
        return jsonResponse({ candidate: after });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false);
    });

    render(<Board rows={[before]} />);
    expect(screen.getByTestId('engine-colour-SYN-DECIDE')).toHaveTextContent('RED');
    expect(screen.getByTestId('triage-section-red')).toContainElement(screen.getByTestId('candidate-row-SYN-DECIDE'));

    await openEditor('SYN-DECIDE');
    fireEvent.click(screen.getByTestId('decision-no-pass-button'));

    await waitFor(() => {
      expect(screen.getByTestId('candidate-decision-SYN-DECIDE')).toHaveTextContent('no_pass');
    });

    const decisionCalls = callsFor(fetchMock, 'POST');
    expect(decisionCalls).toHaveLength(1);
    expect(JSON.parse(decisionCalls[0][1].body)).toEqual({ decision: 'no_pass', user: 'Ada Breeder' });
    expect(screen.getByTestId('triage-section-red')).toContainElement(screen.getByTestId('candidate-row-SYN-DECIDE'));
    expect(screen.getByTestId('engine-colour-SYN-DECIDE')).toHaveTextContent(before.engine_colour);
    expect(screen.getByTestId('filter-status-red')).toHaveTextContent('1');
    expect(screen.getByTestId('filter-status-amber')).toHaveTextContent('0');
    expect(callsFor(fetchMock, 'PATCH')).toHaveLength(0);
  });

  it('does not send a second save while the first request is in flight', async () => {
    let resolvePatch = () => {};
    const fetchMock = installFetch((url, options) => {
      if (options.method === 'PATCH') {
        return new Promise((resolve) => {
          resolvePatch = () => resolve(jsonResponse({
            candidate: row({ id: 'row-move', candidate_id: 'SYN-MOVE', colour: 'AMBER', engine_colour: 'RED', overridden: true }),
          }));
        });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Missing', field: null } }, false);
    });

    render(<Board rows={[row({ id: 'row-move', candidate_id: 'SYN-MOVE' })]} />);
    await openEditor('SYN-MOVE');
    await chooseAmber('FIELD_OBSERVATION', 'note');
    fireEvent.click(screen.getByTestId('edit-save-button'));
    fireEvent.click(screen.getByTestId('edit-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('edit-save-button')).toBeDisabled();
    });
    expect(callsFor(fetchMock, 'PATCH')).toHaveLength(1);
    resolvePatch();
  });
});
