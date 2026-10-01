import path from 'node:path';
import multer from 'multer';
import {
  ALLOWED_FILE_EXTENSIONS,
  BYTES_PER_MB,
  ERROR_CODES,
  HTTP_STATUS,
  UPLOAD_FIELD,
} from '../constants/index.js';
import { HttpError } from '../errors.js';

// Busboy reads part header parameters as latin1, so UTF-8 names like "análisis.csv" arrive garbled.
// A name that was not latin1-decoded UTF-8 (for example one sent with an explicit charset) is kept as is.
export function decodeFileName(name) {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

function unsupportedTypeError(name) {
  return new HttpError(
    HTTP_STATUS.BAD_REQUEST,
    ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    `"${name}" is not a supported file type. Allowed: ${ALLOWED_FILE_EXTENSIONS.join(' ')}`,
    UPLOAD_FIELD,
  );
}

function toUploadError(err, { maxFileMb, maxFiles }) {
  if (!(err instanceof multer.MulterError)) return err;
  if (err.code === 'LIMIT_FILE_SIZE') {
    const name = err.filename ? `"${decodeFileName(err.filename)}"` : 'A file';
    return new HttpError(HTTP_STATUS.PAYLOAD_TOO_LARGE, ERROR_CODES.FILE_TOO_LARGE, `${name} is over ${maxFileMb} MB`, UPLOAD_FIELD);
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = err.field === UPLOAD_FIELD || err.code === 'LIMIT_FILE_COUNT'
      ? `Too many files (max ${maxFiles})`
      : `Unexpected file field "${err.field}"; use "${UPLOAD_FIELD}"`;
    return new HttpError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message, UPLOAD_FIELD);
  }
  return err;
}

export function createUpload({ maxFileMb, maxFiles }) {
  const receiveFiles = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileMb * BYTES_PER_MB, files: maxFiles },
    fileFilter(req, file, callback) {
      file.originalname = decodeFileName(file.originalname);
      const extension = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
        callback(unsupportedTypeError(file.originalname));
        return;
      }
      callback(null, true);
    },
  }).array(UPLOAD_FIELD, maxFiles);

  return (req, res, next) => {
    receiveFiles(req, res, (err) => next(err ? toUploadError(err, { maxFileMb, maxFiles }) : undefined));
  };
}
