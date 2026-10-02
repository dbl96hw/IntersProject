import { useEffect, useState } from 'react';
import { getHealth } from '../api/client';
import { HEALTH_REFRESH_MS, HEALTH_TEXT } from '../constants';
import './BackendStatus.css';

function BackendStatus() {
  const [status, setStatus] = useState({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;

    function loadHealth() {
      const currentRequest = requestId + 1;
      requestId = currentRequest;

      getHealth()
        .then((health) => {
          if (!cancelled && currentRequest === requestId) {
            setStatus({ state: 'ready', health });
          }
        })
        .catch((error) => {
          if (!cancelled && currentRequest === requestId) {
            setStatus({ state: 'error', message: error.message || HEALTH_TEXT.UNREACHABLE });
          }
        });
    }

    loadHealth();
    const timer = setInterval(loadHealth, HEALTH_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
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
