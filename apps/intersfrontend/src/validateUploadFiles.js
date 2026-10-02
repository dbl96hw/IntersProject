import {
  ACCEPTED_FILE_TYPES,
  MAX_UPLOAD_FILE_MB,
  MAX_UPLOAD_FILES,
  emptyFileText,
  tooLargeFileText,
  tooManyFilesText,
  unsupportedFileText,
} from './constants';

const BYTES_PER_MB = 1024 * 1024;
const ACCEPTED_EXTENSIONS = ACCEPTED_FILE_TYPES.split(',');

function getExtension(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

// The `accept` attribute only filters the file picker; dropped files bypass it, so check here too.
// Duplicate names are ignored silently. Files over the count limit are listed once, not one by one.
export function validateUploadFiles(currentFiles, pickedFiles) {
  const accepted = [];
  const rejected = [];
  const knownNames = new Set(currentFiles.map((file) => file.name));
  let isOverLimit = false;

  pickedFiles.forEach((file) => {
    if (knownNames.has(file.name)) return;

    if (file.size === 0) {
      rejected.push({ name: file.name, message: emptyFileText(file.name) });
    } else if (!ACCEPTED_EXTENSIONS.includes(getExtension(file.name))) {
      rejected.push({ name: file.name, message: unsupportedFileText(file.name) });
    } else if (file.size > MAX_UPLOAD_FILE_MB * BYTES_PER_MB) {
      rejected.push({ name: file.name, message: tooLargeFileText(file.name, file.size / BYTES_PER_MB) });
    } else if (currentFiles.length + accepted.length >= MAX_UPLOAD_FILES) {
      isOverLimit = true;
    } else {
      accepted.push(file);
      knownNames.add(file.name);
    }
  });

  if (isOverLimit) {
    rejected.push({ name: '', message: tooManyFilesText(MAX_UPLOAD_FILES) });
  }

  return { accepted, rejected };
}
