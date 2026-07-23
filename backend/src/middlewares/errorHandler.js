'use strict';
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');

function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', details });
  }

  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(400, `Invalid value for ${err.path}`, { code: 'INVALID_ID' });
  }

  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).join(', ') || 'field';
    return new ApiError(409, `Duplicate value for ${field}`, { code: 'DUPLICATE_KEY' });
  }

  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return new ApiError(401, 'Invalid or expired token', { code: 'INVALID_TOKEN' });
  }

  if (err && err.type === 'entity.parse.failed') {
    return new ApiError(400, 'Malformed JSON body', { code: 'MALFORMED_JSON' });
  }

  return new ApiError(500, 'Something went wrong', { code: 'INTERNAL_ERROR', isOperational: false });
}

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  const apiError = normalize(err);

  const logPayload = { err, requestId: req.id, path: req.originalUrl, method: req.method, statusCode: apiError.statusCode };
  if (apiError.statusCode >= 500) logger.error(logPayload, apiError.message);
  else logger.warn(logPayload, apiError.message);

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      ...(env.isProd ? {} : { stack: err.stack }),
    },
    requestId: req.id,
  });
};
