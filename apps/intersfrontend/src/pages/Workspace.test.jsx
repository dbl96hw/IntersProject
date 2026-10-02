import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_TEXT, WELCOME_TEXT } from '../constants';
import Workspace from './Workspace';

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

describe('Workspace backend status and welcome', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading status before health answers', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(<Workspace />);

    expect(screen.getByTestId('backend-status-loading')).toHaveTextContent(HEALTH_TEXT.LOADING);
  });

  it('shows the mode and engine returned by health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ healthy: true, mode: 'live', engine: 'down' })),
    );

    render(<Workspace />);

    const status = await screen.findByTestId('backend-status');
    expect(status).toHaveTextContent('live');
    expect(status).toHaveTextContent('down');
  });

  it('shows an error message when health cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(<Workspace />);

    expect(await screen.findByTestId('backend-status-error')).toHaveTextContent(HEALTH_TEXT.UNREACHABLE);
    expect(screen.queryByTestId('backend-status')).not.toBeInTheDocument();
  });

  it('shows a mock-mode notice when health mode is mock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ healthy: true, mode: 'mock', engine: 'skipped' })),
    );

    render(<Workspace />);

    expect(await screen.findByTestId('backend-mock-notice')).toHaveTextContent(HEALTH_TEXT.MOCK_NOTICE);
  });

  it('shows that file upload is coming soon and does not start an analysis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ healthy: true, mode: 'live', engine: 'up' })),
    );
    const user = userEvent.setup();

    render(<Workspace />);

    expect(screen.getByTestId('upload-coming-soon')).toHaveTextContent(WELCOME_TEXT.UPLOAD_COMING_SOON);
    const file = new File(['id'], 'trials.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('upload-input'), file);

    expect(screen.getByTestId('upload-submit')).toBeDisabled();
    expect(screen.queryByTestId('analysis-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });
});
