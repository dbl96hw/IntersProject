import { useRef, useState } from 'react';
import Logo from './Logo';
import { validateUploadFiles } from '../validateUploadFiles';
import { ACCEPTED_FILE_TYPES, APP_NAME, UPLOAD_TEXT, WELCOME_TEXT } from '../constants';
import './WelcomeView.css';

function WelcomeView({
  isAnalyzing = false,
  errorMessage = '',
  rejectedFiles = [],
  onSubmitFiles,
  onFilesChange,
}) {
  const fileInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [pickErrors, setPickErrors] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const hasFiles = files.length > 0;

  function addFiles(pickedFiles) {
    const { accepted, rejected } = validateUploadFiles(files, Array.from(pickedFiles));
    setFiles([...files, ...accepted]);
    // Each pick replaces the previous list, so old messages never linger.
    setPickErrors(rejected);
    onFilesChange?.();
  }

  function handleBrowseClick() {
    fileInputRef.current.click();
  }

  function handleFilesChange(event) {
    addFiles(event.target.files);
    // Clearing the value lets the user pick the same file again after removing it.
    event.target.value = '';
  }

  function handleDragOver(event) {
    event.preventDefault();
    if (!isAnalyzing) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(event) {
    // Ignore leave events fired when the pointer moves onto a child of the drop zone.
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    if (!isAnalyzing) {
      addFiles(event.dataTransfer.files);
    }
  }

  function handleRemoveFile(fileName) {
    setFiles((currentFiles) => currentFiles.filter((file) => file.name !== fileName));
    setPickErrors([]);
    onFilesChange?.();
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!hasFiles || isAnalyzing) {
      return;
    }
    onSubmitFiles?.(files);
  }

  return (
    <section className="welcome" data-testid="welcome-view" aria-labelledby="welcome-title">
      <div className="welcome__hero">
        <Logo size={88} />
        <h1 id="welcome-title" className="welcome__title">
          {APP_NAME}
        </h1>
        <p className="welcome__greeting">{WELCOME_TEXT.GREETING}</p>
      </div>

      <form className="welcome__form" onSubmit={handleSubmit}>
        <div
          className={`welcome__dropzone${isDragging ? ' welcome__dropzone--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-testid="upload-dropzone"
        >
          <svg className="welcome__dropzone-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path d="M24 32V10M24 10L15 19M24 10L33 19" />
            <path d="M8 30V38H40V30" />
          </svg>

          <p className="welcome__dropzone-title">
            {isDragging ? WELCOME_TEXT.DROPZONE_ACTIVE : WELCOME_TEXT.DROPZONE_TITLE}
          </p>
          <p className="welcome__dropzone-hint">{WELCOME_TEXT.DROPZONE_HINT}</p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPTED_FILE_TYPES}
            onChange={handleFilesChange}
            data-testid="upload-input"
          />
          <button
            type="button"
            className="welcome__browse-button"
            onClick={handleBrowseClick}
            disabled={isAnalyzing}
            data-testid="upload-add-button"
          >
            {WELCOME_TEXT.BROWSE_FILES}
          </button>
        </div>

        {hasFiles && (
          <ul className="welcome__files" aria-label={WELCOME_TEXT.FILES_SELECTED} data-testid="selected-files">
            {files.map((file) => (
              <li key={file.name} className="welcome__file-chip">
                <span className="welcome__file-name" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  className="welcome__file-remove"
                  onClick={() => handleRemoveFile(file.name)}
                  disabled={isAnalyzing}
                  aria-label={`${WELCOME_TEXT.REMOVE_FILE}: ${file.name}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="welcome__formats-hint" data-testid="upload-formats-hint">
          {UPLOAD_TEXT.FORMATS_HINT}
        </p>

        {pickErrors.length > 0 && (
          <ul className="welcome__problems" role="alert" data-testid="upload-file-errors">
            {pickErrors.map((problem) => (
              <li key={problem.message}>{problem.message}</li>
            ))}
          </ul>
        )}

        {errorMessage && (
          <p className="welcome__problems" role="alert" data-testid="upload-error">
            {errorMessage}
          </p>
        )}

        {rejectedFiles.length > 0 && (
          <ul className="welcome__problems" data-testid="upload-rejected-files">
            {rejectedFiles.map((problem) => (
              <li key={`${problem.name}-${problem.message}`}>
                <strong>{problem.name}</strong>: {problem.message}
              </li>
            ))}
          </ul>
        )}

        {isAnalyzing ? (
          <p className="welcome__analyzing" role="status" data-testid="analysis-loading">
            {WELCOME_TEXT.ANALYZING}
          </p>
        ) : (
          <button
            type="submit"
            className="welcome__submit-button"
            disabled={!hasFiles}
            data-testid="upload-submit"
          >
            {WELCOME_TEXT.SUBMIT}
          </button>
        )}
      </form>
    </section>
  );
}

export default WelcomeView;
