import { ERROR_CODES, HTTP_STATUS } from '../constants/index.js';

export function notFound(req, res) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
      field: null,
    },
  });
}
