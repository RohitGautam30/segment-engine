'use strict';

class ApiError extends Error {
  constructor(statusCode, message, { code = undefined, details = undefined, isOperational = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || ApiError.defaultCode(statusCode);
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static defaultCode(status) {
    return (
      {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'UNPROCESSABLE_ENTITY',
        429: 'TOO_MANY_REQUESTS',
      }[status] || 'INTERNAL_ERROR'
    );
  }

  static badRequest(msg = 'Bad request', opts) { return new ApiError(400, msg, opts); }
  static unauthorized(msg = 'Unauthorized', opts) { return new ApiError(401, msg, opts); }
  static forbidden(msg = 'Forbidden', opts) { return new ApiError(403, msg, opts); }
  static notFound(msg = 'Resource not found', opts) { return new ApiError(404, msg, opts); }
  static conflict(msg = 'Conflict', opts) { return new ApiError(409, msg, opts); }
  static unprocessable(msg = 'Unprocessable entity', opts) { return new ApiError(422, msg, opts); }
}

module.exports = ApiError;
