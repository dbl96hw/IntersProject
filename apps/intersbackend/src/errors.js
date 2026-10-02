import { ERROR_CODES, HTTP_STATUS } from './constants/index.js';

// Thrown by routes and services; errorHandler turns it into { error: { code, message, field } }.
export class HttpError extends Error {
  constructor(status, code, message, field = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function notFoundError(what) {
  return new HttpError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, `${what} not found`);
}

export function validationError(message, field = null) {
  return new HttpError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, message, field);
}
