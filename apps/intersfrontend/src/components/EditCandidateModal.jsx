import { useEffect, useRef, useState } from 'react';
import { listOverrideReasons, recordCandidateDecision, updateCandidate } from '../api/client';
import {
  API_ERROR_CODES,
  CANDIDATE_DECISIONS,
  CANDIDATE_SAVE_AVAILABLE,
  DASHBOARD_TEXT,
  EDIT_TEXT,
  HEALTH_TEXT,
  OTHER_REASON_CODE,
  TRIAGE_STATUS,
  TRIAGE_STATUS_ORDER,
} from '../constants';
import './EditCandidateModal.css';

function EditCandidateModal({ candidate, breederUser, onUpdated, onClose }) {
  const [reasonsState, setReasonsState] = useState({ state: 'loading', reasons: {}, message: '' });
  const [colour, setColour] = useState(candidate.colour);
  const [reasonCode, setReasonCode] = useState('');
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState(candidate.decision || CANDIDATE_DECISIONS.PENDING);
  const [userError, setUserError] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [commentError, setCommentError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveField, setSaveField] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const isStatusChanged = colour !== candidate.colour;
  const originalDecision = candidate.decision || CANDIDATE_DECISIONS.PENDING;
  const isDecisionChanged = decision !== originalDecision
    && (decision === CANDIDATE_DECISIONS.PASS || decision === CANDIDATE_DECISIONS.NO_PASS);
  const commentLabel = reasonCode === OTHER_REASON_CODE ? EDIT_TEXT.COMMENT_REQUIRED : EDIT_TEXT.COMMENT_OPTIONAL;

  useEffect(() => {
    let cancelled = false;

    listOverrideReasons()
      .then((reasons) => {
        if (!cancelled) {
          setReasonsState({
            state: 'ready',
            reasons: reasons && typeof reasons === 'object' ? reasons : {},
            message: '',
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReasonsState({
            state: 'error',
            reasons: {},
            message: error.message || EDIT_TEXT.REASONS_FAILED,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function beginSave() {
    if (isSavingRef.current || !CANDIDATE_SAVE_AVAILABLE) {
      return false;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    return true;
  }

  function endSave() {
    isSavingRef.current = false;
    setIsSaving(false);
  }

  function clearErrors() {
    setUserError('');
    setReasonError('');
    setCommentError('');
    setSaveError('');
    setSaveField('');
  }

  function showSaveError(error) {
    if (error?.code === API_ERROR_CODES.DATA_ENGINE_UNAVAILABLE) {
      setSaveError(EDIT_TEXT.ENGINE_DOWN);
    } else {
      setSaveError(error?.message || HEALTH_TEXT.UNEXPECTED);
    }
    setSaveField(error?.field || '');
  }

  async function send(action) {
    if (!beginSave()) {
      return;
    }
    clearErrors();
    try {
      const body = await action();
      if (!body?.candidate || typeof body.candidate !== 'object') {
        setSaveError(HEALTH_TEXT.UNEXPECTED);
        return;
      }
      onUpdated(body.candidate);
      onClose();
    } catch (error) {
      showSaveError(error);
    } finally {
      endSave();
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (isSavingRef.current || !CANDIDATE_SAVE_AVAILABLE) {
      return;
    }
    clearErrors();
    if (!breederUser.trim()) {
      setUserError(EDIT_TEXT.USER_REQUIRED);
      return;
    }
    if (!isStatusChanged && !isDecisionChanged) {
      return;
    }
    if (isStatusChanged) {
      if (reasonsState.state !== 'ready') {
        return;
      }
      if (!reasonCode) {
        setReasonError(EDIT_TEXT.REASON_REQUIRED);
        return;
      }
      if (reasonCode === OTHER_REASON_CODE && !comment.trim()) {
        setCommentError(EDIT_TEXT.COMMENT_REQUIRED_ERROR);
        return;
      }
    }

    const user = breederUser.trim();
    send(async () => {
      let saved = null;
      if (isStatusChanged) {
        const colourBody = await updateCandidate(candidate.id, {
          new_colour: colour,
          reason_code: reasonCode,
          comment: comment.trim(),
          user,
        });
        saved = colourBody.candidate;
      }
      if (isDecisionChanged) {
        const decisionBody = await recordCandidateDecision(candidate.id, {
          decision,
          user,
        });
        saved = decisionBody.candidate;
      }
      return { candidate: saved };
    });
  }

  function handleOverlayMouseDown(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="edit-modal__overlay" onMouseDown={handleOverlayMouseDown}>
      <form
        className="edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-modal-title"
        onSubmit={handleSubmit}
        noValidate
        data-testid="edit-candidate-modal"
      >
        <h2 id="edit-modal-title" className="edit-modal__title">
          {EDIT_TEXT.MODAL_TITLE}
          <span className="edit-modal__candidate-id">{candidate.candidate_id}</span>
        </h2>

        <p className="edit-modal__readonly" data-testid="edit-engine-reason">
          <span className="edit-modal__readonly-label">{EDIT_TEXT.STATUS_REASON}</span>
          {candidate.reason}
        </p>

        <div className="edit-modal__field">
          <label htmlFor="edit-status">{EDIT_TEXT.STATUS}</label>
          <select
            id="edit-status"
            value={colour}
            onChange={(event) => setColour(event.target.value)}
            data-testid="edit-status-select"
          >
            {TRIAGE_STATUS_ORDER.map((statusKey) => (
              <option key={statusKey} value={statusKey}>
                {TRIAGE_STATUS[statusKey].label}
              </option>
            ))}
          </select>
        </div>

        {reasonsState.state === 'loading' && (
          <p className="edit-modal__error" role="status" data-testid="override-reasons-loading">
            {EDIT_TEXT.REASONS_LOADING}
          </p>
        )}

        {reasonsState.state === 'error' && (
          <p className="edit-modal__error" role="alert" data-testid="override-reasons-error">
            {reasonsState.message}
          </p>
        )}

        {isStatusChanged && reasonsState.state === 'ready' && (
          <>
            <fieldset className="edit-modal__reasons" data-testid="edit-override-reason-select">
              <legend>{EDIT_TEXT.OVERRIDE_REASON}</legend>
              {Object.entries(reasonsState.reasons).map(([code, description]) => (
                <label key={code} className="edit-modal__reason">
                  <input
                    type="radio"
                    name="edit-override-reason"
                    value={code}
                    checked={reasonCode === code}
                    onChange={() => setReasonCode(code)}
                    data-testid={`edit-override-reason-${code}`}
                  />
                  <span>{description}</span>
                </label>
              ))}
              {reasonError && (
                <p className="edit-modal__error" role="alert" data-testid="edit-reason-error">
                  {reasonError}
                </p>
              )}
            </fieldset>

            <div className="edit-modal__field">
              <label htmlFor="edit-comment">{commentLabel}</label>
              <textarea
                id="edit-comment"
                rows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                data-testid="edit-comment-input"
              />
              {commentError && (
                <p className="edit-modal__error" role="alert" data-testid="edit-comment-error">
                  {commentError}
                </p>
              )}
            </div>
          </>
        )}

        {userError && (
          <p className="edit-modal__error" role="alert" data-testid="edit-user-required">
            {userError}
          </p>
        )}

        {saveError && (
          <p className="edit-modal__error" role="alert" data-testid="edit-save-error">
            {saveError}
          </p>
        )}

        {saveField && (
          <p className="edit-modal__error" data-testid="edit-save-field">
            {saveField}
          </p>
        )}

        <div className="edit-modal__field">
          <label htmlFor="edit-decision">{DASHBOARD_TEXT.DECISION_LABEL}</label>
          <select
            id="edit-decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            data-testid="edit-decision-select"
          >
            <option value={CANDIDATE_DECISIONS.PENDING}>{DASHBOARD_TEXT.DECISION_PENDING}</option>
            <option value={CANDIDATE_DECISIONS.PASS}>{EDIT_TEXT.PASS}</option>
            <option value={CANDIDATE_DECISIONS.NO_PASS}>{EDIT_TEXT.NO_PASS}</option>
          </select>
        </div>

        <div className="edit-modal__actions">
          <button type="button" className="edit-modal__button" onClick={onClose} data-testid="edit-cancel-button">
            {EDIT_TEXT.CANCEL}
          </button>
          <button
            type="submit"
            className="edit-modal__button edit-modal__button--primary"
            disabled={isSaving || !CANDIDATE_SAVE_AVAILABLE}
            data-testid="edit-save-button"
          >
            {EDIT_TEXT.SAVE}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditCandidateModal;
