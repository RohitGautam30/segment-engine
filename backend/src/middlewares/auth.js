'use strict';
const ApiError = require('../utils/ApiError');
const tokenService = require('../services/token.service');
const User = require('../models/User');
const { USER_STATUS } = require('../config/constants');
const env = require('../config/env');

function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Authenticates a dashboard/admin/API consumer via JWT access token. */
async function authenticate(req, _res, next) {
  try {
    const token = extractBearer(req);
    if (!token) throw ApiError.unauthorized('Missing access token');

    const payload = tokenService.verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('+tokenVersion');
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (user.status !== USER_STATUS.ACTIVE) throw ApiError.forbidden(`Account is ${user.status}`);
    if (payload.tv !== user.tokenVersion) throw ApiError.unauthorized('Token has been revoked');

    req.user = user;
    req.auth = { type: 'jwt', userId: String(user._id), role: user.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Authenticates server-to-server event ingestion via API key. */
function authenticateApiKey(req, _res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !env.ingestApiKeys.has(String(key))) {
    return next(ApiError.unauthorized('Invalid or missing API key', { code: 'INVALID_API_KEY' }));
  }
  req.auth = { type: 'apiKey' };
  return next();
}

/** Allows either a valid JWT or a valid ingest API key. */
async function authenticateAny(req, res, next) {
  if (req.headers['x-api-key']) return authenticateApiKey(req, res, next);
  return authenticate(req, res, next);
}

module.exports = { authenticate, authenticateApiKey, authenticateAny };
