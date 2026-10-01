import { z } from 'zod';
import { notFoundError } from '../errors.js';

// Express 4 does not forward rejected promises to the error handler on its own.
export function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

// A malformed id cannot match any row, so it is reported as 404 like an unknown id.
export function requireUuid(value, what) {
  if (!z.uuid().safeParse(value).success) throw notFoundError(what);
  return value;
}
