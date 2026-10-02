import { useEffect, useState } from 'react';
import { getHealth } from '../api/client';
import { HEALTH_TEXT } from '../constants';
import './BackendStatus.css';

function BackendStatus() {
  const [status, setStatus] = useState({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    getHealth()
      .then((health) => {
        if (!cancelled) {
          setStatus({ state: 'ready', health });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ state: 'error', message: error.message || HEALTH_TEXT.UNREACHABLE });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status.state === 'loading') {
    return (
      <p className="backend-status" role="status" data-testid="backend-status-loading">
        {HEALTH_TEXT.LOADING}
      </p>
    );
  }

  if (status.state === 'error') {
    return (
      <p className="backend-status backend-status--error" role="alert" data-testid="backend-status-error">
        {status.message}
      </p>
    );
  }

  const { mode, engine } = status.health;

  return (
    <div className="backend-status" role="status" aria-label={HEALTH_TEXT.STATUS_LABEL} data-testid="backend-status">
      <p className="backend-status__line">
        {HEALTH_TEXT.MODE_LABEL} {mode}. {HEALTH_TEXT.ENGINE_LABEL} {engine}.
      </p>
      {mode === 'mock' && (
        <p className="backend-status__notice" data-testid="backend-mock-notice">
          {HEALTH_TEXT.MOCK_NOTICE}
        </p>
      )}
    </div>
  );
}

export default BackendStatus;
