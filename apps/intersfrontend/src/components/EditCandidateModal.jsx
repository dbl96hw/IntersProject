import { useEffect, useState } from 'react';
import { EDIT_TEXT, OVERRIDE_REASONS, TRIAGE_STATUS, TRIAGE_STATUS_ORDER } from '../constants';
import './EditCandidateModal.css';

function validateForm({ crop, meanYield, justification, isStatusChanged, reasonCode }) {
  const errors = {};

  if (!crop.trim()) {
    errors.crop = EDIT_TEXT.CROP_REQUIRED;
  }
  if (meanYield === '' || Number.isNaN(Number(meanYield)) || Number(meanYield) < 0) {
    errors.meanYield = EDIT_TEXT.YIELD_INVALID;
  }
  if (!justification.trim()) {
    errors.justification = EDIT_TEXT.JUSTIFICATION_REQUIRED;
  }
  if (isStatusChanged && !reasonCode) {
    errors.reasonCode = EDIT_TEXT.REASON_REQUIRED;
  }

  return errors;
}

function EditCandidateModal({ candidate, onSave, onClose }) {
  const [crop, setCrop] = useState(candidate.crop);
  const [meanYield, setMeanYield] = useState(String(candidate.mean_yield_t_ha));
  const [justification, setJustification] = useState(candidate.reason);
  const [colour, setColour] = useState(candidate.colour);
  const [reasonCode, setReasonCode] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState({});

  const isStatusChanged = colour !== candidate.colour;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleSubmit(event) {
    event.preventDefault();

    const formErrors = validateForm({ crop, meanYield, justification, isStatusChanged, reasonCode });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }

    onSave({
      crop: crop.trim(),
      mean_yield_t_ha: Number(meanYield),
      reason: justification.trim(),
      colour,
      override: isStatusChanged ? { reason_code: reasonCode, comment: comment.trim() } : candidate.override,
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

        <div className="edit-modal__field">
          <label htmlFor="edit-crop">{EDIT_TEXT.CROP}</label>
          <input
            id="edit-crop"
            type="text"
            value={crop}
            onChange={(event) => setCrop(event.target.value)}
            autoFocus
            data-testid="edit-crop-input"
          />
          {errors.crop && <p className="edit-modal__error">{errors.crop}</p>}
        </div>

        <div className="edit-modal__field">
          <label htmlFor="edit-yield">{EDIT_TEXT.MEAN_YIELD}</label>
          <input
            id="edit-yield"
            type="number"
            step="0.01"
            min="0"
            value={meanYield}
            onChange={(event) => setMeanYield(event.target.value)}
            data-testid="edit-yield-input"
          />
          {errors.meanYield && <p className="edit-modal__error">{errors.meanYield}</p>}
        </div>

        <div className="edit-modal__field">
          <label htmlFor="edit-justification">{EDIT_TEXT.JUSTIFICATION}</label>
          <textarea
            id="edit-justification"
            rows={4}
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            data-testid="edit-justification-input"
          />
          {errors.justification && <p className="edit-modal__error">{errors.justification}</p>}
        </div>

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

        {isStatusChanged && (
          <>
            <div className="edit-modal__field">
              <label htmlFor="edit-override-reason">{EDIT_TEXT.OVERRIDE_REASON}</label>
              <select
                id="edit-override-reason"
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                data-testid="edit-override-reason-select"
              >
                <option value="">{EDIT_TEXT.OVERRIDE_REASON_PLACEHOLDER}</option>
                {OVERRIDE_REASONS.map(({ code, label }) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              {errors.reasonCode && <p className="edit-modal__error">{errors.reasonCode}</p>}
            </div>

            <div className="edit-modal__field">
              <label htmlFor="edit-comment">{EDIT_TEXT.COMMENT}</label>
              <textarea
                id="edit-comment"
                rows={2}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                data-testid="edit-comment-input"
              />
            </div>
          </>
        )}

        <div className="edit-modal__actions">
          <button type="button" className="edit-modal__button" onClick={onClose} data-testid="edit-cancel-button">
            {EDIT_TEXT.CANCEL}
          </button>
          <button
            type="submit"
            className="edit-modal__button edit-modal__button--primary"
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
