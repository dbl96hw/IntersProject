import { useRef, useState } from 'react';
import Logo from './Logo';
import { ACCEPTED_FILE_TYPES, APP_NAME, WELCOME_TEXT } from '../constants';
import './WelcomeView.css';

function WelcomeView({ isAnalyzing, onSubmitFiles }) {
  const fileInputRef = useRef(null);
  const [fileNames, setFileNames] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const hasFiles = fileNames.length > 0;

  function addFiles(files) {
    const pickedNames = Array.from(files, (file) => file.name);
    setFileNames((currentNames) => [...new Set([...currentNames, ...pickedNames])]);
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
    setFileNames((currentNames) => currentNames.filter((name) => name !== fileName));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!hasFiles || isAnalyzing) {
      return;
    }
    onSubmitFiles(fileNames);
    setFileNames([]);
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
            {fileNames.map((fileName) => (
              <li key={fileName} className="welcome__file-chip">
                <span className="welcome__file-name" title={fileName}>
                  {fileName}
                </span>
                <button
                  type="button"
                  className="welcome__file-remove"
                  onClick={() => handleRemoveFile(fileName)}
                  disabled={isAnalyzing}
                  aria-label={`${WELCOME_TEXT.REMOVE_FILE}: ${fileName}`}
                >
                  &times;
                </button>
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
