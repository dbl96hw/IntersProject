import multer from 'multer';
import { ZodError } from 'zod';
import { ERROR_CODES, HTTP_STATUS } from '../constants/index.js';
import { HttpError } from '../errors.js';
import { DataEngineError } from '../services/dataEngineClient.js';

const NETWORK_ERROR_NAMES = new Set(['TimeoutError', 'AbortError']);

function isNetworkError(err) {
  return NETWORK_ERROR_NAMES.has(err?.name) || (err instanceof TypeError && err.message === 'fetch failed');
}

function toErrorResponse(err) {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message, field: err.field };
  }
  if (err instanceof DataEngineError) {
    return { status: err.status, code: err.code, message: err.message, field: err.field };
  }
  if (isNetworkError(err)) {
    return {
      status: HTTP_STATUS.BAD_GATEWAY,
      code: ERROR_CODES.DATA_ENGINE_UNAVAILABLE,
      message: 'Data engine is unreachable',
    };
  }
  if (err instanceof ZodError) {
    const [firstIssue] = err.issues;
    return {
      status: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: firstIssue?.message || 'Invalid request',
      field: firstIssue?.path.join('.') || undefined,
    };
  }
  if (err instanceof multer.MulterError) {
    const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE';
    return {
      status: isFileTooLarge ? HTTP_STATUS.PAYLOAD_TOO_LARGE : HTTP_STATUS.BAD_REQUEST,
      code: isFileTooLarge ? ERROR_CODES.FILE_TOO_LARGE : ERROR_CODES.VALIDATION_ERROR,
      message: err.message,
      field: err.field,
    };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: HTTP_STATUS.BAD_REQUEST, code: ERROR_CODES.VALIDATION_ERROR, message: 'Request body is not valid JSON' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: HTTP_STATUS.PAYLOAD_TOO_LARGE, code: ERROR_CODES.FILE_TOO_LARGE, message: 'Request body is too large' };
  }
  return { status: HTTP_STATUS.INTERNAL_ERROR, code: ERROR_CODES.INTERNAL_ERROR, message: 'Unexpected server error' };
}

// Express only treats a middleware as an error handler when it declares four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const { status, code, message, field } = toErrorResponse(err);
  const reason = code === ERROR_CODES.INTERNAL_ERROR ? ` (${err?.message})` : '';
  console.error(`${req.method} ${req.originalUrl} -> ${status} ${code}${reason}`);
  res.status(status).json({ error: { code, message, field: field ?? null } });
}
