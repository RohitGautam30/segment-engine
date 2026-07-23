'use strict';
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down.' } },
};

const globalLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  skip: () => env.isTest,
});

const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
});

const ingestLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.INGEST_RATE_LIMIT_MAX,
  keyGenerator: (req) => String(req.headers['x-api-key'] || req.ip),
  skip: () => env.isTest,
});

module.exports = { globalLimiter, authLimiter, ingestLimiter };
